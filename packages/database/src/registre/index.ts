// REGISTRE DES RÉGLAGES — source unique de vérité.
//
// Chaque réglage est déclaré ICI, une seule fois, avec sa valeur par défaut et sa
// description en français. Trois choses en découlent, et c'est tout l'intérêt :

export type TypeReglage =
    | 'texte'
    | 'texte_long'   // consignes, contexte — affiché en zone de saisie multiligne
    | 'nombre'
    | 'booleen'
    | 'liste'        // valeurs séparées par des virgules
    | 'secret'       // chiffré en base, jamais renvoyé en clair par l'API
    | 'modele'       // choisi dans la liste chargée depuis l'API, jamais saisi à la main

export type Portee =
    /** Identique pour toutes les instances : c'est du réglage de déploiement. */
    | 'global'
    | 'instance'

export type Reglage = {
    cle: string
    rubrique: string
    libelle: string
    /** Ce que fait le réglage, et pourquoi cette valeur. Repris tel quel dans la doc. */
    description: string
    type: TypeReglage
    defaut: string
    portee: Portee
    unite?: string
    min?: number
    max?: number
    /** Mise en garde affichée dans la doc et sous le champ. */
    note?: string
}

export const REGISTRE: readonly Reglage[] = [

    // -------------------------------------------------------------------------------
    { rubrique: 'Instance', cle: 'instance.nom', libelle: "Nom de l'instance",
      type: 'texte', defaut: 'Cellule Cyber', portee: 'instance',
      description: "Affiché dans l'interface. Sert à distinguer les déploiements quand plusieurs coexistent." },

    { rubrique: 'Instance', cle: 'instance.groupe_sso', libelle: 'Groupe SSO autorisé',
      type: 'texte', defaut: '', portee: 'instance',
      description: "Seul groupe dont les membres peuvent se connecter. Avec la liste des sources indexées, c'est la SEULE chose qui distingue deux instances — le code est identique.",
      note: "Vide = personne ne peut se connecter hors compte de secours. C'est volontaire : une instance sans groupe déclaré ne doit pas être ouverte à tous." },

    // -------------------------------------------------------------------------------
    { rubrique: 'Modèle', cle: 'ia.base_url', libelle: "Adresse de l'Open WebUI",
      type: 'texte', defaut: '', portee: 'global',
      description: "Racine de l'API compatible OpenAI. Les routes /api/… et /v1/… sont essayées l'une après l'autre, sans qu'il faille préciser laquelle." },

    { rubrique: 'Modèle', cle: 'ia.jeton', libelle: "Jeton d'API",
      type: 'secret', defaut: '', portee: 'global',
      description: "Chiffré en base. Ne ressort jamais en clair par l'API : l'interface affiche seulement s'il est renseigné." },

    { rubrique: 'Modèle', cle: 'ia.modele.assistant', libelle: "Modèle — assistant cellule",
      type: 'modele', defaut: '', portee: 'global',
      description: "Tout se joue sur la recherche et la citation, et la latence compte en usage interactif. Mistral Small 3.2 24B convient.",
      note: "Choisi dans la liste chargée depuis l'API, jamais saisi à la main." },

    { rubrique: 'Modèle', cle: 'ia.modele.journaux', libelle: "Modèle — analyse de journaux",
      type: 'modele', defaut: '', portee: 'global',
      description: "Demande une connaissance de formats, d'identifiants d'événements et de syntaxes de règles. Usage ponctuel, la latence pèse moins. gpt-oss-120b convient." },

    { rubrique: 'Modèle', cle: 'ia.modele.orientation', libelle: "Modèle — orientation (facultatif)",
      type: 'modele', defaut: '', portee: 'global',
      description: "Choisit entre le corpus et les données vivantes, puis la question déclarée et ses paramètres. "
        + "C'est une CLASSIFICATION dans un vocabulaire fermé : ce qui compte est la discipline, pas la finesse — "
        + "un modèle qui « comprend mieux » a plus de latitude pour s'écarter du catalogue.",
      note: "Vide, l'orientation utilise le modèle de l'assistant. C'est l'étape la plus critique : une erreur de "
        + "rédaction se voit, une erreur d'orientation envoie sur la mauvaise route et la réponse reste cohérente." },

    { rubrique: 'Modèle', cle: 'ia.modele.reformulation', libelle: "Modèle — reformulation du fil (facultatif)",
      type: 'modele', defaut: '', portee: 'global',
      description: "Transforme « et combien de Windows 10 ? » en question autonome, à la lumière de l'échange. "
        + "Réécriture SOUS CONTRAINTE : un modèle qui infère trop y est un danger — c'est cette étape qui a "
        + "substitué une composante à une autre, et rendu un chiffre exact pour la mauvaise entité.",
      note: "Vide, la reformulation utilise le modèle de l'assistant." },

    { rubrique: 'Modèle', cle: 'ia.temperature', libelle: 'Température',
      type: 'nombre', defaut: '0.1', portee: 'global', min: 0, max: 2,
      description: "Basse volontairement : on veut une lecture fidèle, pas de la variété. Monter cette valeur dégrade directement la règle « n'invente rien »." },

    { rubrique: 'Modèle', cle: 'ia.delai_ms', libelle: 'Délai maximal de réponse',
      type: 'nombre', defaut: '120000', portee: 'global', unite: 'ms', min: 5000,
      description: "Au-delà, la demande est abandonnée. Un modèle local sur une machine chargée peut être lent sans être en panne." },

    { rubrique: 'Modèle', cle: 'ia.delai_liste_ms', libelle: 'Délai — liste des modèles',
      type: 'nombre', defaut: '20000', portee: 'global', unite: 'ms', min: 1000,
      description: "Plus court que le délai de réponse : lister les modèles est une opération immédiate, et l'écran de réglages ne doit pas se figer si l'adresse est fausse." },

    { rubrique: 'Modèle', cle: 'ia.contexte', libelle: "Contexte de l'établissement",
      type: 'texte_long', defaut: '', portee: 'instance',
      description: "Ajouté à la consigne système. Sert à nommer l'établissement et ses particularités, pas à y loger des procédures — celles-ci sont dans le corpus, avec leur version et leur date." },

    // -------------------------------------------------------------------------------
    { rubrique: 'Consignes', cle: 'ia.prompt.systeme', libelle: 'Consigne système commune',
      type: 'texte_long', defaut: '', portee: 'global',
      description: "Cadre partagé par les deux outils. Vide = la consigne par défaut du code s'applique.",
      note: "Le CONTRAT DE SORTIE n'est pas ici et reste ajouté par le code : une consigne mal réécrite doit dégrader la réponse, pas casser l'outil." },

    { rubrique: 'Consignes', cle: 'ia.prompt.assistant', libelle: 'Consigne — réponse ancrée',
      type: 'texte_long', defaut: '', portee: 'global',
      description: "Ce que l'assistant doit faire des passages retenus : citer, ne pas recopier, ne pas compter. Vide = consigne par défaut du code.",
      note: "Trois consignes NE sont PAS ici et restent dans le code, parce qu'elles sont calculées à partir de ce qui a été trouvé : la préséance entre sources d'autorités différentes, les mentions obligatoires attachées aux documents, et le contrat de sortie. Une consigne mal réécrite doit dégrader la réponse, pas défaire une règle." },

    { rubrique: 'Consignes', cle: 'ia.prompt.journaux', libelle: 'Consigne — analyse de journaux',
      type: 'texte_long', defaut: '', portee: 'global',
      description: "Ce que l'outil 3 doit faire d'un extrait collé. Vide = consigne par défaut du code." },

    { rubrique: 'Consignes', cle: 'ia.prompt.hypotheses', libelle: 'Consigne — hypothèses sur un extrait',
      type: 'texte_long', defaut: '', portee: 'global',
      description: "Ce que l'outil 3 doit proposer comme pistes, à côté de l'explication. Vide = consigne par défaut du code.",
      note: "Cette consigne est SÉPARÉE de « analyse de journaux », qui interdit de qualifier. La séparation est volontaire : une hypothèse assortie de ce qui la contredit n'est pas une qualification, et mêler les deux demandes dans une même consigne diluerait l'interdiction." },

    { rubrique: 'Consignes', cle: 'ia.messages_gardes', libelle: 'Messages conservés dans un fil',
      type: 'nombre', defaut: '10', portee: 'global', min: 2, max: 40,
      description: "Questions ET réponses confondues : dix font cinq échanges. Au-delà, les passages cités sortent du contexte d'un modèle local, qui se met à répondre de mémoire générale en gardant le même aplomb. On préfère perdre le début du fil." },

    // -------------------------------------------------------------------------------
    { rubrique: 'Analyse de journaux', cle: 'journaux.hypotheses', libelle: 'Proposer des hypothèses',
      type: 'booleen', defaut: 'true', portee: 'global',
      description: "Affiche, sous l'explication, au plus trois pistes avec ce qui les soutient, ce qui les contredit, et la confiance déclarée par le modèle.",
      note: "Le chiffre de confiance est produit PAR LE MODÈLE : ce n'est pas une mesure, et rien ne le calibre. Il est affiché parce qu'il aide à ordonner des pistes, pas à trancher. Si l'usage montre qu'il se retrouve recopié dans un ticket comme un constat, couper ce réglage plutôt que de le laisser." },

    { rubrique: 'Analyse de journaux', cle: 'journaux.taille_max', libelle: "Taille maximale d'un extrait",
      type: 'nombre', defaut: '20000', portee: 'global', unite: 'caractères', min: 500,
      description: "Au-delà, l'extrait est refusé et l'utilisateur invité à coller la partie qui l'intéresse. Un journal entier collé d'un bloc dilue la question et sort du contexte du modèle, qui répond alors sur les premières lignes en donnant l'impression d'avoir tout lu.",
      note: "Rien de l'extrait n'est conservé, quelle que soit sa taille." },

    // -------------------------------------------------------------------------------
    { rubrique: 'Recherche', cle: 'recherche.passages', libelle: 'Passages retenus',
      type: 'nombre', defaut: '6', portee: 'global', min: 1, max: 20,
      description: "Nombre de passages passés au modèle. Le modèle ne voit jamais l'ensemble de l'index : la taille du corpus ne pèse donc pas sur le contexte, et l'indexation de nouvelles sources ne dégrade pas les réponses existantes.",
      note: "Monter cette valeur dilue la question autant qu'elle enrichit le contexte. Au-delà d'une dizaine, un modèle local se met à répondre sur les premiers passages en donnant l'impression d'avoir tout lu." },

    { rubrique: 'Recherche', cle: 'recherche.ponderation_lexicale', libelle: 'Poids de la recherche lexicale',
      type: 'nombre', defaut: '0.6', portee: 'global', min: 0, max: 1,
      description: "Part du lexical dans le score final ; le reste va au sémantique. Penché vers le lexical parce que le vocabulaire du corpus est très littéral — knowledge_at, INC-03, DPD, mailmaster — et qu'une correspondance exacte y vaut mieux qu'une proximité de sens.",
      note: "Sans embeddings disponibles, ce réglage est ignoré : la recherche est lexicale à 100 %." },

    { rubrique: 'Recherche', cle: 'recherche.score_plancher', libelle: 'Score minimal pour interroger le modèle',
      type: 'nombre', defaut: '0.35', portee: 'global', min: 0, max: 1,
      description: "En dessous, l'outil répond « ce n'est pas écrit » sans même appeler le modèle, et consigne une lacune. Le score est la part du contenu distinctif de la question retrouvée dans le meilleur passage : 0,35 veut dire « au moins un tiers ».",
      note: "C'est un PRÉ-FILTRE BON MARCHÉ, pas le juge. Mesuré sur le corpus : les questions sans réponse tombent entre 0,19 et 0,65, celles qui en ont une entre 0,64 et 1,00 — les deux familles se chevauchent, et aucun seuil ne les sépare. C'est attendu : le score dit si les MOTS de la question existent dans le corpus, pas si la question y trouve réponse. Le juge est le modèle, à qui la consigne impose de répondre « ce n'est pas écrit » quand les passages ne suffisent pas — et cette réponse-là est consignée en lacune elle aussi. Monter ce seuil produit des « ce n'est pas écrit » à tort, sans jamais rendre le filtre exact." },

    { rubrique: 'Recherche', cle: 'recherche.statuts_exclus', libelle: 'Statuts jamais retournés',
      type: 'liste', defaut: 'obsolete', portee: 'global',
      description: "Filtre dur, appliqué AVANT le classement. ARCH-01 et ARCH-02 sont d'anciennes fiches pleines de texte de procédure parfaitement plausible et périmé.",
      note: "Nécessaire même avec l'exclusion par chemin : QOT-13 porte statut obsolete tout en vivant hors de _archive/." },

    { rubrique: 'Recherche', cle: 'recherche.taille_passage', libelle: 'Taille visée d\'un passage',
      type: 'nombre', defaut: '2500', portee: 'global', unite: 'caractères', min: 400,
      description: "Le découpage se fait au niveau ##, en gardant les ### dans la section parente, et ne scinde qu'au-delà de cette taille. Motif : les sections du corpus font 88 mots en moyenne, bien trop court pour un passage de recherche isolé — une section seule perd le contexte qui la rend compréhensible." },

    // -------------------------------------------------------------------------------
    { rubrique: 'Embeddings', cle: 'embeddings.actif', libelle: 'Recherche sémantique',
      type: 'booleen', defaut: 'false', portee: 'global',
      description: "Active la moitié sémantique de la recherche. À laisser désactivé tant que la sonde n'a pas confirmé un point d'entrée d'embeddings.",
      note: "L'activer sans embeddings disponibles n'a aucun effet : la recherche reste lexicale." },

    { rubrique: 'Embeddings', cle: 'embeddings.base_url', libelle: "Adresse du service d'embeddings",
      type: 'texte', defaut: '', portee: 'global',
      description: "Vide = on emploie l'adresse du modèle de conversation. À renseigner quand l'embedding vit ailleurs.",
      note: "Un modèle d'embedding pèse quelques centaines de mégaoctets là où un modèle d'instruction en pèse des dizaines de gigaoctets : il tourne très bien sur une petite VM sans GPU, et il n'y a aucune raison qu'il partage l'hébergement du second. CE POINT D'ENTRÉE REÇOIT L'INTÉGRALITÉ DU CORPUS à la réindexation, puis chaque question posée — c'est l'argument décisif pour qu'il reste dans l'établissement. Si la VM est derrière le même proxy que le reste, prévoir un `extra_hosts` dans docker-compose.yml : la résolution en boucle par le nom public échoue depuis un conteneur." },

    { rubrique: 'Embeddings', cle: 'embeddings.jeton', libelle: "Jeton du service d'embeddings",
      type: 'secret', defaut: '', portee: 'global',
      description: "Vide = pas d'authentification si l'adresse ci-dessus est renseignée ; sinon on emploie le jeton du modèle de conversation.",
      note: "IL N'Y A PAS DE JETON À TROUVER : contrairement à Open WebUI, un service d'embedding comme `text-embeddings-inference` n'a ni comptes ni clés émises. Soit on le laisse sans authentification et l'isolation réseau en tient lieu — choix défendable pour un service qui ne fait que calculer des vecteurs —, soit on fabrique un secret partagé (`openssl rand -hex 32`) qu'on met devant, dans le lancement du service ou dans le reverse proxy, et ici. Une adresse renseignée SANS jeton est donc une configuration valable, pas un oubli : c'est celui qui a saisi l'adresse qui décide. Le repli sur les réglages de l'IA, lui, exige toujours les deux. Chiffré en base comme tous les secrets, jamais réaffiché." },

    { rubrique: 'Embeddings', cle: 'embeddings.delai_ms', libelle: "Délai d'un calcul de vecteur",
      type: 'nombre', defaut: '60000', portee: 'global', unite: 'ms', min: 1000,
      description: "Temps accordé à une vectorisation. Distinct du délai de la liste des modèles.",
      note: "Il employait `ia.delai_liste_ms` — 20 secondes, un réglage prévu pour LISTER DES MODÈLES, opération immédiate. Une passe de bge-m3 sur un long passage, sur un processeur ancien et pendant une réindexation qui sature les cœurs, peut dépasser ce budget. Mesuré : 25 passages sur 3 196 sans vecteur, sans qu'aucune trace n'en dise la cause. Réutiliser un délai parce qu'il existe déjà est commode et faux — deux opérations dont les durées n'ont rien à voir ne partagent pas leur budget." },

    { rubrique: 'Embeddings', cle: 'embeddings.jetons_max', libelle: 'Fenêtre du modèle',
      type: 'nombre', defaut: '8192', portee: 'global', unite: 'jetons', min: 128,
      description: "Ce que le modèle accepte avant de tronquer. Sert à prévenir quand un passage la dépasse.",
      note: "LE SEUIL D'ALERTE EN DÉCOULE, il ne se pose plus à la main — environ 3,5 caractères par jeton en français, prudemment. Il avait d'abord été fixé à 1 500 caractères sans regarder que le découpeur visait 2 500 : les deux nombres n'étaient pas accordés, et la bande entre eux était signalée par construction. On a passé une soirée sur une alarme qu'on avait fabriquée. `bge-m3` accepte 8 192 jetons, e5 et nomic 512 : changer de modèle change ce réglage, et le seuil suit." },

    { rubrique: 'Embeddings', cle: 'embeddings.prefixe_question', libelle: 'Préfixe des questions',
      type: 'texte', defaut: '', portee: 'global',
      description: "Ajouté devant une question avant de la vectoriser. Dépend du modèle.",
      note: "VIDE PAR DÉFAUT, parce que `bge-m3` n'en veut pas. Mais ce n'est pas une coquetterie pour ceux qui en veulent : les modèles E5 sont entraînés avec « query: » devant une question et « passage: » devant un texte indexé ; sans eux la qualité se dégrade nettement, et SILENCIEUSEMENT — les scores restent d'apparence normale. Les valeurs dépendent du modèle : E5 veut « query: » / « passage: », nomic veut « search_query: » / « search_document: », BGE ne veut rien devant les passages et une instruction devant les questions. D'où deux réglages plutôt qu'un interrupteur : changer de modèle ne doit pas demander de changer le code." },

    { rubrique: 'Embeddings', cle: 'embeddings.prefixe_passage', libelle: 'Préfixe des passages indexés',
      type: 'texte', defaut: '', portee: 'global',
      description: "Ajouté devant un passage avant de le vectoriser. Dépend du modèle — voir « Préfixe des questions ».",
      note: "Un changement de préfixe rend les vecteurs déjà calculés incomparables aux nouveaux, au même titre qu'un changement de modèle : relancer `--reindexer`." },

    { rubrique: 'Embeddings', cle: 'embeddings.modele', libelle: "Modèle d'embeddings",
      type: 'texte', defaut: 'BAAI/bge-m3', portee: 'global',
      description: "Employé par la sonde et par l'indexation. Changer de modèle rend les vecteurs déjà calculés incomparables aux nouveaux.",
      note: "LA DIMENSION EST GRAVÉE DANS LE SCHÉMA : 1024. Un modèle qui en rend un autre nombre est refusé plutôt que tronqué — mesurer la moitié de l'index dans un espace et l'autre moitié dans un autre donnerait des scores d'apparence normale et sans aucun sens. `bge-m3` fait 1024 et accepte 8 192 jetons ; `multilingual-e5-base` fait 768 mais plafonne à 512, ce qui tronquerait 97 % de `corpus-bonnes-pratiques` et 86 % de `corpus-juridique` — mesuré, et ce sont les deux sources qui priment sur toutes les autres. C'est cette mesure qui a décidé du modèle, pas sa réputation. Après un changement, relancer `--reindexer` : une synchronisation ordinaire saute les documents inchangés et laisserait la moitié des vecteurs dans l'ancien espace." },

    // -------------------------------------------------------------------------------
    { rubrique: 'Synchronisation', cle: 'synchro.intervalle_h', libelle: 'Intervalle de synchronisation',
      type: 'nombre', defaut: '6', portee: 'global', unite: 'heures', min: 1,
      description: "Fréquence de relecture des sources, en lecture seule." },

    { rubrique: 'Synchronisation', cle: 'synchro.seuil_peremption_h', libelle: 'Seuil de péremption visible',
      type: 'nombre', defaut: '24', portee: 'global', unite: 'heures', min: 2,
      description: "Au-delà de ce délai sans synchronisation réussie, la source est signalée comme périmée DANS L'INTERFACE, pas seulement dans les journaux.",
      note: "Un index qui cesse de se mettre à jour en silence sert des réponses périmées avec la même assurance qu'une réponse fraîche. C'est le pire mode de panne de l'outil." },

    { rubrique: 'Recherche', cle: 'recherche.mots_vides', libelle: 'Mots ignorés dans les questions',
      type: 'liste', defaut: 'faire,fait,fais,font,cas,comment,quel,quelle,quels,quelles,quoi,pourquoi,pouvoir,peut,peux,peuvent,devoir,doit,dois,doivent,savoir,sait,sais,falloir,faut,faudra,faudrait,dire,dit,dites,aller,va,vont,mettre,met,mets,prendre,prend,prends,donner,donne,passer,passe,trouver,trouve,voir,voit,voient,sert,servir,concerne,existe,agit,sujet,question,besoin,chose,exemple,propos,plus,tout,toute,toutes,autre,autres,autrement,depuis,permet,permettant',
      portee: 'global',
      description: "Retirés de la question avant la recherche. La configuration french de PostgreSQL écarte déjà les articles et les prépositions, mais pas les verbes creux — or « faire » apparaît dans 24 passages du corpus contre 18 pour « ransomware ». Mesurés par la seule rareté, ces deux mots pèsent donc pareil, et « Que faire en cas de ransomware ? » remonte les passages qui disent « faire » et « cas » plutôt que la fiche INC-03.",
      note: "Liste À CURER pour le corpus indexé, pas une constante universelle : elle dépend de ce que les documents contiennent. Les FORMES FLÉCHIES sont indispensables, l'infinitif ne suffit pas — l'analyseur français réduit « dire » à « dir » et « dit » à « dit », deux lexèmes distincts. Un seul oubli suffit à fausser la question la plus courante : un mot creux présent dans un document sur trois pèse autant qu'un terme du métier, et les passages qui le contiennent sortent devant la bonne fiche. UN RADICAL PEUT ÊTRE INTERDIT ICI : l'analyseur réduit au même lexème un verbe creux et un mot du métier — `don` emporterait « données », `trait` « traitement », `appliqu` « application », `not` « note ». Les plus dangereux sont ceux qui sonnent creux. La règle de vérification tient en une ligne : relever les lexèmes du corpus, et proscrire tout radical dont une seule forme appartient au métier." },

    { rubrique: 'Recherche', cle: 'recherche.conduite', libelle: 'Conduite attachée aux incidents',
      type: 'nombre', defaut: '2', portee: 'global', min: 0, max: 4,
      description: "Quand une réponse de données contient des incidents, on attache les sections de conduite des fiches correspondantes — au plus ce nombre de fiches.",
      note: "Le pont entre les deux moitiés de l'outil : la donnée dit ce qui se passe, le corpus dit quoi faire, dans la même réponse. Deux déclarations le portent, toutes deux dans l'en-tête des fiches et jamais devinées par rapprochement de mots : `type_incident` (taxonomie de l'établissement — grille INC-GRILLE — que Sniff implémente) pour les incidents, `domaine_catalogue` (vocabulaire fermé de /api/lacunes) pour les questions d'état — « quels certificats expirent » attache la procédure de renouvellement si une fiche déclare `certificats`. À plafond partagé, les fiches de type passent d'abord : un incident nommé est plus précis qu'un domaine. À 0, les réponses de données redeviennent ce qu'elles étaient : la donnée seule." },

    { rubrique: 'Recherche', cle: 'recherche.renvois', libelle: 'Documents atteints par renvoi',
      type: 'nombre', defaut: '3', portee: 'global', min: 0, max: 5,
      description: "Quand un passage retenu renvoie vers un autre document du corpus, on ramène ses sections les plus pertinentes. Un niveau, jamais de renvoi de renvoi.",
      note: "La contrepartie d'une règle du corpus : une commande d'outil n'est écrite que dans UN fichier, et tout le reste renvoie. Un lecteur humain ouvre le renvoi ; un assistant qui ne l'ouvre pas répond « avec un outil de la trousse » sans jamais nommer l'outil — constaté sur la question du confinement, où l'annexe J renvoyait à OUT-05 pour la commande exacte. Ne pas suivre les renvois et exiger l'unicité des commandes sont deux décisions incompatibles. À 0, on revient au comportement d'avant." },

    { rubrique: 'Recherche', cle: 'recherche.cohesion', libelle: 'Sections ramenées de la fiche dominante',
      type: 'nombre', defaut: '8', portee: 'global', min: 0, max: 20,
      description: "Quand une même fiche fournit l'essentiel de la réponse, on ramène ses autres sections, dans l'ordre du document. Assez haut pour qu'une fiche d'incident revienne ENTIÈRE : c'est ce qui permet au modèle de savoir qu'il doit tout lire.",
      note: "La recherche rapporte des PASSAGES, alors que la réponse à « que faire en cas de… » est une FICHE. Mesuré sur INC-04 : les sections qui gagnent sont « Éradication » et « Analyse post-incident », qui répètent le mot « malware » ; « 3. Confinement », qui dit d'isoler la machine et qui est la réponse, arrive douzième parce qu'elle ne le répète pas. Le biais est structurel — les sections qui FONT nomment le moins. Ramener la fiche entière le corrige sans toucher au classement. À 0, on revient au comportement d'avant." },

    { rubrique: 'Recherche', cle: 'recherche.part_couverture', libelle: 'Part de la couverture dans le classement',
      type: 'nombre', defaut: '0.5', portee: 'global', min: 0, max: 1,
      description: "Le classement mêle deux mesures : la COUVERTURE (quelle part du contenu distinctif de la question se retrouve dans le passage) et la DENSITÉ (à quel point les termes y sont nombreux et proches). Le reste va à la densité.",
      note: "Valeur mesurée, pas choisie : sur six questions dont on connaît la fiche attendue, 0,5 la place dans les passages retenus 6 fois sur 6, contre 5 fois pour 0,7 et 4 fois pour 0. La couverture seule remonte les documents qui emploient les mots de la question ; la densité seule remonte ceux qui les répètent. Ni l'une ni l'autre ne suffit." },

    { rubrique: 'Recherche', cle: 'recherche.places', libelle: 'Places par catégorie de source',
      type: 'liste', defaut: 'produit:2,bonne_pratique:2,equipe:2', portee: 'global',
      description: "Plafond de passages qu'une catégorie de source peut occuper, sous la forme categorie:nombre. Une catégorie non listée n'est pas plafonnée. Un plafond ne prive jamais l'assistant d'une réponse : s'il reste des places vides après avoir servi les autres catégories, elles sont comblées quand même — un plafond protège les procédures là où elles existent, il ne rationne pas la référence quand elle est seule à répondre. Un plafond de 0 fait exception et veut dire JAMAIS : c'est la façon d'écarter une catégorie d'une instance sans supprimer la source.",
      note: "`juridique` n'est délibérément PAS plafonnée : le corpus établit qu'un texte prime sur une fiche, et la plafonner reviendrait à écarter du contexte ce qui a raison. `produit` et `bonne_pratique` le sont, pour la raison inverse — la documentation éditeur pèse 202 fichiers contre 53 fiches maison, et un guide ANSSI dit ce qui se fait en général là où une fiche dit ce que nous faisons ici." },

    // -------------------------------------------------------------------------------
    { rubrique: 'Journal de consultation', cle: 'audit.retention_jours', libelle: 'Durée de conservation',
      type: 'nombre', defaut: '365', portee: 'global', unite: 'jours', min: 7,
      description: "Au-delà, les lignes du journal de consultation sont supprimées par la purge. Une question posée à l'assistant peut porter un nom — « les incidents de tel agent » — donc relever des données personnelles.",
      note: "Valeur à faire valider avec l'inscription au registre des traitements, pas à choisir seul. La purge tourne avec la synchronisation ; sans elle, la durée affichée ici serait une intention et non un fait." },

    { rubrique: 'Journal de consultation', cle: 'audit.conserver_question', libelle: 'Conserver le texte des questions',
      type: 'booleen', defaut: 'true', portee: 'instance',
      description: "Conserve la question posée à l'assistant. Désactivé, seules restent la date, l'utilisateur et les documents cités.",
      note: "Le contenu collé dans l'analyse de journaux n'est JAMAIS conservé, quel que soit ce réglage. Ce sont deux choses différentes : une question est écrite par la personne qui la pose, un extrait de journal est écrit par un tiers et porte des adresses IP et des identifiants." },

] as const

// -----------------------------------------------------------------------------------
// Accès.
// -----------------------------------------------------------------------------------

const PAR_CLE = new Map(REGISTRE.map(r => [r.cle, r]))

export function reglage(cle: string): Reglage {
    const r = PAR_CLE.get(cle)
    if (!r) throw new Error(`Réglage inconnu : « ${cle} ». Toute clé doit être déclarée dans le registre.`)
    return r
}

export function estSecret(cle: string): boolean {
    return reglage(cle).type === 'secret'
}

export const RUBRIQUES: string[] = [...new Set(REGISTRE.map(r => r.rubrique))]

/** Valide une valeur contre la déclaration. Renvoie `null` si elle passe. */
export function valider(cle: string, valeur: string): string | null {
    const r = reglage(cle)
    if (valeur === '') return null   // vide = revenir au défaut

    if (r.type === 'nombre') {
        const n = Number(valeur)
        if (!Number.isFinite(n)) return `« ${valeur} » n'est pas un nombre.`
        if (r.min !== undefined && n < r.min) return `Minimum ${r.min}${r.unite ? ' ' + r.unite : ''}.`
        if (r.max !== undefined && n > r.max) return `Maximum ${r.max}${r.unite ? ' ' + r.unite : ''}.`
    }
    if (r.type === 'booleen' && valeur !== 'true' && valeur !== 'false') {
        return 'Attendu : true ou false.'
    }
    return null
}
export * from "./sources";
