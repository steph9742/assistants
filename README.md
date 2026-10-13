# Assistants IA — corpus de procédures et données vivantes

Deux assistants qui **lisent et répondent**. Ils n'écrivent dans aucun système, ne
déclenchent rien, ne qualifient rien.

Publié par la **cellule cyber de l'Université Marie et Louis Pasteur** (UMLP), sous licence
MIT.

| | Ce que c'est |
|---|---|
| **Assistant** | Questions sur un corpus de procédures indexé, et sur les données vivantes des applications métier |
| **Analyse de journaux** | On colle un extrait de journal, l'outil explique ce que c'est. Rien n'est conservé |

## Ce qui distingue cet outil

**Il cite, il ne paraphrase pas.** Chaque affirmation porte son document, sa section, son
lien, sa date de révision — et son statut, parce qu'un brouillon ne vaut pas une procédure
validée.

**Il sait dire « ce n'est pas écrit ».** C'est la réponse la plus utile : elle désigne un
trou dans la documentation. Elle est journalisée sans la réponse, et cette liste devient la
file de rédaction documentaire.

**Le modèle ne calcule ni ne compte.** Trier et dénombrer sont des opérations exactes. Le
modèle choisit une question déclarée, l'application l'exécute, et la réponse affiche le
résultat **avec la requête employée**. Une addition écrite dans une réponse est recalculée
par le code avant affichage.

**Tout contenu récupéré est traité comme non fiable.** Passages d'index, réponses d'API,
texte collé : encadrés et étiquetés comme données, jamais comme consignes. C'est la
protection principale contre l'injection indirecte — un passage empoisonné ne peut produire
qu'une réponse trompeuse, jamais une action.

**Toute sortie porte son origine.** Le modèle employé, et l'empreinte du prompt réellement
envoyé — pas un numéro de version à incrémenter à la main. Deux réponses de même empreinte
ont été produites avec la même consigne.

## Pile technique

Monorepo **Turborepo** géré avec **Bun**.

- **Frontend** — Nuxt 4 + Tailwind CSS (`apps/app`)
- **Backend** — ElysiaJS sur Bun, API typée exposée au front via Eden Treaty (`apps/server`)
- **Base de données** — PostgreSQL + pgvector, Drizzle ORM (`packages/database`)
- **Auth** — Better Auth : SSO OIDC + compte de secours, comptes de service (`packages/auth`)
- **Recherche** — plein texte PostgreSQL en trois zones, et vecteurs facultatifs

L'indexation tourne dans un **processus séparé**, lancé par cron, avec concurrence bornée et
plafond mémoire. Un pic d'extraction sur un gros PDF ne doit pas emporter l'API.

## Documentation

| Document | Pour qui |
|---|---|
| [`doc/Installation.md`](doc/Installation.md) | Installation — secrets, Docker, sous-chemin, SSO |
| [`doc/Reglages.md`](doc/Reglages.md) | Admins — ce que fait chaque réglage. **Engendré depuis le registre** |
| [`doc/Connecteurs.md`](doc/Connecteurs.md) | Les types de source et leurs champs. **Engendré depuis les descripteurs** |
| [`doc/Sources.md`](doc/Sources.md) | Ce qui est indexé, ce qui ne l'est pas, et pourquoi |
| [`doc/Contrat-de-lecture.md`](doc/Contrat-de-lecture.md) | Brancher une source de données — ce qu'elle doit publier |
| [`doc/Documentation.md`](doc/Documentation.md) | Technique — le chemin d'une réponse, la recherche |
| [`doc/Exploitation-MCO.md`](doc/Exploitation-MCO.md) | Ops — synchronisation, mises à jour, pièges connus |

## Commandes

```bash
bun install
bun run dev          # front + back
bun run build
bun run typecheck
bun run lint
bun test             # essais unitaires
bun run doc:verifier # la doc engendrée ne doit pas diverger du code
```

```bash
bun run --filter @assistants/database generate   # migration depuis le schéma
bun run --filter @assistants/database migrate
bun run --filter @assistants/server   seed       # compte de secours
bun run --filter @assistants/server   synchro    # indexation (cron, PAS dans l'API)
```

## Déploiement

Via **Docker Compose**. Un service `migrate` applique la chaîne de migrations et le serveur
attend sa réussite — une migration qui échoue empêche le démarrage au lieu de laisser
tourner une application sur un schéma qu'elle ne comprend pas.

Voir [`doc/Installation.md`](doc/Installation.md), et
[`doc/Exploitation-MCO.md`](doc/Exploitation-MCO.md) pour les mises à jour.

## Généalogie

Le socle — client de modèle, chiffrement des réglages, connecteur GitLab,
authentification — est repris **par copie** de Slowpoke, plateforme
de gestion d'incidents publiée par la même cellule, jamais par dépendance.

---

Voir [`AGENTS.md`](AGENTS.md) pour les conventions d'architecture et les règles qui ne se
négocient pas.
