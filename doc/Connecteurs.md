# Connecteurs

> ⚠️ **Fichier engendré depuis `packages/database/src/registre/sources.ts`. Ne pas le modifier à la main.**
> `bun run doc:connecteurs` le régénère ; l'intégration continue échoue s'il diverge.

Ce que chaque type de source demande pour fonctionner. Tout se saisit dans l'écran
**Sources**, rien ne se met dans un fichier de configuration.

Deux natures, et la différence est de fond :

| Nature | Ce qui se passe |
|---|---|
| `index` | les documents sont découpés et rangés dans l'index, puis cherchés |
| `donnees` | la source est interrogée **au moment de la question**, jamais indexée |

On n'indexe pas un incident : une donnée vivante recopiée dans un index est fausse dès
la minute suivante, et elle a l'air aussi vraie que les autres.

---

## Dépôt GitLab

`gitlab` · nature **index** · catégorie par défaut `exploitation`

Lit les fichiers Markdown d'un dépôt, à HEAD. Sert le corpus de procédures, les dossiers de référence, et les `doc/` des dépôts d'application.

### Jeton d'accès

Jeton de projet ou de groupe, portée `read_repository` ou `read_api`. Chiffré en base.

> ⚠️ Un jeton de GROUPE sur `ssi/` couvre les cinq dépôts d'un coup — un jeton par projet multiplie les rotations à faire.

### Champs

| Champ | Type | Obligatoire | Défaut |
|---|---|---|---|
| `base` | texte | **oui** | — |
| `projet` | texte | **oui** | — |
| `ref` | texte | non | `main` |
| `dossiers` | liste, séparée par des virgules | **oui** | — |
| `exclusions` | liste, séparée par des virgules | non | `_archive/,sortie/,_gabarits/,_outils/` |
| `mentions` | liste, séparée par des virgules | non | — |

**Adresse du GitLab** — `base`

Racine de l'instance, sans `/api/v4`.

Exemple : `https://gitlab.example.org`

**Chemin du projet** — `projet`

Chemin complet, espace de noms compris.

Exemple : `ssi/documentation`

> ⚠️ Le chemin CANONIQUE, jamais une redirection. GitLab redirige après un transfert de projet, mais la redirection saute dès que quelqu'un recrée un projet à l'ancien chemin.

**Branche** — `ref`

On n'indexe que la tête de cette branche. Jamais l'historique : le corpus a été nettoyé par `git filter-repo`, et parcourir les commits antérieurs réintroduirait dans l'index exactement ce qui en a été retiré.

**Dossiers à lire** — `dossiers`

Une même source ne lit que ces dossiers. Déclarer plusieurs sources sur un même dépôt permet de donner des autorités différentes à des dossiers différents.

Exemple : `incidents,outils,quotidien,annexes,validation`

**Chemins exclus** — `exclusions`

Dossiers jamais lus. Un chemin est exclu s'il traverse l'un d'eux.

> ⚠️ Les fichiers `.local.md` sont TOUJOURS exclus, quelle que soit cette liste : ils portent les valeurs réelles, secrets et configuration d'IdP. Ils sont déjà ignorés par Git ; le filtre existe pour le jour où l'un serait commité par accident, qui est exactement le jour où il ne faut pas qu'un assistant le recopie.

**Mentions par chemin** — `mentions`

Phrases qu'une réponse citant ces documents doit porter, sous la forme `chemin|phrase`. Le chemin est un préfixe.

Exemple : `docs/reprise.md|Cette procédure doit exister sur papier, hors des deux machines.`

> ⚠️ Écrite ici et non dans la consigne du modèle : une consigne se réécrit dans les réglages, une mention attachée au document le suit partout.

---

## Nextcloud — dossier de fichiers

`nextcloud_fichiers` · nature **index** · catégorie par défaut `equipe`

Lit un dossier par WebDAV et suit ses changements par jeton de synchronisation. Les documents n'ont pas d'en-tête : le titre vient du premier `#` ou du nom de fichier, et il n'y a pas de statut.

### Mot de passe d'application

Créé dans Nextcloud sous Paramètres → Sécurité. Chiffré en base.

> ⚠️ Un MOT DE PASSE D'APPLICATION, jamais celui du compte : il se révoque seul et n'ouvre pas l'interface web.

### Champs

| Champ | Type | Obligatoire | Défaut |
|---|---|---|---|
| `base` | texte | **oui** | — |
| `compte` | texte | **oui** | — |
| `dossier` | texte | **oui** | — |
| `exclusions` | liste, séparée par des virgules | non | `_archive/` |
| `refuser_federes` | oui / non | non | `true` |
| `taille_max` | nombre | non | `20000000` |
| `mentions` | liste, séparée par des virgules | non | — |

**Adresse du Nextcloud** — `base`

Racine de l'instance, sans `/remote.php`.

Exemple : `https://nextcloud.example.org`

**Compte de service** — `compte`

Le compte avec lequel le dossier est lu. Il doit avoir le partage en LECTURE SEULE : pas de repartage, pas de suppression.

Exemple : `assistant-lecture`

> ⚠️ C'est la seule barrière qui garantisse la règle 1 côté Nextcloud, indépendamment de notre code.

**Dossier à lire** — `dossier`

Chemin depuis la racine du compte. Vide = tout ce que le compte voit.

Exemple : `Equipe`

**Chemins exclus** — `exclusions`

Dossiers jamais lus.

> ⚠️ `_archive/` est la convention qui REMPLACE le champ `statut` : un document Nextcloud n'a pas d'en-tête, donc le filtre « obsolète » ne peut pas s'y appliquer. Sans ce dossier, une note d'équipe périmée reste indéfiniment retournable.

**Refuser les partages fédérés entrants** — `refuser_federes`

Écarte les documents venus d'un partage fédéré.

> ⚠️ Quiconque écrit dans un dossier partagé peut y déposer un document empoisonné ; un partage fédéré élargit ce « quiconque » hors de l'établissement.

**Taille maximale d'un fichier** — `taille_max`

Au-delà, le fichier est ignoré et signalé. L'extraction de texte est le poste à pics mémoire, et elle dépend de fichiers déposés par des tiers.

**Mentions par chemin** — `mentions`

Phrases qu'une réponse citant ces documents doit porter, sous la forme `chemin|phrase`. Le chemin est un préfixe.

Exemple : `docs/reprise.md|Cette procédure doit exister sur papier, hors des deux machines.`

> ⚠️ Écrite ici et non dans la consigne du modèle : une consigne se réécrit dans les réglages, une mention attachée au document le suit partout.

---

## Nextcloud — tâches partagées

`nextcloud_taches` · nature **donnees** · catégorie par défaut `equipe`

Lit une liste de tâches par CalDAV, AU MOMENT DE LA QUESTION.

### Mot de passe d'application

Le même que pour les fichiers, ou un autre. Chiffré en base.

### Champs

| Champ | Type | Obligatoire | Défaut |
|---|---|---|---|
| `base` | texte | **oui** | — |
| `compte` | texte | **oui** | — |
| `liste` | texte | **oui** | — |

**Adresse du Nextcloud** — `base`

Racine de l'instance.

Exemple : `https://nextcloud.example.org`

**Compte de service** — `compte`

Le même compte que pour les fichiers, en principe.

**Liste de tâches** — `liste`

Identifiant du calendrier qui porte les tâches.

Exemple : `cellule-cyber`

> ⚠️ Non indexée volontairement : quelques centaines d'entrées se relisent en entier à la question, et ça supprime le cas où une synchronisation de six heures sert une tâche fermée le matin comme si elle était ouverte.

---

## Catalogue — données vivantes

`catalogue` · nature **donnees** · catégorie par défaut `donnees`

Interroge le Catalogue au moment de la question, selon son contrat de lecture. Rien n'est indexé.

### Clé de service

Clé `sk_…`, portée `read`. Chiffrée en base.

> ⚠️ La portée du compte de service est DÉCLARÉE côté Catalogue : une clé sans `read` ni `cat:<clé>` ne lit rien. À vérifier avant la première mise en service.

### Champs

| Champ | Type | Obligatoire | Défaut |
|---|---|---|---|
| `base` | texte | **oui** | — |

**Adresse du Catalogue** — `base`

Racine publique. Le contrat de lecture est servi sur `/openapi`.

Exemple : `https://catalogue.example.org`

---

## Sniff — incidents

`sniff` · nature **donnees** · catégorie par défaut `donnees`

Interroge Sniff au moment de la question. Rien n'est indexé : un incident recopié dans un index est faux dès la minute suivante.

### Clé de service

Clé `sk_…` en lecture. Chiffrée en base.

### Champs

| Champ | Type | Obligatoire | Défaut |
|---|---|---|---|
| `base` | texte | **oui** | — |
| `version_minimale` | texte | non | `72d3857` |
| `date_minimale` | texte | non | — |

**Adresse de Sniff** — `base`

Racine publique. Le contrat de lecture est servi sur `/openapi`.

Exemple : `https://sniff.example.org`

**Version minimale exigée** — `version_minimale`

Commit comparé à celui que rend `/health`. Une correspondance exacte suffit à valider.

> ⚠️ Deux abrégés de commit NE SE COMPARENT PAS : ce sont des empreintes, pas des numéros. Ce champ ne sert donc qu'à reconnaître une version, pas à en ordonner deux. C'est « Date minimale » qui tranche.

**Date minimale de construction** — `date_minimale`

Comparée à `construitLe`, que `/health` rend depuis la version 72d3857 de Sniff.

Exemple : `2026-01-15`

> ⚠️ C'est ce champ qui permet à l'avertissement de version de se lever tout seul. Avant lui, l'assistant ne pouvait que signaler une différence entre deux empreintes de commit sans pouvoir dire laquelle était la plus récente — un avertissement vrai et inutile, qui restait affiché. `construitLe: null` ne veut PAS dire « antérieure » : c'est une image bâtie sans l'argument, ce qu'une image récente montée à la main porte aussi. Ce que les versions antérieures à 72d3857 coûtent : la pagination des incidents n'est pas fiable, et le décompte peut ne pas compter ce que la liste montre.
