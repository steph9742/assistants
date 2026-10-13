#!/usr/bin/env bash
# Sauvegarde de la base Assistants.
#
# Écrit pour une raison précise : le 29/07/2026 la base a été entièrement perdue lors
# d'une saturation disque, et la seule sauvegarde présente (21/07) faisait 0 octet — elle
# avait échoué sans que personne ne le sache. Ce script REFUSE donc de considérer une
# sauvegarde comme réussie tant qu'il ne l'a pas vérifiée.
#
# Usage :
#   ./deploy/sauvegarde.sh                 # sauvegarde horodatée
#   ./deploy/sauvegarde.sh --avant-migration
#   ./deploy/sauvegarde.sh --restaurer <fichier.sql.gz>
#
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${CATALOGUE_BACKUP_DIR:-$RACINE/backup}"
SERVICE_DB="postgres"
BASE="${POSTGRES_DB:-assistants}"
UTILISATEUR="${POSTGRES_USER:-postgres}"
RETENTION="${CATALOGUE_BACKUP_KEEP:-14}"   # nombre de sauvegardes conservées

# Taille en dessous de laquelle un dump est forcément invalide (un schéma vide pèse déjà
# plusieurs Ko ; 1 Ko attrape le cas « fichier vide » qui nous a piégés).
TAILLE_MIN=1024

cd "$RACINE"
mkdir -p "$DEST"

compose() { docker compose "$@"; }

restaurer() {
  local fichier="$1"
  [[ -f "$fichier" ]] || { echo "❌ Fichier introuvable : $fichier" >&2; exit 1; }
  echo "⚠️  Restauration de « $fichier » dans la base « $BASE »."
  echo "    Le contenu actuel sera REMPLACÉ. Ctrl-C pour annuler, Entrée pour continuer."
  read -r _
  if [[ "$fichier" == *.gz ]]; then
    gunzip -c "$fichier" | compose exec -T "$SERVICE_DB" psql -U "$UTILISATEUR" -d "$BASE"
  else
    compose exec -T "$SERVICE_DB" psql -U "$UTILISATEUR" -d "$BASE" < "$fichier"
  fi
  echo "✅ Restauration terminée."
}

if [[ "${1:-}" == "--restaurer" ]]; then
  restaurer "${2:-}"
  exit 0
fi

suffixe=""
[[ "${1:-}" == "--avant-migration" ]] && suffixe="-avant-migration"

horodatage="$(date +%Y%m%d-%H%M%S)"
fichier="$DEST/assistants-$horodatage$suffixe.sql.gz"

echo "→ Sauvegarde de « $BASE » vers $fichier"
# --clean --if-exists : le dump peut être rejoué sur une base existante.
if ! compose exec -T "$SERVICE_DB" pg_dump -U "$UTILISATEUR" --clean --if-exists "$BASE" | gzip > "$fichier"; then
  rm -f "$fichier"
  echo "❌ Échec du pg_dump — aucune sauvegarde produite." >&2
  exit 1
fi

# --- Vérifications : une sauvegarde non vérifiée n'est pas une sauvegarde ---------------
taille=$(wc -c < "$fichier" | tr -d ' ')
if [[ "$taille" -lt "$TAILLE_MIN" ]]; then
  echo "❌ Sauvegarde suspecte : $taille octets (< $TAILLE_MIN). Fichier supprimé." >&2
  rm -f "$fichier"
  exit 1
fi
if ! gunzip -t "$fichier" 2>/dev/null; then
  echo "❌ Archive illisible. Fichier supprimé." >&2
  rm -f "$fichier"
  exit 1
fi
# Le dump doit contenir des créations de tables. On parcourt TOUT le fichier : avec
# --clean, pg_dump écrit d'abord des centaines d'instructions DROP, et se limiter aux
# premières lignes ferait rejeter une sauvegarde parfaitement valide.
nb_tables=$(gunzip -c "$fichier" | grep -c "^CREATE TABLE" || true)
if [[ "${nb_tables:-0}" -lt 1 ]]; then
  echo "❌ Aucune table dans le dump — contenu invalide. Fichier supprimé." >&2
  rm -f "$fichier"
  exit 1
fi

lisible=$(du -h "$fichier" | cut -f1)
echo "✅ Sauvegarde vérifiée : $fichier ($lisible, $nb_tables tables)"

# --- Rotation ---------------------------------------------------------------------------
# Les sauvegardes « avant migration » sont conservées à part : ce sont les plus précieuses.
nb=$(ls -1t "$DEST"/assistants-*.sql.gz 2>/dev/null | grep -v -- "-avant-migration" | wc -l | tr -d ' ')
if [[ "$nb" -gt "$RETENTION" ]]; then
  ls -1t "$DEST"/assistants-*.sql.gz | grep -v -- "-avant-migration" | tail -n +$((RETENTION + 1)) | while read -r vieux; do
    echo "   rotation : suppression de $(basename "$vieux")"
    rm -f "$vieux"
  done
fi
