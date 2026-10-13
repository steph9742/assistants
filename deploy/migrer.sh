#!/usr/bin/env bash
# Applique les migrations APRÈS avoir pris une sauvegarde vérifiée.
#
# Une migration est le moment le plus risqué de la vie d'une base : elle modifie la
# structure, parfois de façon non réversible. On ne la lance donc jamais sans filet.
# Si la sauvegarde échoue, la migration N'EST PAS exécutée.
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"

echo "1/2 — Sauvegarde préalable"
if ! ./deploy/sauvegarde.sh --avant-migration; then
  echo "❌ Sauvegarde impossible : migration ANNULÉE." >&2
  exit 1
fi

echo
echo "2/2 — Migrations"
docker compose run --rm migrate
