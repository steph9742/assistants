# Brancher une source de données

Une source de données est une application métier que l'assistant interroge **au moment de la
question**, sans rien indexer. Un incident recopié dans un index est faux dès la minute
suivante, et il a l'air aussi vrai que les autres.

Pour qu'il puisse l'interroger sans se tromper, la source publie un **contrat de lecture**
sur un point d'entrée unique — `GET /api/lectures` — lu une fois par session. Ce document
décrit ce que ce contrat porte, et ce que chaque bloc empêche.

Le principe qui les gouverne tous : **une valeur acceptée n'est pas une valeur comprise.**
Un champ se lit, se filtre et se compte sans que rien n'indique ce qu'il signifie. C'est en
produisant une réponse fausse qu'on découvre la différence — sauf si la source l'a écrit.

## `vocabulaires` — les valeurs fermées et leur sens

```jsonc
{
  "cle": "technologie.eolStatut",
  "champ": "eolStatut",
  "applicable": true,
  "valeurs": [
    { "valeur": "ok",       "signifie": "Support en cours, échéance connue et à plus d'un an." },
    { "valeur": "supporte", "signifie": "Aucune date de fin n'existe et la source le CONFIRME. Distinct de `inconnu`." },
    { "valeur": "inconnu",  "signifie": "Personne ne sait. Ne signifie PAS que la technologie est maintenue." }
  ]
}
```

`signifie` est la moitié qui compte. Deux valeurs peuvent dire « ça va » sans être
interchangeables, et leurs noms ne le laissent pas deviner. Une réponse qui présente l'une
pour l'autre est juste sur le chiffre et fausse sur la conclusion.

**`applicable: false` quand le nom du champ est un homonyme.** `statut`, `source`, `type`,
`conformite` sont portés par plusieurs tables avec des vocabulaires différents. Le contrôle
de fraîcheur — « cette valeur n'est pas dans la liste, donc mon catalogue est périmé » — ne
peut alors pas s'appliquer sur le nom nu : `ailleurs` dit où le nom est repris, `discriminer`
à quelle condition le contrôle vaut.

Une lecture publiée sur un vocabulaire non applicable ne sera **pas** relayée
automatiquement. Si elle compte, elle doit aussi vivre dans une mise en garde attachée à la
question.

## `lectures` — ce qu'un couple (champ, valeur) ne prouve pas

```jsonc
{
  "cle": "certificat-lu-nest-pas-valide",
  "champ": "dernierStatut", "valeur": "ok",
  "signifie": "La lecture du certificat a abouti.",
  "neSignifiePas": "Que le certificat est valide — un certificat expiré se lit parfaitement.",
  "consequence": "Ne jamais conclure à la validité depuis ce champ.",
  "ouCorriger": null
}
```

Appliqué à n'importe quelle profondeur de la charge utile : dès que le couple apparaît, la
mise en garde part avec la réponse. `neSignifiePas` est le champ le plus utile du contrat —
c'est celui qu'aucun schéma ne porte.

## `champsCalcules` — ce qu'on ne peut pas faire d'un champ présent

```jsonc
{
  "champs": ["eolStatut"],
  "calcule": "sql",
  "filtrable": "?eolStatut= (valeur hors vocabulaire refusée en 422)",
  "compte": "/api/eol/etat",
  "piege": "Une clé non encore calculée rend `null` — ce n'est PAS « inconnu », c'est « pas encore évalué »."
}
```

Un champ calculé à la lecture existe, se lit, et ne se filtre ni ne se compte pas forcément.
Rien dans une réponse ne distingue un champ porté par une colonne d'un champ posé après coup.

`filtrable: false` interdit de s'en servir comme critère ; `compte: false` interdit de le
dénombrer, **y compris sur une page complète**. Une chaîne à la place de `false` dit où la
question se pose.

L'assistant ne relaie que ce qui change la lecture d'un chiffre. La recette de filtrage et le
langage du calcul s'adressent au client, pas au lecteur de la réponse.

## `partitions` — les blocs de compteurs, et ce qu'ils comptent

```jsonc
{
  "route": "/api/eol/etat", "chemin": "resume",
  "vocabulaire": "technologie.eolStatut",
  "cles": ["machinesDepassees", "machinesOk", "…"],
  "alias": { "machinesDepassees": "depasse", "machinesOk": "ok" },
  "nul": null,
  "population": "fiches d'inventaire portant un système",
  "note": "Un total de fiches n'est pas un nombre de machines physiques."
}
```

Le motif que ce bloc ferme : **n valeurs déclarées, n−k compteurs écrits, et rien pour
rapprocher les deux.** Aucune erreur, aucun essai rouge — juste une catégorie absente de la
réponse, qui ne se découvre qu'en sommant les lignes reçues, c'est-à-dire en faisant
exactement ce que le contrat interdit.

| Champ | Ce qu'il empêche |
|---|---|
| `cles` | une catégorie manquante passe inaperçue — dérivez-les du vocabulaire, ne les recopiez pas |
| `alias` | `machinesDepassees` et `depasse` ne se ressemblent par aucune mesure : sans lui, aucun rapprochement n'est possible |
| `nul` | sans le compteur des valeurs nulles, la somme des parts ne fait pas le total |
| `population` | deux partitions du même vocabulaire sur des populations différentes rendent des nombres différents, et ce n'est **pas** un défaut |
| `note` | le vocabulaire dit ce que valent les clés, jamais ce que comptent les valeurs |
| `sousPartition` | un croisement porte des objets, pas des nombres : les sommer n'échoue pas et ne veut rien dire |

**`population` est ce qui rend un écart décidable.** Même population, les nombres doivent
concorder et un écart est une régression. Populations différentes, aucun rapprochement n'est
à faire. Une note en prose ne suffit pas : deux notes disant « MACHINES » laissent la
question ouverte.

Le bloc sert aussi de **marqueur de version**, ce qui permet de dater un déploiement depuis
l'extérieur : une partition listée ici et absente de la réponse correspondante est une
régression ; absente des deux, la version déployée ne la porte pas encore.

## `ventilations` — les axes vers un référentiel

```jsonc
{
  "route": "/api/parc/resume", "chemin": "serveurs.parComposante",
  "axe": "/api/composantes"
}
```

Une ventilation n'est **pas** une partition : son axe est un référentiel, pas un vocabulaire
fermé. Ses valeurs changent sans déploiement, et exiger une liste complète ferait rougir un
contrôle à chaque création d'une entrée du référentiel — c'est-à-dire pour un événement
parfaitement normal.

`axe` donne le point d'entrée qui énumère les valeurs : une valeur absente d'une ventilation
s'y lit « zéro », jamais « inconnue ». Et `sansRattachement`, dans la réponse, compte les
lignes que l'axe ne classe pas — sans lui, additionner les entrées rend un total plus petit
que le total.

## `filtres` — ce qui est réellement filtrable

```jsonc
{
  "catalogue": "serveurs", "prefix": "/api/serveurs",
  "filtres": [
    { "champ": "type",         "nature": "vocabulaire", "valeurs": ["vm", "physique"] },
    { "champ": "composanteId", "nature": "referentiel", "axe": "/api/composantes" },
    { "champ": "ramGo",        "nature": "nombre" }
  ],
  "commentCroiser": "Combiner en ET dans un seul appel ; le total devient celui du croisement.",
  "neJamaisFaire": "Ne jamais multiplier deux proportions pour estimer un croisement."
}
```

Cinq natures : `vocabulaire` (valeurs énumérées ici), `referentiel` (voir `axe`), `booleen`,
`nombre`, `texte`, `date`. `champ` est le nom exact du paramètre de requête.

Un axe `referentiel` attend un **identifiant**, pas un libellé. Et les filtres **se combinent
en ET** dans un seul appel : si le `where` sert à la fois la page et le décompte, le `total`
est le croisement exact, compté par la base. C'est meilleur qu'un tableau croisé
pré-calculé — il répond à la combinaison que l'appelant a en tête.

Deux réserves que l'assistant applique de lui-même : un filtre de **texte libre** n'est pas
proposé au modèle, parce que son total compte une correspondance de chaîne variable avec la
formulation ; et un filtre demandé mais **non appliqué** est annoncé dans la réponse, faute
de quoi un total non filtré passerait pour un décompte filtré.

## `garantie` — jusqu'où va la promesse

Chaque bloc déclare s'il est exhaustif, et par quel mécanisme. La distinction décide de ce
qu'on peut affirmer :

- **dérivé du code** — une énumération dont les valeurs ne compilent pas sans leur lecture,
  des colonnes lues à l'exécution. La liste ne peut pas être incomplète.
- **écrit à la main** — une partition ajoutée demain n'y figurera que si quelqu'un l'écrit.

Un consommateur qui affirme « cet axe n'existe pas sur cette table » hérite de cette
garantie. Quand elle est partielle, son affirmation devient fausse — et il n'a aucun moyen
de le vérifier de l'extérieur. **Dites-le franchement plutôt que de promettre trop** : un
contrat qui promet trop se corrige quand la réponse est fausse, un contrat qui promet trop
peu ne se découvre jamais.

## `/api/lacunes` — les angles morts, consultés AVANT la donnée

Le point d'entrée le plus important du contrat, et celui qu'on oublie de rendre obligatoire.
Toute réponse confronte ses domaines déclarés à ce point d'entrée.

```jsonc
{
  "domainesConnus":   ["parc", "certificats", "…"],
  "domainesExamines": ["parc", "certificats"],
  "resultats": [
    { "domaine": "parc", "gravite": "partiel",
      "unite": "fiches", "combien": 31, "sur": 8900, "depuis": null,
      "pourquoi": "Des fiches sont des doublons ; les décomptes sont surévalués d'autant." }
  ]
}
```

**Trois listes, trois questions différentes.** Un domaine absent de `domainesConnus`
n'existe pas : c'est l'étiquette du consommateur qui est fausse. Connu mais absent de
`domainesExamines` : il est hors de la portée de la clé, et la réponse repose sur un
référentiel dont personne n'a vérifié qu'il est rempli. Examiné et sans lacune : tout va bien.

**`unite` n'est pas décorative.** `combien` a porté trois sens — des enregistrements, des
jours, et un booléen valant 1 — et le troisième est le plus dangereux parce que c'est le seul
qui ressemble à un décompte plausible. Une date de dernière collecte (`depuis`) ne peut pas
se confondre avec un décompte ; un délai logé dans un champ numérique, oui.

## Comment l'assistant vérifie tout ça

`synchro --essais-donnees` appelle chaque question déclarée et confronte la charge reçue aux
champs attendus. Il ne vérifie jamais le contenu, qui vit, mais la **forme** : un champ
renommé fait cesser une mise en garde de se déclencher, en silence, et la réponse sort
plausible et incomplète.

`synchro --lectures` rend le contrat tel qu'il est reçu — vocabulaires avec leurs valeurs et
leurs lectures, partitions avec leur population et leur note, champs calculés avec leur
piège. Un contrat qu'on ne peut pas relire se discute de mémoire, et c'est ainsi qu'on finit
par affirmer qu'un champ est une date alors qu'il est un booléen.
