# Réglages de l'application

> ⚠️ **Fichier engendré depuis `packages/database/src/registre/`. Ne pas le modifier à la main.**
> Pour changer un libellé ou une description, changez le registre puis lancez `bun run doc:reglages`.
> L'intégration continue échoue si ce fichier diverge du registre.

Ce que fait chaque réglage **dans l'application**, une fois installée. Pour l'installation
elle-même — fournisseur OIDC, variables d'environnement, Docker — voir [Installation](Installation.md).

Un réglage absent de la base **n'est pas une valeur manquante** : c'est le défaut du registre
qui s'applique. Vider un champ revient donc à rétablir le défaut.

## Ce qui distingue deux instances

Un second déploiement — pour un autre public, par exemple — ne demande **aucune ligne de code**.
Seuls ces réglages changent, plus la liste des sources indexées :

- `instance.nom` — Nom de l'instance
- `instance.groupe_sso` — Groupe SSO autorisé
- `ia.contexte` — Contexte de l'établissement
- `audit.conserver_question` — Conserver le texte des questions

---

## Instance

| Réglage | Type | Défaut |
|---|---|---|
| `instance.nom` | texte | `Cellule Cyber` |
| `instance.groupe_sso` | texte | _vide_ |

### Nom de l'instance

`instance.nom` · texte · défaut `Cellule Cyber` · **portée instance**

Affiché dans l'interface. Sert à distinguer les déploiements quand plusieurs coexistent.

### Groupe SSO autorisé

`instance.groupe_sso` · texte · défaut _vide_ · **portée instance**

Seul groupe dont les membres peuvent se connecter. Avec la liste des sources indexées, c'est la SEULE chose qui distingue deux instances — le code est identique.

> ⚠️ Vide = personne ne peut se connecter hors compte de secours. C'est volontaire : une instance sans groupe déclaré ne doit pas être ouverte à tous.

## Modèle

| Réglage | Type | Défaut |
|---|---|---|
| `ia.base_url` | texte | _vide_ |
| `ia.jeton` | **secret** — chiffré en base | _vide_ |
| `ia.modele.assistant` | choisi dans la liste de l'API | _vide_ |
| `ia.modele.journaux` | choisi dans la liste de l'API | _vide_ |
| `ia.modele.orientation` | choisi dans la liste de l'API | _vide_ |
| `ia.modele.reformulation` | choisi dans la liste de l'API | _vide_ |
| `ia.temperature` | nombre | `0.1` |
| `ia.delai_ms` | nombre | `120000 ms` |
| `ia.delai_liste_ms` | nombre | `20000 ms` |
| `ia.contexte` | texte long | _vide_ |

### Adresse de l'Open WebUI

`ia.base_url` · texte · défaut _vide_

Racine de l'API compatible OpenAI. Les routes /api/… et /v1/… sont essayées l'une après l'autre, sans qu'il faille préciser laquelle.

### Jeton d'API

`ia.jeton` · **secret** — chiffré en base · défaut _vide_

Chiffré en base. Ne ressort jamais en clair par l'API : l'interface affiche seulement s'il est renseigné.

### Modèle — assistant cellule

`ia.modele.assistant` · choisi dans la liste de l'API · défaut _vide_

Tout se joue sur la recherche et la citation, et la latence compte en usage interactif. Mistral Small 3.2 24B convient.

> ⚠️ Choisi dans la liste chargée depuis l'API, jamais saisi à la main.

### Modèle — analyse de journaux

`ia.modele.journaux` · choisi dans la liste de l'API · défaut _vide_

Demande une connaissance de formats, d'identifiants d'événements et de syntaxes de règles. Usage ponctuel, la latence pèse moins. gpt-oss-120b convient.

### Modèle — orientation (facultatif)

`ia.modele.orientation` · choisi dans la liste de l'API · défaut _vide_

Choisit entre le corpus et les données vivantes, puis la question déclarée et ses paramètres. C'est une CLASSIFICATION dans un vocabulaire fermé : ce qui compte est la discipline, pas la finesse — un modèle qui « comprend mieux » a plus de latitude pour s'écarter du catalogue.

> ⚠️ Vide, l'orientation utilise le modèle de l'assistant. C'est l'étape la plus critique : une erreur de rédaction se voit, une erreur d'orientation envoie sur la mauvaise route et la réponse reste cohérente.

### Modèle — reformulation du fil (facultatif)

`ia.modele.reformulation` · choisi dans la liste de l'API · défaut _vide_

Transforme « et combien de Windows 10 ? » en question autonome, à la lumière de l'échange. Réécriture SOUS CONTRAINTE : un modèle qui infère trop y est un danger — c'est cette étape qui a substitué une composante à une autre, et rendu un chiffre exact pour la mauvaise entité.

> ⚠️ Vide, la reformulation utilise le modèle de l'assistant.

### Température

`ia.temperature` · nombre · défaut `0.1`

Basse volontairement : on veut une lecture fidèle, pas de la variété. Monter cette valeur dégrade directement la règle « n'invente rien ».

### Délai maximal de réponse

`ia.delai_ms` · nombre · défaut `120000 ms`

Au-delà, la demande est abandonnée. Un modèle local sur une machine chargée peut être lent sans être en panne.

### Délai — liste des modèles

`ia.delai_liste_ms` · nombre · défaut `20000 ms`

Plus court que le délai de réponse : lister les modèles est une opération immédiate, et l'écran de réglages ne doit pas se figer si l'adresse est fausse.

### Contexte de l'établissement

`ia.contexte` · texte long · défaut _vide_ · **portée instance**

Ajouté à la consigne système. Sert à nommer l'établissement et ses particularités, pas à y loger des procédures — celles-ci sont dans le corpus, avec leur version et leur date.

## Consignes

| Réglage | Type | Défaut |
|---|---|---|
| `ia.prompt.systeme` | texte long | _vide_ |
| `ia.prompt.assistant` | texte long | _vide_ |
| `ia.prompt.journaux` | texte long | _vide_ |
| `ia.prompt.hypotheses` | texte long | _vide_ |
| `ia.messages_gardes` | nombre | `10` |

### Consigne système commune

`ia.prompt.systeme` · texte long · défaut _vide_

Cadre partagé par les deux outils. Vide = la consigne par défaut du code s'applique.

> ⚠️ Le CONTRAT DE SORTIE n'est pas ici et reste ajouté par le code : une consigne mal réécrite doit dégrader la réponse, pas casser l'outil.

### Consigne — réponse ancrée

`ia.prompt.assistant` · texte long · défaut _vide_

Ce que l'assistant doit faire des passages retenus : citer, ne pas recopier, ne pas compter. Vide = consigne par défaut du code.

> ⚠️ Trois consignes NE sont PAS ici et restent dans le code, parce qu'elles sont calculées à partir de ce qui a été trouvé : la préséance entre sources d'autorités différentes, les mentions obligatoires attachées aux documents, et le contrat de sortie. Une consigne mal réécrite doit dégrader la réponse, pas défaire une règle.

### Consigne — analyse de journaux

`ia.prompt.journaux` · texte long · défaut _vide_

Ce que l'outil 3 doit faire d'un extrait collé. Vide = consigne par défaut du code.

### Consigne — hypothèses sur un extrait

`ia.prompt.hypotheses` · texte long · défaut _vide_

Ce que l'outil 3 doit proposer comme pistes, à côté de l'explication. Vide = consigne par défaut du code.

> ⚠️ Cette consigne est SÉPARÉE de « analyse de journaux », qui interdit de qualifier. La séparation est volontaire : une hypothèse assortie de ce qui la contredit n'est pas une qualification, et mêler les deux demandes dans une même consigne diluerait l'interdiction.

### Messages conservés dans un fil

`ia.messages_gardes` · nombre · défaut `10`

Questions ET réponses confondues : dix font cinq échanges. Au-delà, les passages cités sortent du contexte d'un modèle local, qui se met à répondre de mémoire générale en gardant le même aplomb. On préfère perdre le début du fil.

## Analyse de journaux

| Réglage | Type | Défaut |
|---|---|---|
| `journaux.hypotheses` | oui / non | `true` |
| `journaux.taille_max` | nombre | `20000 caractères` |

### Proposer des hypothèses

`journaux.hypotheses` · oui / non · défaut `true`

Affiche, sous l'explication, au plus trois pistes avec ce qui les soutient, ce qui les contredit, et la confiance déclarée par le modèle.

> ⚠️ Le chiffre de confiance est produit PAR LE MODÈLE : ce n'est pas une mesure, et rien ne le calibre. Il est affiché parce qu'il aide à ordonner des pistes, pas à trancher. Si l'usage montre qu'il se retrouve recopié dans un ticket comme un constat, couper ce réglage plutôt que de le laisser.

### Taille maximale d'un extrait

`journaux.taille_max` · nombre · défaut `20000 caractères`

Au-delà, l'extrait est refusé et l'utilisateur invité à coller la partie qui l'intéresse. Un journal entier collé d'un bloc dilue la question et sort du contexte du modèle, qui répond alors sur les premières lignes en donnant l'impression d'avoir tout lu.

> ⚠️ Rien de l'extrait n'est conservé, quelle que soit sa taille.

## Recherche

| Réglage | Type | Défaut |
|---|---|---|
| `recherche.passages` | nombre | `6` |
| `recherche.ponderation_lexicale` | nombre | `0.6` |
| `recherche.score_plancher` | nombre | `0.35` |
| `recherche.statuts_exclus` | liste, séparée par des virgules | `obsolete` |
| `recherche.taille_passage` | nombre | `2500 caractères` |
| `recherche.mots_vides` | liste, séparée par des virgules | `faire,fait,fais,font,cas,comment,quel,quelle,quels,quelles,quoi,pourquoi,pouvoir,peut,peux,peuvent,devoir,doit,dois,doivent,savoir,sait,sais,falloir,faut,faudra,faudrait,dire,dit,dites,aller,va,vont,mettre,met,mets,prendre,prend,prends,donner,donne,passer,passe,trouver,trouve,voir,voit,voient,sert,servir,concerne,existe,agit,sujet,question,besoin,chose,exemple,propos,plus,tout,toute,toutes,autre,autres,autrement,depuis,permet,permettant` |
| `recherche.conduite` | nombre | `2` |
| `recherche.renvois` | nombre | `3` |
| `recherche.cohesion` | nombre | `8` |
| `recherche.part_couverture` | nombre | `0.5` |
| `recherche.places` | liste, séparée par des virgules | `produit:2,bonne_pratique:2,equipe:2` |

### Passages retenus

`recherche.passages` · nombre · défaut `6`

Nombre de passages passés au modèle. Le modèle ne voit jamais l'ensemble de l'index : la taille du corpus ne pèse donc pas sur le contexte, et l'indexation de nouvelles sources ne dégrade pas les réponses existantes.

> ⚠️ Monter cette valeur dilue la question autant qu'elle enrichit le contexte. Au-delà d'une dizaine, un modèle local se met à répondre sur les premiers passages en donnant l'impression d'avoir tout lu.

### Poids de la recherche lexicale

`recherche.ponderation_lexicale` · nombre · défaut `0.6`

Part du lexical dans le score final ; le reste va au sémantique. Penché vers le lexical parce que le vocabulaire du corpus est très littéral — knowledge_at, INC-03, DPD, mailmaster — et qu'une correspondance exacte y vaut mieux qu'une proximité de sens.

> ⚠️ Sans embeddings disponibles, ce réglage est ignoré : la recherche est lexicale à 100 %.

### Score minimal pour interroger le modèle

`recherche.score_plancher` · nombre · défaut `0.35`

En dessous, l'outil répond « ce n'est pas écrit » sans même appeler le modèle, et consigne une lacune. Le score est la part du contenu distinctif de la question retrouvée dans le meilleur passage : 0,35 veut dire « au moins un tiers ».

> ⚠️ C'est un PRÉ-FILTRE BON MARCHÉ, pas le juge. Mesuré sur le corpus : les questions sans réponse tombent entre 0,19 et 0,65, celles qui en ont une entre 0,64 et 1,00 — les deux familles se chevauchent, et aucun seuil ne les sépare. C'est attendu : le score dit si les MOTS de la question existent dans le corpus, pas si la question y trouve réponse. Le juge est le modèle, à qui la consigne impose de répondre « ce n'est pas écrit » quand les passages ne suffisent pas — et cette réponse-là est consignée en lacune elle aussi. Monter ce seuil produit des « ce n'est pas écrit » à tort, sans jamais rendre le filtre exact.

### Statuts jamais retournés

`recherche.statuts_exclus` · liste, séparée par des virgules · défaut `obsolete`

Filtre dur, appliqué AVANT le classement. ARCH-01 et ARCH-02 sont d'anciennes fiches pleines de texte de procédure parfaitement plausible et périmé.

> ⚠️ Nécessaire même avec l'exclusion par chemin : QOT-13 porte statut obsolete tout en vivant hors de _archive/.

### Taille visée d'un passage

`recherche.taille_passage` · nombre · défaut `2500 caractères`

Le découpage se fait au niveau ##, en gardant les ### dans la section parente, et ne scinde qu'au-delà de cette taille. Motif : les sections du corpus font 88 mots en moyenne, bien trop court pour un passage de recherche isolé — une section seule perd le contexte qui la rend compréhensible.

### Mots ignorés dans les questions

`recherche.mots_vides` · liste, séparée par des virgules · défaut `faire,fait,fais,font,cas,comment,quel,quelle,quels,quelles,quoi,pourquoi,pouvoir,peut,peux,peuvent,devoir,doit,dois,doivent,savoir,sait,sais,falloir,faut,faudra,faudrait,dire,dit,dites,aller,va,vont,mettre,met,mets,prendre,prend,prends,donner,donne,passer,passe,trouver,trouve,voir,voit,voient,sert,servir,concerne,existe,agit,sujet,question,besoin,chose,exemple,propos,plus,tout,toute,toutes,autre,autres,autrement,depuis,permet,permettant`

Retirés de la question avant la recherche. La configuration french de PostgreSQL écarte déjà les articles et les prépositions, mais pas les verbes creux — or « faire » apparaît dans 24 passages du corpus contre 18 pour « ransomware ». Mesurés par la seule rareté, ces deux mots pèsent donc pareil, et « Que faire en cas de ransomware ? » remonte les passages qui disent « faire » et « cas » plutôt que la fiche INC-03.

> ⚠️ Liste À CURER pour le corpus indexé, pas une constante universelle : elle dépend de ce que les documents contiennent. Les FORMES FLÉCHIES sont indispensables, l'infinitif ne suffit pas — l'analyseur français réduit « dire » à « dir » et « dit » à « dit », deux lexèmes distincts. Un seul oubli suffit à fausser la question la plus courante : un mot creux présent dans un document sur trois pèse autant qu'un terme du métier, et les passages qui le contiennent sortent devant la bonne fiche. UN RADICAL PEUT ÊTRE INTERDIT ICI : l'analyseur réduit au même lexème un verbe creux et un mot du métier — `don` emporterait « données », `trait` « traitement », `appliqu` « application », `not` « note ». Les plus dangereux sont ceux qui sonnent creux. La règle de vérification tient en une ligne : relever les lexèmes du corpus, et proscrire tout radical dont une seule forme appartient au métier.

### Conduite attachée aux incidents

`recherche.conduite` · nombre · défaut `2`

Quand une réponse de données contient des incidents, on attache les sections de conduite des fiches correspondantes — au plus ce nombre de fiches.

> ⚠️ Le pont entre les deux moitiés de l'outil : la donnée dit ce qui se passe, le corpus dit quoi faire, dans la même réponse. Deux déclarations le portent, toutes deux dans l'en-tête des fiches et jamais devinées par rapprochement de mots : `type_incident` (taxonomie de l'établissement — grille INC-GRILLE — que Sniff implémente) pour les incidents, `domaine_catalogue` (vocabulaire fermé de /api/lacunes) pour les questions d'état — « quels certificats expirent » attache la procédure de renouvellement si une fiche déclare `certificats`. À plafond partagé, les fiches de type passent d'abord : un incident nommé est plus précis qu'un domaine. À 0, les réponses de données redeviennent ce qu'elles étaient : la donnée seule.

### Documents atteints par renvoi

`recherche.renvois` · nombre · défaut `3`

Quand un passage retenu renvoie vers un autre document du corpus, on ramène ses sections les plus pertinentes. Un niveau, jamais de renvoi de renvoi.

> ⚠️ La contrepartie d'une règle du corpus : une commande d'outil n'est écrite que dans UN fichier, et tout le reste renvoie. Un lecteur humain ouvre le renvoi ; un assistant qui ne l'ouvre pas répond « avec un outil de la trousse » sans jamais nommer l'outil — constaté sur la question du confinement, où l'annexe J renvoyait à OUT-05 pour la commande exacte. Ne pas suivre les renvois et exiger l'unicité des commandes sont deux décisions incompatibles. À 0, on revient au comportement d'avant.

### Sections ramenées de la fiche dominante

`recherche.cohesion` · nombre · défaut `8`

Quand une même fiche fournit l'essentiel de la réponse, on ramène ses autres sections, dans l'ordre du document. Assez haut pour qu'une fiche d'incident revienne ENTIÈRE : c'est ce qui permet au modèle de savoir qu'il doit tout lire.

> ⚠️ La recherche rapporte des PASSAGES, alors que la réponse à « que faire en cas de… » est une FICHE. Mesuré sur INC-04 : les sections qui gagnent sont « Éradication » et « Analyse post-incident », qui répètent le mot « malware » ; « 3. Confinement », qui dit d'isoler la machine et qui est la réponse, arrive douzième parce qu'elle ne le répète pas. Le biais est structurel — les sections qui FONT nomment le moins. Ramener la fiche entière le corrige sans toucher au classement. À 0, on revient au comportement d'avant.

### Part de la couverture dans le classement

`recherche.part_couverture` · nombre · défaut `0.5`

Le classement mêle deux mesures : la COUVERTURE (quelle part du contenu distinctif de la question se retrouve dans le passage) et la DENSITÉ (à quel point les termes y sont nombreux et proches). Le reste va à la densité.

> ⚠️ Valeur mesurée, pas choisie : sur six questions dont on connaît la fiche attendue, 0,5 la place dans les passages retenus 6 fois sur 6, contre 5 fois pour 0,7 et 4 fois pour 0. La couverture seule remonte les documents qui emploient les mots de la question ; la densité seule remonte ceux qui les répètent. Ni l'une ni l'autre ne suffit.

### Places par catégorie de source

`recherche.places` · liste, séparée par des virgules · défaut `produit:2,bonne_pratique:2,equipe:2`

Plafond de passages qu'une catégorie de source peut occuper, sous la forme categorie:nombre. Une catégorie non listée n'est pas plafonnée. Un plafond ne prive jamais l'assistant d'une réponse : s'il reste des places vides après avoir servi les autres catégories, elles sont comblées quand même — un plafond protège les procédures là où elles existent, il ne rationne pas la référence quand elle est seule à répondre. Un plafond de 0 fait exception et veut dire JAMAIS : c'est la façon d'écarter une catégorie d'une instance sans supprimer la source.

> ⚠️ `juridique` n'est délibérément PAS plafonnée : le corpus établit qu'un texte prime sur une fiche, et la plafonner reviendrait à écarter du contexte ce qui a raison. `produit` et `bonne_pratique` le sont, pour la raison inverse — la documentation éditeur pèse 202 fichiers contre 53 fiches maison, et un guide ANSSI dit ce qui se fait en général là où une fiche dit ce que nous faisons ici.

## Embeddings

| Réglage | Type | Défaut |
|---|---|---|
| `embeddings.actif` | oui / non | `false` |
| `embeddings.base_url` | texte | _vide_ |
| `embeddings.jeton` | **secret** — chiffré en base | _vide_ |
| `embeddings.delai_ms` | nombre | `60000 ms` |
| `embeddings.jetons_max` | nombre | `8192 jetons` |
| `embeddings.prefixe_question` | texte | _vide_ |
| `embeddings.prefixe_passage` | texte | _vide_ |
| `embeddings.modele` | texte | `BAAI/bge-m3` |

### Recherche sémantique

`embeddings.actif` · oui / non · défaut `false`

Active la moitié sémantique de la recherche. À laisser désactivé tant que la sonde n'a pas confirmé un point d'entrée d'embeddings.

> ⚠️ L'activer sans embeddings disponibles n'a aucun effet : la recherche reste lexicale.

### Adresse du service d'embeddings

`embeddings.base_url` · texte · défaut _vide_

Vide = on emploie l'adresse du modèle de conversation. À renseigner quand l'embedding vit ailleurs.

> ⚠️ Un modèle d'embedding pèse quelques centaines de mégaoctets là où un modèle d'instruction en pèse des dizaines de gigaoctets : il tourne très bien sur une petite VM sans GPU, et il n'y a aucune raison qu'il partage l'hébergement du second. CE POINT D'ENTRÉE REÇOIT L'INTÉGRALITÉ DU CORPUS à la réindexation, puis chaque question posée — c'est l'argument décisif pour qu'il reste dans l'établissement. Si la VM est derrière le même proxy que le reste, prévoir un `extra_hosts` dans docker-compose.yml : la résolution en boucle par le nom public échoue depuis un conteneur.

### Jeton du service d'embeddings

`embeddings.jeton` · **secret** — chiffré en base · défaut _vide_

Vide = pas d'authentification si l'adresse ci-dessus est renseignée ; sinon on emploie le jeton du modèle de conversation.

> ⚠️ IL N'Y A PAS DE JETON À TROUVER : contrairement à Open WebUI, un service d'embedding comme `text-embeddings-inference` n'a ni comptes ni clés émises. Soit on le laisse sans authentification et l'isolation réseau en tient lieu — choix défendable pour un service qui ne fait que calculer des vecteurs —, soit on fabrique un secret partagé (`openssl rand -hex 32`) qu'on met devant, dans le lancement du service ou dans le reverse proxy, et ici. Une adresse renseignée SANS jeton est donc une configuration valable, pas un oubli : c'est celui qui a saisi l'adresse qui décide. Le repli sur les réglages de l'IA, lui, exige toujours les deux. Chiffré en base comme tous les secrets, jamais réaffiché.

### Délai d'un calcul de vecteur

`embeddings.delai_ms` · nombre · défaut `60000 ms`

Temps accordé à une vectorisation. Distinct du délai de la liste des modèles.

> ⚠️ Il employait `ia.delai_liste_ms` — 20 secondes, un réglage prévu pour LISTER DES MODÈLES, opération immédiate. Une passe de bge-m3 sur un long passage, sur un processeur ancien et pendant une réindexation qui sature les cœurs, peut dépasser ce budget. Mesuré : 25 passages sur 3 196 sans vecteur, sans qu'aucune trace n'en dise la cause. Réutiliser un délai parce qu'il existe déjà est commode et faux — deux opérations dont les durées n'ont rien à voir ne partagent pas leur budget.

### Fenêtre du modèle

`embeddings.jetons_max` · nombre · défaut `8192 jetons`

Ce que le modèle accepte avant de tronquer. Sert à prévenir quand un passage la dépasse.

> ⚠️ LE SEUIL D'ALERTE EN DÉCOULE, il ne se pose plus à la main — environ 3,5 caractères par jeton en français, prudemment. Il avait d'abord été fixé à 1 500 caractères sans regarder que le découpeur visait 2 500 : les deux nombres n'étaient pas accordés, et la bande entre eux était signalée par construction. On a passé une soirée sur une alarme qu'on avait fabriquée. `bge-m3` accepte 8 192 jetons, e5 et nomic 512 : changer de modèle change ce réglage, et le seuil suit.

### Préfixe des questions

`embeddings.prefixe_question` · texte · défaut _vide_

Ajouté devant une question avant de la vectoriser. Dépend du modèle.

> ⚠️ VIDE PAR DÉFAUT, parce que `bge-m3` n'en veut pas. Mais ce n'est pas une coquetterie pour ceux qui en veulent : les modèles E5 sont entraînés avec « query: » devant une question et « passage: » devant un texte indexé ; sans eux la qualité se dégrade nettement, et SILENCIEUSEMENT — les scores restent d'apparence normale. Les valeurs dépendent du modèle : E5 veut « query: » / « passage: », nomic veut « search_query: » / « search_document: », BGE ne veut rien devant les passages et une instruction devant les questions. D'où deux réglages plutôt qu'un interrupteur : changer de modèle ne doit pas demander de changer le code.

### Préfixe des passages indexés

`embeddings.prefixe_passage` · texte · défaut _vide_

Ajouté devant un passage avant de le vectoriser. Dépend du modèle — voir « Préfixe des questions ».

> ⚠️ Un changement de préfixe rend les vecteurs déjà calculés incomparables aux nouveaux, au même titre qu'un changement de modèle : relancer `--reindexer`.

### Modèle d'embeddings

`embeddings.modele` · texte · défaut `BAAI/bge-m3`

Employé par la sonde et par l'indexation. Changer de modèle rend les vecteurs déjà calculés incomparables aux nouveaux.

> ⚠️ LA DIMENSION EST GRAVÉE DANS LE SCHÉMA : 1024. Un modèle qui en rend un autre nombre est refusé plutôt que tronqué — mesurer la moitié de l'index dans un espace et l'autre moitié dans un autre donnerait des scores d'apparence normale et sans aucun sens. `bge-m3` fait 1024 et accepte 8 192 jetons ; `multilingual-e5-base` fait 768 mais plafonne à 512, ce qui tronquerait 97 % de `corpus-bonnes-pratiques` et 86 % de `corpus-juridique` — mesuré, et ce sont les deux sources qui priment sur toutes les autres. C'est cette mesure qui a décidé du modèle, pas sa réputation. Après un changement, relancer `--reindexer` : une synchronisation ordinaire saute les documents inchangés et laisserait la moitié des vecteurs dans l'ancien espace.

## Synchronisation

| Réglage | Type | Défaut |
|---|---|---|
| `synchro.intervalle_h` | nombre | `6 heures` |
| `synchro.seuil_peremption_h` | nombre | `24 heures` |

### Intervalle de synchronisation

`synchro.intervalle_h` · nombre · défaut `6 heures`

Fréquence de relecture des sources, en lecture seule.

### Seuil de péremption visible

`synchro.seuil_peremption_h` · nombre · défaut `24 heures`

Au-delà de ce délai sans synchronisation réussie, la source est signalée comme périmée DANS L'INTERFACE, pas seulement dans les journaux.

> ⚠️ Un index qui cesse de se mettre à jour en silence sert des réponses périmées avec la même assurance qu'une réponse fraîche. C'est le pire mode de panne de l'outil.

## Journal de consultation

| Réglage | Type | Défaut |
|---|---|---|
| `audit.retention_jours` | nombre | `365 jours` |
| `audit.conserver_question` | oui / non | `true` |

### Durée de conservation

`audit.retention_jours` · nombre · défaut `365 jours`

Au-delà, les lignes du journal de consultation sont supprimées par la purge. Une question posée à l'assistant peut porter un nom — « les incidents de tel agent » — donc relever des données personnelles.

> ⚠️ Valeur à faire valider avec l'inscription au registre des traitements, pas à choisir seul. La purge tourne avec la synchronisation ; sans elle, la durée affichée ici serait une intention et non un fait.

### Conserver le texte des questions

`audit.conserver_question` · oui / non · défaut `true` · **portée instance**

Conserve la question posée à l'assistant. Désactivé, seules restent la date, l'utilisateur et les documents cités.

> ⚠️ Le contenu collé dans l'analyse de journaux n'est JAMAIS conservé, quel que soit ce réglage. Ce sont deux choses différentes : une question est écrite par la personne qui la pose, un extrait de journal est écrit par un tiers et porte des adresses IP et des identifiants.
