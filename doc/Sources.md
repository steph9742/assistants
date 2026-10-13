# Sources

Ce qui s'indexe, ce qui ne s'indexe pas, et pourquoi.

Les sources sont déclarées dans l'application, pas dans le code : type de connecteur,
adresse, compte de service, dossiers retenus, catégorie d'autorité. Les types disponibles et
leurs champs sont dans [Connecteurs.md](Connecteurs.md).

## Exclure par chemin ET par statut — les deux sont nécessaires

Un corpus de procédures porte des documents périmés, et ils se signalent de deux façons
indépendantes : rangés dans un dossier d'archive, ou marqués `statut: obsolete` dans leur
en-tête. **Un seul des deux filtres ne suffit pas** — un document obsolète qui vit hors du
dossier d'archive passerait, et c'est le cas le plus courant, parce que personne ne déplace
un fichier en même temps qu'il change son statut.

S'y ajoutent deux exclusions structurelles :

- **les fichiers de configuration locale** d'un dépôt, qui portent les valeurs réelles et
  les secrets ;
- **l'historique Git** : on indexe la révision courante, jamais les commits antérieurs,
  faute de quoi on réindexerait ce qu'une réécriture d'historique a retiré.

## Ce qui ne s'indexe jamais

**Un coffre de mots de passe.** Les *procédures* qui décrivent son usage appartiennent au
corpus et y restent ; son contenu n'entre nulle part.

**Un historique de conversation.** Forte densité de données personnelles, forte surface
d'injection, faible densité de signal — les trois raisons vont dans le même sens.

**Un partage fédéré entrant.** Quiconque écrit dans un partage peut y déposer un document
empoisonné, et la fédération élargit ce « quiconque » hors de l'établissement.

**Ce qu'une source de données expose déjà.** Un inventaire de machines lu par deux chemins
donne deux vérités dont la plus ancienne a l'air aussi vraie que l'autre. Quand une
application métier publie la donnée normalisée, on l'interroge au moment de la question au
lieu de l'indexer.

## Catégories d'autorité

Chaque source porte une `categorie`, qui décide du nombre de places qu'elle peut occuper
parmi les passages retenus. C'est ce qui **inscrit le tableau d'autorité dans la mécanique**
au lieu de l'espérer du classement.

| Rang | Catégorie | Ce que la source dit | Plafond |
|---|---|---|---|
| 0 | `juridique` | les textes qui fondent les obligations | **aucun** |
| 1 | `procedure` | ce qu'il faut **faire** — le corpus maison | aucun |
| 2 | `exploitation` | comment on exploite ses propres outils | aucun |
| 3 | `equipe` | notes et listes de l'équipe | 2 |
| 4 | `produit` | comment un produit fonctionne — documentation éditeur | 2 |
| 5 | `bonne_pratique` | guides et référentiels externes | 2 |

Le rang ne sert pas qu'au plafond : il décide **qui a raison** quand deux passages se
contredisent. Entre rangs égaux, l'outil signale la divergence et ne tranche pas — une note
d'équipe qui contredit une procédure, c'est quelque chose qu'un humain doit arbitrer. Entre
rangs différents, il dit lequel l'emporte.

`juridique` n'est délibérément pas plafonnée : la plafonner reviendrait à écarter du contexte
ce qui a raison. Et pour cette catégorie seule, **la citation est verbatim ou rien** — un
texte de loi paraphrasé n'est pas plus faible, il est faux.

Un plafond de `0` fait exception et veut dire **jamais** : c'est la façon d'écarter une
catégorie d'une instance sans supprimer la source.

### Pourquoi un plafond sur la documentation éditeur

Une documentation produit pèse couramment plusieurs milliers de pages contre quelques
dizaines de fiches pour un corpus maison. Indexée sans plafond, elle occupe les deux tiers
des passages retenus et remonte en tête sur des questions qui n'ont rien à voir avec elle —
non parce qu'elle répond mieux, mais parce qu'elle est plus nombreuse.

Mesuré sur un corpus réel, à six passages retenus :

| Question | Sans plafond | Avec `produit: 2` |
|---|---|---|
| « comment réinitialiser un mot de passe ? » | six passages éditeur, la procédure absente | la procédure retenue |
| « que faire en cas de rançongiciel ? » | la fiche d'incident absente | la fiche et sa grille retenues |
| « comment écrire une règle de détection ? » | six passages éditeur | **six passages éditeur** |

La dernière ligne est le point important : le plafond **protège les procédures là où elles
existent, il ne rationne pas la référence quand elle est seule à répondre.** Une question
qui porte vraiment sur le produit reçoit toujours tous ses passages.

### Deux exclusions qui se mesurent

**Les notes de version.** Chaque fichier énumère toutes les fonctionnalités touchées par une
version : ils mentionnent tout et n'expliquent rien. Sans cette exclusion, « notes de mise à
jour » sort en tête sur une question qui porte sur un moteur précis, devant la page qui le
décrit.

**Les commentaires de tête identiques.** Une documentation exportée en porte souvent un
identique sur chacun de ses fichiers. Indexé, il ajoute les mêmes mots partout et fausse la
fréquence des termes qu'il contient : il est retiré à l'indexation.
