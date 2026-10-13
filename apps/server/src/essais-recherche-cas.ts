// CAS D'ESSAI DE LA RECHERCHE — exécutables contre la vraie base, sans modèle.
//
// La recherche est DÉTERMINISTE : même question, même classement. C'est le seul étage de
// la chaîne où un essai unique prouve quelque chose — le modèle, lui, varie, et c'est sa
// nature.

export type CasRecherche = {
    question: string
    /** Au moins UNE de ces références doit figurer dans les passages retenus. */
    attend: string[]
    /** Vrai si la bonne réponse est « ce n'est pas écrit ». */
    rienAttendu?: boolean
    /**
     * Une SECTION précise doit figurer parmi les passages — pas seulement son document.
     *
     * Ajouté quand les renvois du corpus ont reçu leurs ancres : « le document est là » ne
     * suffit plus à prouver que la section désignée par un renvoi est arrivée, et c'était
     * tout l'enjeu — l'ANX-J présente par ses §2 et §8 pendant que la commande du §3
     * manquait à la réponse.
     */
    attendSection?: { ref: string, section: string }
    /** Pourquoi ce cas existe — la panne qu'il surveille. */
    motif: string
}

export const CAS: CasRecherche[] = [
    {
        question: "qu'est-ce qu'il faut faire en cas de malware sur un poste ?",
        attend: ['INC-04', 'INC-04-CL'],
        motif: "La question qui a tout révélé : « faut » pesait un tiers du poids, le titre du "
            + "document n'était pas indexé, et les sections opératoires ne sortaient pas.",
    },
    {
        question: 'que faire en cas de code malveillant sur un poste ?',
        attend: ['INC-04', 'INC-04-CL'],
        motif: "L'écart de vocabulaire : « code malveillant » ne figure pas dans la fiche, il est "
            + "porté par ses mots-clés déclarés. Si ce cas tombe, la zone A ne fonctionne plus.",
    },
    {
        question: 'comment capturer la mémoire d’un poste Windows ?',
        attend: ['OUT-05', 'ANX-J'],
        motif: "La réponse vit dans une annexe et une fiche outil, pas dans une fiche d'incident. "
            + "Si ce cas tombe, les `repond_a` déclarés ne portent plus.",
    },
    {
        question: 'comment isoler une machine sans l’éteindre ?',
        attend: ['ANX-J'],
        motif: "Question déclarée mot pour mot dans le `repond_a` de l'annexe J.",
    },
    {
        question: 'que faire en cas de ransomware ?',
        attend: ['INC-03'],
        motif: "Le cas historique de la liste des mots vides : « faire » et « cas » pesaient plus "
            + "que « ransomware » avant la pondération par rareté.",
    },
    {
        question: 'que dit la procédure en cas de phishing ?',
        attend: ['INC-09'],
        motif: "Le cas historique de « dit » : df 9 contre 16 pour « phishing », la fiche perdait "
            + "contre les documents qui disent « dit ».",
    },
    {
        question: 'où sont les journaux d’authentification sur un serveur RHEL ?',
        attend: ['ANX-J'],
        motif: "Le piège auth.log/secure documenté par l'annexe J — et une question à fort "
            + "vocabulaire technique, qui vérifie que la référence ne noie pas le corpus.",
    },
    {
        question: 'comment écrire une règle Sigma ?',
        attend: [],
        rienAttendu: false,
        motif: "Aucune procédure maison ne traite le sujet : la réponse doit venir de la "
            + "référence HarfangLab. Ce cas vérifie que les plafonds d'autorité ne la rationnent "
            + "pas quand elle est seule à répondre. Toute référence retournée convient.",
    },
    {
        question: 'comment confiner quand on a un malware sur un poste ?',
        attend: ['ANX-J'],
        motif: "Le quoi sans le comment : la réponse donnait les étapes d'INC-04 sans une seule "
            + "commande, parce que l'annexe J dit « isoler » et jamais « confiner ». Ce cas reste "
            + "ROUGE tant que le vocabulaire de confinement n'est pas déclaré dans l'annexe J "
            + "(mots_cles ou repond_a) — c'est un défaut de corpus, et ce message est son rappel.",
    },
    {
        question: 'avec quel outil faire une image mémoire sur Windows ?',
        attend: ['OUT-05'],
        motif: "Question déclarée mot pour mot dans le `repond_a` d'OUT-05 : la fiche outil doit "
            + "répondre elle-même à sa question, sans passer par un renvoi.",
    },
    {
        question: 'explique-moi comment confiner quand on a un malware sur un poste ?',
        attend: ['OUT-05'],
        // La commande sysdiagnose vit dans cette section, désignée par l'ancre du renvoi
        // d'OUT-05. Si elle manque, c'est la désignation par ancre qui est cassée — ou les
        // ancres qui ont disparu du corpus.
        attendSection: { ref: 'ANX-J', section: 'Capturer la mémoire' },
        motif: "Le suivi des renvois : la réponse au confinement disait « avec un outil de la "
            + "trousse » sans jamais nommer l'outil, parce que l'annexe J renvoie à OUT-05 et que "
            + "l'assistant ne suivait pas les renvois. Si ce cas tombe, `recherche.renvois` est à 0 "
            + "ou le suivi ne résout plus les chemins relatifs du corpus.",
    },
    {
        question: 'mes fichiers sont cryptés, qu’est-ce que je fais ?',
        attend: ['INC-03'],
        motif: "Le vocabulaire de la victime : la fiche dit « chiffrés », la victime dit « cryptés », "
            + "et l'analyseur ne les rapproche pas. Mesuré : le lexème « crypt » existait dans 4 "
            + "passages hors corpus — sans le mot-clé d'INC-03, la question partait vers eux. Ce cas "
            + "vérifie que « crypté » mène à la fiche rançongiciel, pas aux passages qui contiennent "
            + 'le mot par accident.',
    },
    {
        question: 'j’ai reçu un mail d’arnaque, que faire ?',
        attend: ['INC-09'],
        motif: "df mesuré à ZÉRO sur « arnaqu » avant l'ajout du mot-clé : le mot de l'agent "
            + "n'existait nulle part dans l'index. La fiche dit « hameçonnage, mail piégé » — "
            + "l'en-tête porte le vocabulaire de celui qui appelle, le texte garde sa rigueur.",
    },
    {
        question: 'un utilisateur signale un mail suspect qui demande ses identifiants, que faire ?',
        // La fourche du signalement : le triage porte « Le signalement sans suite » (le
        // chemin de la tentative isolée, la mémoire expéditeur/domaine/URL sans laquelle
        // la règle des trois fois en trente jours est aveugle aux campagnes lentes), et
        // INC-01 ne commence qu'à la première réponse positive à « a-t-il cliqué, a-t-il
        // saisi ? ».
        attend: ['INC-00', 'INC-01'],
        attendSection: { ref: 'INC-00', section: 'Le signalement sans suite' },
        motif: "Le vocabulaire de la SITUATION, avant qualification : « un utilisateur signale » "
            + "n'existait dans aucun repond_a — tous parlaient l'incident déjà qualifié — et la "
            + "réponse déroulait la conduite compte compromis entière sans établir si des "
            + "identifiants avaient été saisis. Trois durcissements de consigne n'ont pas suffi "
            + "(le troisième a régressé) : c'est le corpus qui porte la fourche. Si ce cas tombe, "
            + "les repond_a « situation » ont disparu ou la section du triage a été renommée.",
    },
    {
        question: 'comment chercher la persistance laissée par un malware ?',
        attend: ['ANX-J'],
        attendSection: { ref: 'ANX-J', section: 'Chercher la persistance' },
        // LA MESURE DEMANDÉE PAR LA RÉDACTION, pas un cas né d'une panne : « les sections
        // Éradication des fiches paraphrasent la persistance exactement comme les § 3
        // paraphrasaient l'isolement, et personne ne l'a encore mesuré ». Ce cas est la
        // mesure. Vert : la chaîne checklist → annexe J § 5 tient. Rouge : c'est la même
        // impasse que le confinement, et la même ligne de § à poser côté corpus.
        motif: "La chaîne des gestes de persistance : la checklist malware désigne l'annexe J § 5 "
            + "par ancre (tâches planifiées, services, launchd, systemd, ld.so.preload). Si ce cas "
            + "tombe, soit la fiche domine sans désigner (poser la ligne de § Éradication côté "
            + "corpus), soit le suivi des désignations a cassé.",
    },
    {
        // LA QUESTION REFORMULÉE PAR LE FIL, telle qu'elle est partie en service.
        //
        // « Comment je confine dans ce cas ? » après un tour sur l'incident P1 devient
        // cette phrase-là : autonome, exacte, et chargée d'identifiants. Ils situent
        // parfaitement une question de DONNÉES et diluent une question de DOCUMENTS —
        // `srv-exemple-01` et `INC-EX01` ne figurent dans aucun passage, `P1` appelle la
        // grille, `INC-04` appelle son propre en-tête. Résultat mesuré : INC-04 n'a fourni
        // qu'une section, la cohésion (qui en exige deux) ne s'est pas déclenchée, le § 3
        // Confinement n'est pas venu — et avec lui les désignations vers la checklist et
        // l'annexe J. La réponse a dit honnêtement « la commande exacte n'est pas fournie ».
        question: 'Comment confiner la machine srv-exemple-01 dans le cadre de l\'incident P1 INC-EX01, de type malware, en suivant la procédure INC-04 ?',
        attend: ['INC-04'],
        attendSection: { ref: 'ANX-J', section: 'Isoler une machine sans' },
        motif: "La dilution par les identifiants : une question de procédure reformulée avec le nom de la "
            + "machine et l'identifiant de l'incident n'atteint plus les gestes. Si ce cas est rouge alors "
            + "que « explique-moi comment confiner quand on a un malware sur un poste ? » est vert, c'est "
            + "la dilution qu'il faut traiter — pas le suivi des renvois, qui fonctionne.",
    },
    {
        question: 'quelle est la recette de la tarte aux pommes ?',
        attend: [],
        rienAttendu: true,
        motif: "Le témoin négatif : une question hors sujet doit rester sous le plancher. Si ce "
            + "cas tombe, le plancher est trop bas et « ce n'est pas écrit » a disparu de l'outil.",
    },
]
