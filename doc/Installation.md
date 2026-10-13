# Installation

## Prérequis

PostgreSQL 18 · Bun 1.3 · un client OIDC déclaré dans dex · un Open WebUI joignable.

## Secrets — où vit quoi, et pourquoi

Les instructions posent une règle absolue : aucun secret en variable d'environnement
claire. Elle souffre **deux exceptions, et seulement deux**. Les voici, écrites, parce
qu'une règle qu'on croit absolue et qui ne l'est pas est plus dangereuse qu'une règle dont
les exceptions sont connues.

| Secret | Où | Pourquoi pas en base |
|---|---|---|
| Clé maîtresse de chiffrement | `.secrets/settings.key`, mode 0600, engendrée au premier besoin | Elle protège précisément ce qui part dans les sauvegardes. L'y mettre reviendrait à livrer la serrure avec la porte. |
| Secret client OIDC | Variable `OUATE_CLIENT_SECRET` | `genericOAuth` lit sa configuration à l'initialisation du module, avant que la base soit joignable. |

**Tout le reste** — jeton de l'Open WebUI, jetons GitLab, identifiants Nextcloud — est
chiffré en base et se saisit dans l'interface de réglages.

> ⚠️ `.secrets/` doit être sauvegardé comme la base. Le perdre rend les jetons illisibles :
> ça coûte une ressaisie, pas un sinistre — ce ne sont pas des données métier.
> `SETTINGS_ENCRYPTION_KEY` permet de fournir la clé soi-même, pour la partager entre
> instances ou la gérer ailleurs.

## Mise en route — Docker

```bash
cp .env.example .env             # renseigner PUBLIC_URL, mot de passe, secret, client OIDC
mkdir -p .secrets backup
sudo chown 1001:1001 .secrets    # sous Linux : le conteneur tourne en uid 1001
docker compose up -d
docker compose run --rm seed     # compte de secours, mot de passe affiché UNE fois
```

L'application répond sur `http://localhost:8080` (ou `PUBLIC_URL`). Nginx est le seul
service exposé : le serveur, l'interface et la base ne sortent pas du réseau interne.

**PostgreSQL doit porter pgvector.** La composition utilise `pgvector/pgvector:pg18` et non
l'image nue : la colonne `passage.vecteur` en dépend, et avec l'image nue la première
migration échoue sur une erreur qui ne nomme pas l'image.

## Mise en route — développement

```bash
cp .env.example .env
bun install
bun run --filter @assistants/database migrate
bun run --filter @assistants/server seed
bun run dev
```

En développement l'interface et le serveur sont sur deux ports, donc deux origines : c'est
pourquoi `TRUSTED_ORIGINS` doit contenir l'adresse de l'interface. En production ils sont
derrière le même proxy et la question ne se pose pas.

## Déploiement en sous-chemin

L'application peut vivre sous `exemple.fr/assistant`. Trois variables, et une déclaration
côté dex :

```
PUBLIC_URL=https://exemple.fr
BASE_PATH=/assistant
OUATE_REDIRECT_URI=https://exemple.fr/assistant/api/auth/oauth2/callback/ouate
```

`OUATE_REDIRECT_URI` n'est **pas** facultative en sous-chemin. Le proxy retire le préfixe
avant d'atteindre le serveur, donc l'URL de rappel que Better Auth calculerait seul perdrait
le `/assistant` — et dex refuserait la redirection. Elle doit valoir **exactement** ce qui
est déclaré côté dex. À la racine, laisser la variable vide.

## Qui peut entrer

| Variable | Effet |
|---|---|
| `OUATE_GROUPE_ADMIN` | groupe qui confère le rôle administrateur (défaut `admins`) |
| `OIDC_ADMINS_SEULEMENT=true` | **les administrateurs seuls** — tout autre compte reçoit un 403 explicite |
| `OIDC_ADMINS_SEULEMENT=false` | tout membre du groupe déclaré dans le réglage `instance.groupe_sso` |

`OIDC_ADMINS_SEULEMENT` est le réglage d'une phase d'essai : on vérifie ce que l'assistant
répond avant de l'ouvrir à l'équipe.

**En variable d'environnement et non en réglage de base**, délibérément. Un réglage qui
décide *qui peut se connecter*, modifiable depuis l'application, se retourne mal : une
fausse manœuvre ouvre l'accès et personne ne s'en aperçoit. L'environnement demande un
redéploiement, ce qui est le bon niveau de friction pour cette décision.

Le compte de secours est administrateur : il passe dans tous les cas, y compris quand
`instance.groupe_sso` est vide. C'est la porte de service pour aller configurer l'instance.

## Indexation

Le service `synchro` de la composition relance un processus COURT toutes les 30 minutes.
Ce n'est pas une commodité : le binaire indexe, meurt, et rend sa mémoire. Une tâche dans
le serveur emporterait l'interface à chaque pic d'extraction — et sur cette machine, dont
le swap est saturé, peut-être GitLab avec. Voir [Exploitation-MCO](Exploitation-MCO.md).

`SYNCHRO_PERIODE` est la période de RÉVEIL, pas la fréquence d'indexation : le binaire
consulte `synchro.intervalle_h` en base et ne fait rien s'il est trop tôt. La fréquence se
règle dans l'interface.

Hors Docker, la même chose en cron :

```
17 */6 * * *  cd /opt/assistants && bun run --filter @assistants/server synchro >> /var/log/assistants-synchro.log 2>&1
```

## Premier démarrage

1. Se connecter avec le compte de secours.
2. Réglages → **Modèle** : adresse de l'Open WebUI, jeton, puis choisir les deux modèles
   **dans la liste** — elle se charge depuis l'API, on ne saisit jamais un identifiant à la
   main.
3. Réglages → **Instance** : renseigner `instance.groupe_sso`.
   **Tant qu'il est vide, aucune connexion SSO n'est acceptée.** C'est voulu : une instance
   déployée mais pas configurée doit être inutilisable, pas ouverte à tous.
4. Vérifier avec `POST /api/reglages/tester`.

## Déployer une seconde instance

Aucune ligne de code. Une base, un client OIDC, et les réglages de portée `instance` — la
liste est dans [Reglages.md](Reglages.md), section « Ce qui distingue deux instances ».

**N'activer sur une instance que les sources qui la concernent.** Dès lors que les sources
sont lues par des comptes de service à lecture totale, la frontière d'instance est la seule
chose qui sépare deux publics : il n'y a pas de filtrage par utilisateur à l'intérieur d'un
index.
