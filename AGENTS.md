# AGENTS.md — conventions et règles du projet

## Mission

Deux assistants qui lisent et répondent : l'un sur un corpus de procédures indexé et sur les
données vivantes d'applications métier, l'autre sur un extrait de journal collé.

## Les sept règles qui ne se négocient pas

Elles priment sur le confort et sur la performance. Si un lot ne peut pas se faire en les
respectant, il ne se fait pas.

1. **Aucune action.** Lire et répondre. Aucun outil ayant un effet. C'est la protection
   principale contre l'injection indirecte : un passage empoisonné ne peut produire qu'une
   réponse trompeuse, jamais une action. Ne se relâche pas au motif que « ce serait pratique ».
2. **Droits en lecture seule.** Comptes de service en lecture pour toutes les sources. La
   séparation entre instances repose sur la **frontière d'instance** : chaque instance ne
   reçoit que les sources qui la concernent, et le code est le même partout.
3. **Tout contenu récupéré est non fiable.** Passages d'index, résultats d'API, texte collé :
   encadrés et étiquetés comme données, jamais comme consignes. Voir `blocNonFiable()` dans
   `utils/ia.ts`, y compris la réinjection encadrée à chaque tour de conversation.
4. **Citer, jamais paraphraser.** Chaque affirmation porte sa source : document, section,
   lien, date de révision — **et le statut**, un brouillon ne valant pas une procédure
   validée.
5. **Savoir dire « ce n'est pas écrit ».** C'est la réponse la plus précieuse : elle désigne
   un trou dans la documentation. Journalisée (question, date, sources consultées) sans la
   réponse : c'est la file de rédaction documentaire.
6. **Jamais de réponse générique servie comme une procédure maison.** Une réponse tirée de
   la connaissance générale du modèle est étiquetée comme telle. Sur un outil interne, si ce
   n'est pas dans la documentation, la réponse est la règle 5.
7. **Toute sortie porte son origine.** Modèle, et **empreinte du prompt réellement envoyé**
   — pas une constante à incrémenter à la main. Quand plusieurs modèles concourent à une
   réponse (orientation, reformulation, rédaction), chacun est nommé.

### Deux corollaires

- **Le modèle ne calcule ni ne compte jamais.** Trier et dénombrer sont des opérations
  exactes. Le modèle choisit une question déclarée, l'application l'exécute, la réponse
  affiche le résultat **et la requête exécutée**. Une addition écrite dans une réponse est
  recalculée par le code.
- **L'outil ne corrèle pas.** Il interroge et affiche. Aucune jointure entre systèmes qu'il
  calculerait lui-même.

## Tout doit être réglable et documenté

Un **registre de réglages typé** est la source unique de vérité : clé, type, défaut, chiffré
ou non, portée, description. Le code lit le registre, l'interface d'administration se
construit depuis le registre, et **`doc/Reglages.md` en est engendré**.

`bun run doc:verifier` compare les fichiers engendrés aux fichiers commités et échoue s'ils
divergent : la documentation ne peut pas dériver du code.

« Tout réglable » ne veut pas dire tout en base sans défaut. Ça veut dire **aucun nombre
magique enterré dans une fonction**.

## Architecture

Monorepo Turborepo, gestionnaire de paquets **Bun**.

### Frontend (Nuxt 4) — `apps/app`
- **TailwindCSS uniquement** (CSS réservé aux `<Transition>`).
- Design atomique : formulaires, cartes, listes en composants séparés.
- Chaque appel API passe par le composable `useApi`.

### Backend (ElysiaJS) — `apps/server`
- Requêtes base de données via l'util `db` **uniquement**.
- Validation via TypeBox ; `createInsertSchema` pour dériver les types Drizzle.
- Auth via la macro `auth` (`user`, `admin`, `svc`).
- Chaque sous-route est un routeur importé dans `src/index.ts`.
- **La synchronisation ne tourne pas dans le processus de l'API** : script court lancé par
  cron, concurrence bornée, plafond de taille de fichier, limite mémoire explicite. Un pic
  d'extraction non borné ne doit pas pouvoir emporter l'API ni ses voisins sur la machine.

### Paquets
`@assistants/database` (Drizzle) · `@assistants/auth` (Better Auth, OIDC) ·
`@assistants/ui` (shadcn-vue) · `@assistants/eden` (client typé).

## Méthode

- **Une branche par lot, une merge request par lot.**
- **En cas de doute, ne pas deviner.** Noter la question avec le fichier et la ligne.
- **Aucun secret en clair.** Réglages sensibles chiffrés en base (`utils/secrets.ts`). Deux
  exceptions documentées : la clé maîtresse du chiffrement, et le secret client OIDC — lu à
  l'initialisation du module, avant que la base soit joignable.
- **Un contrôle qu'on n'a jamais vu échouer n'est pas une information.** Introduire une
  faute exprès et vérifier que le contrôle la voit.
- **Une mise en garde qui ferme sans ouvrir n'est pas prudente.** Toute règle qui interdit
  doit dire ce qui reste permis, dans la même phrase. Un refus est aussi une réponse fausse,
  simplement une qui a l'air prudente.

## Commentaires

Un commentaire dit **pourquoi**, pas quoi. Il tient en un paragraphe. Il ne raconte pas
l'enquête qui l'a produit, ne porte pas de date, et ne cite aucune donnée réelle
d'exploitation.
