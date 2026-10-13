// QUESTIONS DÉCLARÉES — ce que l'assistant sait demander aux données vivantes.
//
// Le modèle NE COMPOSE PAS de requêtes. Il choisit une question dans cette liste, et
// l'application l'exécute. Deux raisons, et la seconde compte plus que la première.

import { prescrire } from "./mentions";

export type Parametre = {
    cle: string
    libelle: string
    /** Valeurs acceptées. Vide = texte libre. */
    valeurs?: string[]
    obligatoire?: boolean
}

export type Question = {
    cle: string
    /** Ce que la question demande, en français. C'est là-dessus que le modèle choisit. */
    intitule: string
    /** Type de source qui y répond — `catalogue` ou `sniff`. */
    source: string
    chemin: string
    parametres: Parametre[]
    /**
     * Domaines du Catalogue sur lesquels cette question s'appuie.
     *
     * Sert à confronter CHAQUE réponse à `/api/lacunes` — voir `lacunesApplicables()` dans
     * donnees.ts. Sans cette déclaration, une réponse sur la couverture EDR pourrait sortir
     * sans mentionner que le Catalogue est aveugle sur l'EDR, ce qui est précisément
     * l'erreur que le contrat cherche à empêcher.
     */
    domaines?: string[]
    /**
     * Ce que chaque élément cité doit porter pour être identifiable.
     *
     * « Sois bref » produisait « Oui, il y a un incident P1 » — exact, et inutilisable : on
     * ne sait pas lequel, ni quand, ni où le retrouver. Quelqu'un qui demande s'il y a eu un
     * P1 veut savoir ce qui s'est passé, pas la confirmation qu'une ligne existe.
     */
    detailsMinimums?: string[]
    /**
     * Les RATTACHEMENTS qui donnent son sens à un élément.
     *
     * Un incident sans ses machines est une ligne de registre ; avec elles, c'est un fait
     * qu'on peut situer. Une application sans sa composante ni son service ne se rattache à
     * personne. C'est ce qui sépare une réponse exacte d'une réponse utilisable.
     */
    contexte?: string[]
    /**
     * Ce qui NOIE l'information, et qu'on tait.
     *
     * Le pendant obligatoire de `detailsMinimums` et `contexte`. Une consigne qui n'ajoute
     * que des champs produit un mur de texte où la réponse se perd — le contraire de ce
     * qu'on cherche, obtenu en voulant bien faire.
     */
    aOmettre?: string[]
    /**
     * CETTE QUESTION ACCEPTE LES FILTRES PUBLIÉS DE SON CATALOGUE.
     *
     * Déclarer 649 filtres à la main donnerait quinze filtres utiles et laisserait le reste
     * inaccessible — c'est ce qu'on a commencé à faire avec `criticite` et `composanteId`
     * avant de comprendre que le contrat les portait tous.
     */
    filtresPublies?: boolean
    /**
     * LA FORME DONT NOS POST-CONDITIONS DÉPENDENT — déclarée pour être surveillée.
     *
     * Le Catalogue et Sniff déploient vite, et c'est une qualité. Mais si `domainesExamines`
     * ou `resultats` change de nom demain, nos post-conditions cessent de se déclencher EN
     * SILENCE : la réponse sort, plausible, sans ses mises en garde. C'est le mode de panne
     * que ce projet combat partout, et il était béant ici — la recherche a quatorze cas
     * exécutables, les questions n'en avaient aucun.
     */
    attendChamps?: string[]
    /**
     * Paramètres anodins pour l'essai de forme. Une question dont un paramètre obligatoire
     * n'a pas de valeur d'essai est couverte par la sonde de portée seulement.
     */
    essai?: Record<string, string>
    /**
     * Ce qu'on SAIT d'un échec de forme en cours. Un rouge compris qui s'affiche comme un
     * rouge mystérieux fait rediagnostiquer chaque lecteur futur — la note dit la cause
     * établie et ce qui le fera passer au vert. À retirer avec le correctif.
     */
    essaiNote?: string
    /**
     * Paramètres appliqués quand le modèle ne les fournit pas.
     *
     * Un défaut de l'API n'est pas toujours le défaut qu'on veut : Sniff trie par date de
     * MODIFICATION, ce qui fait de « les derniers incidents » les derniers touchés — rarement
     * l'intention. On impose donc le tri par date de connaissance, et le modèle garde la
     * possibilité de demander autre chose.
     */
    defauts?: Record<string, string>
    /**
     * LA JOINTURE APPARTIENT AU SERVEUR, PAS AU CLIENT.
     */
    /**
     * Mentions à porter dans la réponse SELON CE QUE LES DONNÉES CONTIENNENT.
     *
     * Chaque règle regarde le corps de la réponse et rend une phrase, ou rien. C'est ce qui
     * distingue « on a regardé, il n'y a rien » de « personne n'a jamais rempli ça » —
     * distinction qu'aucun champ ne porte, et sans laquelle l'assistant produit des réponses
     * rassurantes et fausses.
     */
    /**
     * Les post-conditions reçoivent le corps ET LES PARAMÈTRES EMPLOYÉS.
     *
     * Elles n'avaient que le corps, ce qui suffit tant que le piège laisse une trace
     * dedans. Sniff en a introduit un qui n'en laisse aucune : un incident sans date de
     * connaissance sort SILENCIEUSEMENT de tout résultat borné par période. Rien dans la
     * réponse ne dit qu'une ligne a été écartée — c'est l'absence même qu'il faut
     * signaler, et seule la requête sait qu'on a borné.
     */
    postconditions?: ((corps: any, params?: Record<string, string>) => string | null)[]
}

/**
 * Les catalogues servis par le routeur générique du Catalogue, relevés.
 *
 * C'est une liste FERMÉE, et c'est ce qui permet de n'avoir qu'une question pour
 * soixante-neuf tables sans que le modèle compose une URL : une valeur hors de cette liste
 * est écartée par `executer()` avant l'appel.
 */
const CATALOGUES = [
    'applications', 'serveurs', 'postes', 'postes-travail', 'appareils-mobiles', 'iot',
    'machines-indus', 'technologies', 'vpn', 'tiers', 'personnes', 'populations', 'groupes',
    'entites', 'composantes', 'departements', 'services', 'poles', 'lieux', 'annuaire',
    'referents', 'competences', 'matrice-competences', 'actifs-smsi',
    'actifs-informationnels', 'risques-smsi', 'mesures-smsi', 'clauses-iso27001',
    'objectifs-smsi', 'documents-smsi', 'audits-smsi', 'non-conformites', 'revues-direction',
    'exigences-nis2', 'objectifs-nis2', 'actions-nis2', 'plan-actions-nis2',
    'notifications-nis2', 'entite-nis2', 'entite-responsables', 'exigences-legales',
    'parties-interessees', 'parties-prenantes', 'sources-risque', 'evenements-redoutes',
    'scenarios-strategiques', 'scenarios-operationnels', 'opportunites', 'processus',
    'perimetres', 'sections-cnu', 'cadres', 'equipements-reseau', 'zones-reseau',
    'flux-reseau', 'liens-reseau', 'interconnexions-externes', 'flux-applicatifs',
    'actif-dependances', 'composantes-volumetrie',
] as const

/**
 * Vocabulaires fermés de Sniff, donnés par leur équipe en `72d3857`.
 *
 * Ils étaient déclarés en texte libre faute de les connaître, et c'est ce qui a laissé
 * partir `severity=P1` — refusé en 422, puis affiché comme un trou documentaire. Une valeur
 * hors de ces listes est désormais écartée par `executer()` AVANT l'appel.
 */
const SNIFF_SEVERITE = ['critical', 'high', 'medium', 'low', 'P1', 'P2', 'P3', 'P4'] as const
const SNIFF_STATUT = ['open', 'investigating', 'in_progress', 'surveillance', 'resolved', 'closed'] as const
/**
 * Les issues de triage, publiées par Sniff en `bb1f0d6`.
 */
export const SNIFF_RESOLUTION = ['true_positive', 'false_positive', 'benign', 'legitimate', 'duplicate'] as const

export const SNIFF_TYPE = ['phishing', 'malware', 'ransomware', 'data_breach', 'ddos', 'network_intrusion', 'other'] as const

// -------------------------------------------------------------------------------------
// Post-conditions réutilisables.
// -------------------------------------------------------------------------------------

/** Un bloc à `null` veut dire « pas le droit de lire », jamais « rien à signaler ». */
const cadresNonLus = (corps: any): string | null => {
    const lus: string[] | undefined = corps?.cadresLus
    if (!Array.isArray(lus)) return null
    const tous = ['nis2', 'iso27001', 'rgpd']
    const absents = tous.filter(c => !lus.includes(c))
    if (!absents.length) return null
    return `Les cadres ${absents.join(', ')} n'ont pas pu être lus faute de droits. `
        + `Leur absence de cette réponse ne veut pas dire qu'ils sont sans écart.`
}

/** Un total nul peut vouloir dire « rien », ou « personne n'a rempli ». */
const totalNul = (quoi: string, siVide: string) => (corps: any): string | null => {
    const total = corps?.total ?? (Array.isArray(corps) ? corps.length : undefined)
    return total === 0 ? `Aucun ${quoi} n'est remonté. ${siVide}` : null
}

/** Le connecteur n'a jamais abouti : l'écart n'est pas calculable. */
/**
 * `dernierStatut: 'jamais'` est désormais porté par la couche champ-valeur, qui s'applique à
 * toute réponse. Ne reste ici que ce qui tient à CETTE route : un écart de couverture qui
 * vaut zéro parce qu'aucun groupe critique n'est déclaré. Aucun champ ne le dit, il se
 * déduit — c'est donc bien une post-condition de question.
 */
const connecteurJamais = (corps: any): string | null =>
    corps?.reglesDeclarees === 0
        ? "Aucun groupe critique n'est déclaré : l'écart vaut zéro par construction, pas par constat."
        : null

/** Le taux qui dit ce que valent les autres chiffres. */
const rapprochementsAmbigus = (corps: any): string | null => {
    const n = corps?.comptes?.ambigus
    return n > 0
        ? `${n} rapprochement(s) non tranché(s) : les chiffres ci-dessus sont à prendre avec cette réserve, `
          + `un rapprochement faux étant pire qu'une absence de rapprochement parce qu'il produit un nombre.`
        : null
}

/**
 * CE QUI A ÉTÉ REGARDÉ, ET CE QUI NE L'A PAS ÉTÉ.
 *
 * - `domainesExamines` — les domaines effectivement REGARDÉS. Un domaine absent d'ici n'a
 *   pas été examiné, faute de droits.
 * - `domainesAvecLacune` — ceux qui ont DONNÉ quelque chose. Un domaine examiné et absent
 *   d'ici va bien.
 */
const domainesNonExamines = (corps: any): string | null => {
    const examines: string[] | undefined = corps?.domainesExamines
    const avecLacune: string[] = corps?.domainesAvecLacune ?? []
    if (!Array.isArray(examines)) {
        return "Cette réponse ne porte pas `domainesExamines` : impossible de distinguer un domaine sain "
            + "d'un domaine jamais regardé. Le Catalogue est en version antérieure au correctif du 27 août 2026."
    }
    const sains = examines.filter(d => !avecLacune.includes(d))
    const phrases = [
        `Domaines effectivement examinés : ${examines.join(', ') || 'aucun'}.`,
        sains.length ? `Examinés et sans lacune : ${sains.join(', ')}.` : null,
        "Tout domaine absent de la liste des domaines examinés N'A PAS ÉTÉ REGARDÉ, faute de droits — "
            + "son absence de cette réponse ne vaut pas « rien à signaler ».",
    ].filter(Boolean)
    return phrases.join(' ')
}

/** Le champ `pourquoi` est rédigé pour être répercuté, et pas seulement le chiffre. */
const pourquoiDesLacunes = (corps: any): string | null => {
    const lignes: any[] = corps?.resultats ?? corps?.lacunes ?? []
    const aveugles = lignes.filter(l => l?.gravite === 'aveugle' && l?.pourquoi)
    if (!aveugles.length) return null
    return "Domaines sur lesquels le Catalogue est AVEUGLE, avec la conséquence telle qu'il la formule : "
        + aveugles.map(l => `${l.domaine ?? l.cle ?? '?'} — ${l.pourquoi}`).join(' · ')
}

/** Un total tronqué par la portée du compte n'est pas le total de l'établissement. */
const totalRestreintParLaPortee = (corps: any): string | null =>
    corps?.total !== undefined
        ? "Les échéances portant sur une catégorie hors de la portée de la clé de service sont retirées : "
          + "ce total n'est pas nécessairement celui de l'établissement."
        : null

/**
 * Pourquoi une règle n'a pas d'échéance. Cinq motifs, qui n'appellent pas la même suite.
 *
 * `sans_date` est le seul qui soit un défaut de donnée : l'EDR n'a pas fourni de date de
 * création, donc la revue annuelle n'est pas calculable. Le confondre avec `editeur`, qui
 * n'est pas soumis à revue, ferait passer un angle mort pour une décision.
 */
const MOTIFS_SANS_ECHEANCE: Record<string, string> = {
    editeur: "fournies par l'éditeur, non soumises à revue",
    disparue: "absentes de l'EDR au dernier relevé : elles ne s'appliquent plus",
    technique: 'règles de configuration identifiées par un marqueur déclaré',
    sans_date: "l'EDR n'a pas fourni de date de création : l'échéance n'est PAS calculable, ce qui est un angle mort et non une décision",
    portee_par_sniff: 'appariées à une exclusion : la date de revue est portée par Sniff',
}

const echeancesNonCalculables = (corps: any): string | null => {
    const lignes: any[] = corps?.resultats ?? []
    const parMotif = new Map<string, number>()
    for (const l of lignes) {
        if (l?.echeance == null && l?.sansEcheance) {
            parMotif.set(l.sansEcheance, (parMotif.get(l.sansEcheance) ?? 0) + 1)
        }
    }
    if (!parMotif.size) return null
    const detail = [...parMotif].map(([motif, n]) =>
        `${n} ${MOTIFS_SANS_ECHEANCE[motif] ?? `motif « ${motif} », non documenté ici`}`).join(' · ')
    return `Des règles sont sans échéance calculée : ${detail}.`
}

/**
 * La recherche thématique est LITTÉRALE.
 *
 * Aucun synonyme n'est ajouté côté serveur. Un référentiel qui traite du sujet avec
 * d'autres mots ne ressort pas — d'où l'obligation de dire quels termes ont été employés,
 * sans quoi « rien sur les mots de passe » se lit comme un constat alors que ce n'est que
 * le résultat d'un choix de vocabulaire.
 */
const termesEmployes = (corps: any): string | null => {
    const termes: string[] = corps?.termes ?? corps?.q?.split?.(',') ?? []
    const employes = termes.map((t: string) => t.trim()).filter(Boolean)
    return "Cette recherche est littérale : aucun synonyme n'est ajouté côté serveur."
        + (employes.length ? ` Termes employés : ${employes.join(', ')}.` : '')
        + " Un référentiel traitant du sujet avec d'autres mots ne ressort pas — relancer avec d'autres termes"
        + ' plutôt que conclure à une absence.'
}

/**
 * Le routeur générique rend DEUX formes, et une seule porte le total.
 *
 * Sans `page` ni `pageSize`, la réponse est le tableau complet ; avec, c'est
 * `{ rows, total, page, pageSize }`. Compter les lignes reçues ne donne le bon nombre que
 * par hasard — et par hasard, ça marche souvent, jusqu'au jour où le référentiel dépasse
 * la page.
 */
const formeGenerique = (corps: any): string | null =>
    Array.isArray(corps)
        ? "Cette réponse est le tableau complet, sans total déclaré par le serveur : ne pas dénombrer sur "
          + "le nombre de lignes reçues, redemander avec `pageSize` pour obtenir un total."
        : null

// L'ÉQUIVALENCE P1 / `critical` A ÉTÉ RETIRÉE D'ICI, ET C'EST UN PROGRÈS.
//
// Elle y avait été écrite après un faux négatif en service : « on a eu un incident P1 » →
// « Non, l'incident a une gravité critique, mais pas de niveau P1 ». L'incident ÉTAIT un P1.

/** Le relais d'incidents plafonne, et le dit. */
const relaisPlafonne = (corps: any): string | null =>
    corps?.lus !== undefined && corps?.plafond !== undefined && corps.lus >= corps.plafond
        ? `Seuls ${corps.lus} incidents ont été lus (plafond du relais). Cette réponse est partielle et ne permet aucun décompte.`
        : null

/** Le miroir vieillit sans se vider. */
const fraicheurMiroir = (corps: any): string | null => {
    const d = corps?.source?.dernierAccesAt
    if (!d) return null
    const heures = (Date.now() - new Date(d).getTime()) / 3600_000
    return heures > 24
        ? `Ces compteurs viennent d'un miroir dont le dernier accès à la source remonte à ${Math.round(heures)} h.`
        : null
}

/** Le tri par défaut de Sniff porte sur la date de MODIFICATION. */
const triParModification = (corps: any): string | null =>
    typeof corps?.tri === 'string' && corps.tri.includes('updatedAt')
        ? "Le tri porte sur la date de MODIFICATION, pas sur celle du signalement. "
          + "« Les derniers » désigne donc les derniers modifiés — demander `sort=knowledgeAt` pour l'ordre réglementairement pertinent."
        : null

// -------------------------------------------------------------------------------------

export const QUESTIONS: readonly Question[] = [

    // ----- Sécurité opérationnelle ---------------------------------------------------
    {
        cle: 'listes_blanches',
        attendChamps: ['total', 'resultats', 'resultats.ouCorriger', 'resultats.sansEcheance'],
        detailsMinimums: [
            "l'identifiant", 'le libellé', "les dates de création et d'échéance",
            "l'endroit où elle se répare (`ouCorriger`)",
        ],
        contexte: ["l'origine de chaque règle — établissement ou éditeur"],
        aOmettre: ['le contenu technique des règles, sauf si la question le vise'],
        domaines: ['listes-blanches', 'edr', 'connecteurs'],
        intitule: "Quelles listes blanches sont en place, lesquelles ont expiré, et pourquoi une alerte ne remonte plus",
        source: 'catalogue', chemin: '/api/whitelists',
        parametres: [
            { cle: 'origine', libelle: "Qui l'a écrite", valeurs: ['etablissement', 'editeur'] },
            { cle: 'echues', libelle: 'Seulement les échues', valeurs: ['true'] },
            { cle: 'sansMotif', libelle: 'Seulement celles sans motif écrit', valeurs: ['true'] },
            { cle: 'active', libelle: 'Seulement les actives', valeurs: ['true', 'false'] },
        ],
        postconditions: [
            // Le décompte exact ne vit PAS ici. Deux relevés successifs du Catalogue ont
            // donné 68 puis « environ quarante » règles d'établissement sur ~4 800 : un
            // nombre figé dans le code serait faux dès le relevé suivant, et faux avec
            // l'autorité du code. Seul l'ordre de grandeur est stable, et il suffit.
            totalNul('résultat', "Sans `origine=etablissement`, les quelques dizaines de règles écrites par la cellule sont noyées dans les milliers livrées avec le produit — vérifier le filtre avant de conclure."),
            echeancesNonCalculables,
            /**
             * OÙ CHAQUE RÈGLE SE RÉPARE, ligne par ligne.
             *
             * Le Catalogue porte désormais `ouCorriger` sur chaque ligne, et non plus
             * seulement dans les mises en garde générales. C'est la chose la plus utile
             * qu'un assistant qui n'écrit nulle part puisse dire d'un problème qu'il
             * signale : « 34 listes blanches sans motif » laisse le travail à moitié fait
             * si personne ne sait où le motif s'écrit — et il s'écrit à trois endroits
             * différents selon l'origine de la règle.
             */
            corps => {
                const lieux = new Set<string>()
                for (const r of corps?.resultats ?? []) if (r?.ouCorriger) lieux.add(String(r.ouCorriger))
                if (!lieux.size) return null
                return "Chaque ligne porte OÙ ELLE SE RÉPARE, et ce n'est pas le même endroit selon son "
                    + `origine : ${[...lieux].join(' · ')}. Le dire pour chaque règle citée — le Catalogue `
                    + "n'écrit ni dans l'EDR ni dans Sniff, et signaler sans dire où corriger laisse le "
                    + 'travail à moitié fait.'
            },
            corps => (corps?.resultats ?? []).some((r: any) => r.certitudeRapprochement === 'probable')
                ? "Certains rapprochements avec Sniff sont marqués « probable » : le lien repose sur la portée, pas sur une référence d'outil. C'est un indice, pas une preuve."
                : null,
            corps => (corps?.resultats ?? []).some((r: any) => !r.motif)
                ? "Au moins une liste blanche est sans motif écrit : indéfendable en revue."
                : null,
        ],
    },
    {
        cle: 'couverture_edr',
        attendChamps: ['comptes', 'dernierStatut'],
        detailsMinimums: ['le nom de chaque machine citée'],
        contexte: [
            'son dernier état vu et sa date',
            'son rattachement : composante, groupe',
        ],
        domaines: ['edr', 'parc', 'connecteurs'],
        intitule: "Quelles machines devraient être surveillées par l'EDR et ne le sont pas",
        source: 'catalogue', chemin: '/api/harfanglab/couverture',
        parametres: [],
        postconditions: [connecteurJamais, rapprochementsAmbigus],
    },
    {
        cle: 'moteurs_edr',
        attendChamps: ['changements'],
        contexte: ['pour chaque changement : la machine ou le moteur concerné, et la date'],
        domaines: ['edr', 'connecteurs'],
        intitule: "Quels moteurs de détection ont changé d'état, et lesquels se sont éteints",
        source: 'catalogue', chemin: '/api/harfanglab/moteurs',
        parametres: [],
        postconditions: [
            () => "Les valeurs de `modes` sont des entiers que l'éditeur ne documente pas : elles ne se traduisent pas en « activé » ou « désactivé ». Seuls les changements sont exploitables.",
        ],
    },
    {
        cle: 'regles_detection',
        attendChamps: ['total', 'resultats'],
        essai: { moteur: 'sigma' },
        detailsMinimums: ['le nom de la règle', 'le moteur'],
        contexte: ["l'origine de chaque règle — établissement ou éditeur"],
        aOmettre: ["le corps complet des règles : citer le nom et l'extrait qui répond, jamais le code entier"],
        domaines: ['edr', 'connecteurs'],
        intitule: "Que surveille-t-on réellement — quelle règle de détection mentionne tel terme",
        source: 'catalogue', chemin: '/api/edr/regles/{moteur}',
        parametres: [
            { cle: 'moteur', libelle: 'Moteur', valeurs: ['yara', 'sigma', 'ioc', 'correlation', 'driverblock'], obligatoire: true },
            { cle: 'q', libelle: 'Terme cherché, y compris dans le corps des règles' },
            { cle: 'origine', libelle: 'Qui l\'a écrite', valeurs: ['etablissement', 'editeur'] },
        ],
        postconditions: [
            (corps: any) => corps?.moteur === 'yara'
                ? "Le moteur YARA expose des FICHIERS, pas des règles à l'unité : ce décompte n'est pas un nombre de règles."
                : null,
            totalNul('résultat', "Un décompte nul ne vaut pas absence de couverture — au 27 août 2026, l'établissement n'a aucun IOC, et c'est un fait, pas une lacune."),
        ],
    },

    {
        cle: 'jeux_de_regles',
        // `appliqueSurUnePolitique` vit sur le DÉTAIL (/rulesets/{id}) — le contrat le
        // disait, je l'avais mal lu, et la post-condition qui le lisait sur la liste était
        // morte de naissance. Le harnais des formes l'a prouvé à son premier passage, et
        // `--montrer` a tranché : sur la liste, « aucune politique » se dit `politiques: []`.
        attendChamps: ['resultats', 'resultats.politiques'],
        detailsMinimums: ['le nom du jeu de règles', "les politiques auxquelles il est rattaché — ou le fait qu'il ne l'est à aucune"],
        domaines: ['edr', 'connecteurs'],
        intitule: "Quels jeux de règles ne sont appliqués sur aucun poste",
        source: 'catalogue', chemin: '/api/edr/rulesets',
        parametres: [{ cle: 'sansPolitique', libelle: "Seulement ceux rattachés à aucune politique", valeurs: ['true'] }],
        postconditions: [
            corps => (corps?.resultats ?? []).some((r: any) => Array.isArray(r.politiques) && !r.politiques.length)
                ? "Des jeux de règles ne sont rattachés à AUCUNE politique : ils existent dans la console mais ne s'appliquent sur aucun poste."
                : null,
        ],
    },
    {
        cle: 'certificats',
        attendChamps: ['total', 'resultats', 'resultats.dernierStatut'],
        detailsMinimums: [
            'le domaine ou le nom du certificat',
            'la nature du défaut — expiration et chaîne invalide sont deux pannes distinctes',
            "la date d'expiration quand elle figure",
        ],
        domaines: ['certificats', 'connecteurs'],
        intitule: "Quels certificats TLS expirent, et lesquels présentent une chaîne invalide",
        source: 'catalogue', chemin: '/api/certificats',
        parametres: [{ cle: 'probleme', libelle: 'Seulement ceux en défaut', valeurs: ['true'] }],
        postconditions: [
            // Une chaîne incomplète et un certificat expiré sont deux pannes distinctes, et
            // la première ne remonte dans aucune alerte d'échéance : elle n'a pas de date.
            corps => (corps?.resultats ?? []).some((r: any) => r.chaineValide === false)
                ? "Des certificats présentent une chaîne incomplète ou une racine inconnue. C'est un état distinct de l'expiration, et il n'a pas de date : il ne remontera dans aucune alerte d'échéance."
                : null,
        ],
    },

    // ----- Conformité ----------------------------------------------------------------
    {
        cle: 'ecarts_conformite',
        attendChamps: ['cadresLus', 'total', 'resultats'],
        detailsMinimums: [
            "la référence de l'exigence et son cadre", 'son libellé',
            'son état, dans le vocabulaire de SON cadre',
        ],
        // « On a une application qui a des problèmes RGPD ? » rendait des exigences, jamais
        // des applications : rien ne demandait le rattachement, et le lecteur repartait avec
        // une liste d'articles au lieu de la liste des applications à traiter. La garde du
        // mécanisme s'applique — « s'ils n'y figurent pas, le dire, et jamais les deviner » —
        // donc déclarer ce rattachement ne peut pas fabriquer un lien qui n'existe pas.
        contexte: [
            "l'application ou le traitement concerné quand l'écart en désigne un, et le REGROUPER par application quand la question porte sur les applications",
            "la portée de l'écart — établissement ou application — qui décide de qui doit le traiter",
        ],
        domaines: ['conformite', 'rgpd'],
        // L'INTITULÉ EST LA SEULE SURFACE QUE L'ORIENTATION VOIT.
        //
        // Un intitulé n'est pas une étiquette : c'est le seul texte sur lequel se décide
        // l'aiguillage d'une question réelle.
        intitule: "Où en est-on sur la conformité RGPD, NIS 2 ou ISO 27001 — quels écarts sont constatés, avec ou sans plan d'action",
        source: 'catalogue', chemin: '/api/conformite/ecarts',
        parametres: [
            { cle: 'cadre', libelle: 'Cadre', valeurs: ['nis2', 'iso27001', 'rgpd', 'tous'] },
            { cle: 'sansPlan', libelle: "Seulement les écarts sans plan d'action", valeurs: ['true'] },
            { cle: 'nonEvaluees', libelle: 'Inclure les exigences jamais évaluées', valeurs: ['true', 'false'] },
        ],
        postconditions: [
            cadresNonLus,
            totalNul('écart', "Attention : une exigence jamais évaluée n'est pas une exigence conforme. Vérifier que `nonEvaluees` n'a pas été mis à `false`."),
            () => "Les trois cadres n'emploient pas le même vocabulaire — « conforme » se dit `fait` en NIS 2. Ne pas comparer ces valeurs d'un cadre à l'autre.",
        ],
    },
    {
        cle: 'exigence_precise',
        attendChamps: ['manques'],
        essai: { reference: 'A.5.9' },
        contexte: ['qui en est responsable', "l'état d'évaluation et sa date"],
        domaines: ['conformite', 'rgpd'],
        intitule: "Que dit une exigence précise, où en est-elle, et qui en est responsable",
        source: 'catalogue', chemin: '/api/conformite/exigence',
        parametres: [{ cle: 'reference', libelle: 'Référence — 1.1-EI/EE, A.5.9, art. 32', obligatoire: true }],
        postconditions: [
        ],
    },
    {
        cle: 'plan_conformite',
        attendChamps: ['total', 'tri', 'resultats'],
        detailsMinimums: ["l'action", 'son échéance', "le cadre ou l'exigence qu'elle sert, quand ils figurent"],
        domaines: ['conformite'],
        intitule: "Quelles actions de mise en conformité sont en retard",
        source: 'catalogue', chemin: '/api/conformite/plan',
        parametres: [
            { cle: 'cadre', libelle: 'Cadre', valeurs: ['nis2', 'iso27001', 'rgpd', 'tous'] },
            { cle: 'enRetard', libelle: 'Seulement celles en retard', valeurs: ['true'] },
        ],
        postconditions: [cadresNonLus],
    },

    {
        cle: 'recherche_conformite',
        attendChamps: ['resultats'],
        essai: { q: 'mot de passe' },
        detailsMinimums: ['la référence du passage et son cadre'],
        domaines: ['conformite', 'rgpd'],
        intitule: "Que disent les référentiels sur tel sujet — mot de passe, sauvegarde, sous-traitance",
        source: 'catalogue', chemin: '/api/conformite/recherche',
        parametres: [{
            cle: 'q',
            libelle: 'Termes cherchés, séparés par des virgules — en proposer plusieurs, la recherche est littérale',
            obligatoire: true,
        }],
        postconditions: [
            termesEmployes,
            totalNul('passage', "Cela ne veut pas dire que les référentiels ne traitent pas du sujet : ils peuvent en traiter avec d'autres mots."),
        ],
    },
    {
        cle: 'risques',
        attendChamps: ['total', 'resultats'],
        detailsMinimums: [
            'le libellé du risque', 'son niveau quand il figure',
            'le traitement décidé — ou son absence, qui est la réponse',
        ],
        domaines: ['risques', 'conformite'],
        intitule: "Quels risques sont identifiés, et lesquels n'ont aucun traitement décidé",
        source: 'catalogue', chemin: '/api/conformite/risques',
        parametres: [{ cle: 'sansTraitement', libelle: 'Seulement ceux sans traitement décidé', valeurs: ['true'] }],
        postconditions: [
            cadresNonLus,
            totalNul('risque', "Un registre des risques vide et un registre jamais rempli produisent le même zéro."),
        ],
    },
    {
        cle: 'analyses_impact',
        attendChamps: ['resultats'],
        detailsMinimums: [
            "le traitement ou l'application concernés", "l'état de l'analyse",
            'la date de réexamen — ou son absence',
        ],
        domaines: ['rgpd', 'risques'],
        intitule: "Où en sont les analyses d'impact (AIPD) sur la protection des données — lesquelles sont à réexaminer",
        source: 'catalogue', chemin: '/api/conformite/aipd',
        parametres: [],
        postconditions: [
            corps => (corps?.resultats ?? []).some((r: any) => r.revueEchue)
                ? "Des analyses d'impact ont un réexamen dépassé au titre de l'article 35.11 du RGPD."
                : null,
            corps => (corps?.resultats ?? []).some((r: any) => r.sansDateDeRevue)
                ? "Des analyses achevées n'ont AUCUNE date de réexamen programmée : elles ne remonteront dans aucune alerte d'échéance."
                : null,
        ],
    },
    {
        cle: 'exigences_rgpd',
        attendChamps: ['conformite', 'liens', 'portee'],
        detailsMinimums: [
            "la référence ou l'article", 'le libellé',
            "l'état `conformite` tel quel — `null` signifie « non tranché », jamais « non »",
        ],
        domaines: ['rgpd'],
        intitule: "Que demande le RGPD, au niveau de l'établissement ou d'une application",
        source: 'catalogue', chemin: '/api/rgpd/exigences',
        parametres: [
            { cle: 'portee', libelle: 'Portée', valeurs: ['etablissement', 'application', 'les_deux'] },
            { cle: 'niveau', libelle: "Rendre ce qu'affiche la fiche d'une application", valeurs: ['application'] },
        ],
        postconditions: [
            () => "Les `liens` vers NIS 2 et l'ISO sont des rapprochements NON OFFICIELS : à présenter comme tels, jamais comme une équivalence réglementaire.",
            // La post-condition « sans état » a été RETIRÉE : elle lisait `resultats[].etat`
            // sur un tableau nu dont le champ s'appelle `conformite` — morte de naissance —
            // et la lecture publiée par le Catalogue (`conformite: null`, avec son
            // ouCorriger) couvre déjà le cas, mieux qu'une copie locale.
        ],
    },

    {
        /**
         * LES APPLICATIONS PAR ÉTAT RGPD — livrée par le Catalogue.
         *
         * Sans filtre, cette question était impossible à répondre honnêtement : `etatRgpd`
         * est une colonne CALCULÉE, le catalogue pagine, et notre consigne interdit au
         * modèle de dénombrer les lignes qu'il reçoit. La seule réponse correcte aurait
         * été « je ne peux pas compter » — leur filtre, avec son total compté par la base,
         * est ce qui rend la question possible.
         */
        cle: 'applications_rgpd',
        attendChamps: ['rows', 'total', 'rows.etatRgpd'],
        essai: { etatRgpd: 'ecart', pageSize: '1' },
        detailsMinimums: [
            "le NOM de l'application, jamais son identifiant technique comme intitulé",
            'son état RGPD',
            "le nombre d'exigences en écart, rapporté au nombre d'exigences évaluées",
        ],
        // `pageSize` force la forme paginée, donc le TOTAL compté par la base. Sans lui la
        // route rend le tableau nu, et la réponse ne peut plus dire combien — c'est
        // exactement ce que le filtre livré par le Catalogue existe pour permettre.
        defauts: { pageSize: '50' },
        contexte: ["l'avancement de l'évaluation — combien d'exigences évaluées sur combien", "l'analyse d'impact (AIPD) quand elle figure"],
        aOmettre: [
            'les colonnes techniques sans portée métier',
            "l'identifiant technique, sauf s'il est demandé pour retrouver la fiche",
        ],
        domaines: ['rgpd', 'conformite'],
        intitule: "Quelles applications sont en écart RGPD, lesquelles ne sont pas évaluées, lesquelles sont conformes",
        source: 'catalogue', chemin: '/api/applications',
        parametres: [
            { cle: 'etatRgpd', libelle: 'État RGPD calculé', valeurs: ['ecart', 'non_evalue', 'conforme', 'hors_perimetre'] },
            { cle: 'pageSize', libelle: 'Nombre de résultats' },
            { cle: 'page', libelle: 'Page' },
        ],
        postconditions: [
            formeGenerique,
            // Le total suit le filtre, et c'est ce qui le rend citable. Le dire évite la
            // lecture inverse — « 4 applications » pris pour la taille du catalogue.
            corps => corps?.total !== undefined
                ? "Le `total` porte sur le FILTRE demandé, pas sur le catalogue entier : c'est un nombre d'applications dans cet état, jamais un nombre d'applications."
                : null,
        ],
    },
    {
        cle: 'parc_technologique',
        attendChamps: ['total', 'resultats', 'machinesParOs'],
        detailsMinimums: ['le couple nom + version', 'le statut de support', 'la date de fin de support quand elle figure'],
        contexte: [
            "quand une ligne ne porte pas de version, le dire : la date de fin de support est alors celle d'une release précise, pas celle du produit",
            'quand plusieurs lignes désignent des variantes commerciales du même système, les citer séparément — leur somme suppose de décider quelles variantes comptent, et cette décision appartient à la cellule',
        ],
        domaines: ['parc', 'connecteurs'],
        intitule: "Quelles TECHNOLOGIES sont hors support — la liste des produits, jamais un décompte de machines (pour compter des machines, c'est `fins_de_vie`)",
        source: 'catalogue', chemin: '/api/technologies/parc',
        parametres: [
            // VOCABULAIRE UNIFIÉ. La source portait DEUX vocabulaires pour
            // le même concept dans la même API — `hors_support`/`supporte` ici,
            // `depasse`/`etendu`/`ok` ailleurs — et notre filtre fermé sur l'un serait parti
            // en 422 sur l'autre. Les deux routes appellent maintenant la même fonction, et
            // le champ est renommé `eolStatut` : `statut` était un homonyme (certificats,
            // incidents, actions). `etendu` est la distinction retrouvée au passage — une
            // technologie sous contrat étendu se lisait « supportée », et son renouvellement
            // n'apparaissait nulle part.
            { cle: 'eolStatut', libelle: 'État du support', valeurs: ['depasse', 'etendu', 'bientot', 'ok', 'supporte', 'inconnu'] },
            // `utilisees` COMPTE MAINTENANT LES SERVICES EXPOSÉS, et c'est un correctif de la
            // source, pas un détail. Une technologie qu'aucune application ni aucun serveur
            // ne déclarait restait à zéro usage, donc écartée par ce filtre — invisible là
            // où elle est le plus exposée, en façade sur Internet.
            { cle: 'utilisees', libelle: 'Seulement celles effectivement utilisées (applications, serveurs ET services exposés)', valeurs: ['true'] },
        ],
        aOmettre: [
            "tout décompte de machines en fin de vie tiré de `machinesParOs` : ce bloc agrège par nom de "
            + "produit SANS la version, et c'est la version qui détermine la fin de vie",
        ],
        postconditions: [
            corps => (corps?.resultats ?? []).some((r: any) => r.statut === 'inconnu')
                ? "Des technologies portent `statut: inconnu` — aucune date de fin de vie n'est renseignée. Ce n'est PAS « maintenue »."
                : null,
            () => "Une technologie est identifiée par le couple nom + version : deux versions du même produit sont deux lignes.",
            /**
             * LE BLOC LE PLUS DANGEREUX DE TOUTE L'API, ET IL A L'AIR D'UNE RÉPONSE.
             *
             * Le bloc n'est pas erroné en soi — compter les machines par famille de produit
             * est une question légitime. Il est mortel dès qu'on lui demande une FIN DE VIE,
             * parce que sous Windows la version EST le produit du point de vue du support.
             */
            corps => {
                const parOs = corps?.machinesParOs
                if (!parOs || (Array.isArray(parOs) && !parOs.length)) return null
                return prescrire("`machinesParOs` agrège par NOM DE PRODUIT, sans la version, et recolle une seule date "
                    + "et un seul statut sur l'agrégat. Or c'est la version qui détermine la fin de vie : une même "
                    + "ligne réunit des machines supportées pour des années et des machines dépassées depuis des "
                    + "années, et rien n'indique laquelle de leurs échéances est reprise. N'EN TIRER NI STATUT DE "
                    + "SUPPORT, NI DATE DE FIN DE VIE, NI DÉCOMPTE DE MACHINES DÉPASSÉES. Le décompte par version "
                    + "se demande à /api/eol/etat.")
            },
        ],
    },
    {
        cle: 'chaine_impact',
        /**
         * NOTRE MISE EN GARDE A CÉDÉ DEVANT CELLE DE LA SOURCE — première fois pour une
         * post-condition, et l'occasion valait d'être notée.
         *
         * Nous écrivions « le graphe ne contient que les dépendances DÉCLARÉES ». Le
         * Catalogue écrit désormais la même chose dans `avertissement`, mieux tournée : « un
         * actif sans dépendance saisie apparaît comme sans impact, ce qui n'est pas la même
         * chose que "vérifié sans impact" ». Les deux se déclenchaient ensemble, et le
         * lecteur recevait deux fois l'avertissement en des mots différents — ce qui use
         * l'attention due aux autres.
         */
        attendChamps: [
            'actif.nom', 'actif.urlAbsolue', 'sens', 'total', 'profondeurMax',
            'tronque', 'boucles', 'avertissement', 'resultats',
        ],
        detailsMinimums: ["le nom de l'actif interrogé, et le sens du parcours"],
        aOmettre: ["l'arbre complet quand il dépasse la dizaine d'éléments : citer les branches critiques et dire l'ampleur du reste"],
        domaines: ['parc'],
        intitule: "Qu'est-ce qui tombe si cet actif tombe, et de quoi dépend-il",
        source: 'catalogue', chemin: '/api/impact/{actif}',
        parametres: [
            { cle: 'actif', libelle: "Identifiant de l'actif", obligatoire: true },
            { cle: 'sens', libelle: 'Sens', valeurs: ['aval', 'amont'] },
            { cle: 'profondeur', libelle: 'Profondeur maximale' },
        ],
        postconditions: [
            // Le piège le plus coûteux de ce point d'entrée — une réponse vide et rassurante
            // pour un actif dont personne n'a saisi les dépendances — est désormais dit par
            // la source elle-même, dans `avertissement`. Notre copie a été retirée.
            corps => (corps?.boucles ?? []).length
                ? `Des dépendances circulaires ont été rencontrées (${(corps.boucles as any[]).length}) : les chemins concernés sont à lire avec réserve.`
                : null,
        ],
    },
    {
        cle: 'tiers',
        // `comptes.critiquesSansDpa` était lu par une post-condition sans jamais être
        // vérifié : le déclarer, c'est s'assurer qu'elle ne meurt pas en silence.
        attendChamps: [
            'total', 'lisible', 'resultats', 'avertissements',
            'comptes.critiquesNis2', 'comptes.critiquesSansDpa', 'comptes.contratsEchus',
            'comptes.revuesEchues', 'comptes.sansContact',
        ],
        detailsMinimums: [
            'le nom du prestataire', 'sa criticité au sens NIS 2',
            'ce qui manque à son dossier, quand la source le signale',
        ],
        domaines: ['conformite', 'rgpd'],
        intitule: "Quels prestataires et sous-traitants sont critiques, et lesquels n'ont pas d'accord de traitement (DPA)",
        source: 'catalogue', chemin: '/api/tiers/dossier',
        parametres: [
            { cle: 'critiques', libelle: 'Critiques au sens NIS 2 seulement', valeurs: ['true'] },
            { cle: 'incomplets', libelle: 'Seulement les dossiers incomplets', valeurs: ['true'] },
        ],
        postconditions: [
            corps => corps?.comptes?.critiquesSansDpa > 0
                ? `${corps.comptes.critiquesSansDpa} prestataire(s) critique(s) au sens NIS 2 sans accord de traitement signé.`
                : null,
        ],
    },

    // ----- Patrimoine ----------------------------------------------------------------
    {
        cle: 'dossier_application',
        attendChamps: [
            'identite.nom', 'identite.urlAbsolue', 'identite.statut',
            'criticite.niveau', 'criticite.sensibilite',
            'responsables.technique', 'responsables.metier',
            'hebergement.exposition', 'hebergement.horsSupport',
            'homologation.homologuee', 'homologation.revueEchue',
            'donneesPersonnelles.traite', 'donneesPersonnelles.aipd.statut',
        ],
        contexte: [
            'la composante et le service dont elle relève',
            'ses responsables technique et métier, avec leur fonction',
            "l'hébergement, et si elle est homologuée",
        ],
        aOmettre: ["l'énumération de toutes les technologies : ne citer que celles hors support ou bientôt"],
        domaines: ['parc', 'conformite', 'rgpd'],
        intitule: "Tout ce qu'on sait d'UNE application dont la question donne le nom — criticité, responsables, hébergement, RGPD",
        source: 'catalogue', chemin: '/api/dossier/application/{nom}',
        parametres: [{ cle: 'nom', libelle: "Nom ou identifiant de l'application", obligatoire: true }],
        postconditions: [
        ],
    },
    {
        cle: 'parc_expose',
        attendChamps: ['comptes.lesTrois', 'resultats', 'resultats.agentEdr'],
        detailsMinimums: ['le nom de chaque machine'],
        contexte: ['pour chaque machine : sa composante, son système, et pourquoi elle ressort — hors support, criticité, ou absence d\'agent'],
        domaines: ['parc', 'edr', 'connecteurs'],
        intitule: "Quelles machines cumulent système hors support, criticité et absence d'agent EDR",
        source: 'catalogue', chemin: '/api/parc/expose',
        parametres: [
            { cle: 'horsSupport', libelle: 'Hors support', valeurs: ['true'] },
            { cle: 'sansAgent', libelle: 'Sans agent EDR', valeurs: ['true'] },
            { cle: 'critiques', libelle: 'Critiques seulement', valeurs: ['true'] },
        ],
        postconditions: [
            () => "Deux fiches GLPI peuvent désigner la même machine : un total de fiches n'est pas un nombre de machines.",
        ],
    },
    {
        cle: 'echeances_patrimoine',
        attendChamps: ['total', 'resultats', 'parCategorie', 'parType'],
        detailsMinimums: [
            "l'objet concerné", 'sa catégorie', "la date d'échéance", 'le nombre de jours restants',
        ],
        domaines: ['parc', 'certificats', 'acces', 'connecteurs'],
        intitule: "Qu'est-ce qui est le plus urgent, ou en retard — VPN, contrats, fins de support, certificats, revues",
        source: 'catalogue', chemin: '/api/echeances',
        parametres: [
            { cle: 'jours', libelle: 'Horizon en jours' },
            { cle: 'depassees', libelle: 'Seulement ce qui est déjà dépassé', valeurs: ['true'] },
            { cle: 'categorie', libelle: 'Catégorie' },
            { cle: 'type', libelle: "Type d'échéance" },
        ],
        postconditions: [
            /**
             * LE DÉPASSÉ NE SE CLASSE PAS COMME LE À-VENIR.
             *
             * Sur l'horizon futur, `joursRestants` est un bon ordre : ce qui échoit dans
             * trois jours passe avant ce qui échoit dans trente.
             */
            corps => {
                const passees = (corps?.resultats ?? []).filter((r: any) => (r.joursRestants ?? 0) < 0)
                if (!passees.length) return null
                const plusAncien = Math.min(...passees.map((r: any) => r.joursRestants))
                return `${passees.length} ligne(s) sont DÉJÀ DÉPASSÉES, la plus ancienne de ${Math.abs(plusAncien)} jours. `
                    + `Le dire comme un retard, en jours, et non comme une échéance à venir. `
                    + `Et NE PAS les classer par profondeur de retard : un retard profond est autant le signe `
                    + `d'une donnée que personne ne tient — accès d'un prestataire parti, technologie abandonnée — `
                    + `que d'une tâche non faite, et rien ici ne permet de trancher. Ce qui vient de lâcher se `
                    + `rattrape encore ; ce qui traîne depuis des mois demande d'abord qu'on décide si la ligne `
                    + `est toujours valable. Deux suites différentes, à présenter séparément.`
            },
            // `parCategorie` et `parType` sont comptés PAR LE SERVEUR. Recompter sur les
            // lignes reçues donnerait un nombre plausible et faux dès qu'il y a pagination.
            corps => corps?.parCategorie || corps?.parType
                ? "Les regroupements `parCategorie` et `parType` sont comptés par le serveur : les citer tels quels, ne pas recompter sur les lignes reçues."
                : null,
            totalRestreintParLaPortee,
        ],
    },
    {
        cle: 'responsables',
        attendChamps: ['total', 'resultats'],
        essai: { qui: 'Dupont' },
        contexte: ['le rattachement de chaque personne : entité, composante, service', 'sa fonction, distincte du rôle exercé sur l\'objet'],
        domaines: ['acces'],
        intitule: "Qui est responsable de quoi, ou de quoi telle personne est responsable",
        source: 'catalogue', chemin: '/api/responsables',
        parametres: [
            { cle: 'qui', libelle: 'Nom de la personne' },
            { cle: 'objet', libelle: "Nom de l'objet — application, serveur, exigence" },
        ],
        postconditions: [
            totalNul('responsable', "Cela signifie qu'aucun responsable n'a été ENREGISTRÉ, pas que personne n'exerce cette responsabilité."),
        ],
    },
    {
        cle: 'lacunes_catalogue',
        attendChamps: ['domainesConnus', 'domainesExamines', 'domainesAvecLacune'],
        intitule: "Ce que le Catalogue ne sait pas — les angles morts du référentiel",
        source: 'catalogue', chemin: '/api/lacunes',
        parametres: [],
        postconditions: [domainesNonExamines, pourquoiDesLacunes],
    },

    {
        cle: 'reseau_topologie',
        attendChamps: ['lisible', 'avertissements', 'zones', 'equipements', 'liens', 'interconnexions', 'flux', 'comptes.fluxSansJustification'],
        contexte: ['pour chaque zone citée : son rôle et ses interconnexions'],
        intitule: "Comment le réseau est découpé — zones, VLAN, interconnexions, flux autorisés",
        domaines: ['parc'],
        source: 'catalogue', chemin: '/api/reseau/topologie',
        parametres: [{ cle: 'zone', libelle: 'Zone — DMZ, interne…' }],
        postconditions: [
            // Ce point d'entrée est le plus facile à prendre pour un constat alors qu'il
            // n'en est pas un : il décrit ce qui a été saisi.
            () => "Cette cartographie est DÉCLARATIVE : elle décrit ce qui a été saisi, pas ce que le réseau porte effectivement.",
            corps => corps?.comptes?.fluxSansJustification > 0
                ? `${corps.comptes.fluxSansJustification} flux autorisé(s) sans justification consignée.`
                : null,
        ],
    },
    {
        cle: 'flux_applicatifs',
        attendChamps: [
            'total', 'lisible', 'resultats', 'comptes.touchantDuCritique',
            'comptes.sansNatureDeDonnees', 'comptes.sansSource', 'comptes.sansDestination',
        ],
        detailsMinimums: ['les deux extrémités de chaque flux cité', 'sa justification — ou son absence'],
        intitule: "Quels flux relient les applications, et lesquels sont incomplets — sans source, sans destination, sans nature de données",
        domaines: ['parc'],
        source: 'catalogue', chemin: '/api/flux-applicatifs/carte',
        parametres: [{ cle: 'critiques', libelle: 'Applications critiques seulement', valeurs: ['true'] }],
        postconditions: [
            () => "La nature des données transportées par un flux est un TEXTE LIBRE : elle ne constitue pas une qualification RGPD.",
            corps => {
                const c = corps?.comptes ?? {}
                const manques = [
                    c.sansSource > 0 ? `${c.sansSource} sans source` : null,
                    c.sansDestination > 0 ? `${c.sansDestination} sans destination` : null,
                    c.sansNatureDeDonnees > 0 ? `${c.sansNatureDeDonnees} sans nature de données` : null,
                ].filter(Boolean)
                return manques.length
                    ? `Flux incomplets : ${manques.join(', ')}. Un flux dont la source ou la destination manque ne peut être rattaché à aucun des deux côtés, et échappe donc aux deux vues.`
                    : null
            },
            corps => corps?.comptes?.touchantDuCritique > 0
                ? `${corps.comptes.touchantDuCritique} flux touchent une application critique.`
                : null,
        ],
    },
    {
        cle: 'postes_logiciels',
        attendChamps: ['resultats', 'populations'],
        detailsMinimums: ['le logiciel', 'la population cible — ou son absence, qui est un signal'],
        intitule: "Quels logiciels sont prévus pour quelle population de postes",
        domaines: ['parc'],
        source: 'catalogue', chemin: '/api/postes/par-population',
        parametres: [
            { cle: 'population', libelle: 'Population — personnels, étudiants…' },
            { cle: 'categorie', libelle: 'Catégorie de logiciel' },
        ],
        postconditions: [
            () => "Catalogue DÉCLARATIF : il dit ce qui est prévu, pas ce qui est installé. Il ne reflète aucun constat d'inventaire.",
            corps => (corps?.resultats ?? []).some((r: any) => r.sansPopulation)
                ? "Des logiciels n'ont pas de population cible renseignée : ils ne remonteront dans aucune vue par population."
                : null,
        ],
    },

    // ----- Référentiels --------------------------------------------------------------
    //
    // Ces trois-là passent par le routeur générique du Catalogue, donc par une AUTRE forme
    // de réponse : `{ rows, total, page, pageSize }` avec `page` ou `pageSize`, le tableau
    // complet sans. On passe toujours `pageSize`, faute de quoi le total manquerait et le
    // décompte se ferait sur les lignes reçues — c'est-à-dire par hasard.

    // ----- Référentiels et catalogues ------------------------------------------------
    //
    // SOIXANTE-NEUF CATALOGUES, UNE SEULE QUESTION.
    {
        cle: 'catalogue_generique',
        attendChamps: ['rows', 'total'],
        // Le témoin posé quand six routes manuscrites ne paginaient pas est retiré :
        // le Catalogue a payé la dette — une fonction de pagination partagée, appelée par
        // le routeur générique ET les six routes. Leur contrôle qui compte vérifie
        // désormais que chaque route l'APPELLE : c'était la duplication qui divergeait,
        // pas la règle.
        essai: { catalogue: 'applications', page: '1', pageSize: '1' },
        // LE COMMENTAIRE CI-DESSUS AFFIRMAIT « on passe toujours pageSize » — et le code ne
        // le faisait pas. Sans lui, le routeur rend le tableau complet, sans total : la
        // réponse ne peut plus dénombrer, et `formeGenerique` le dit à chaque appel. Une
        // affirmation de commentaire que le code ne tient pas est la même faute que les
        // trois endroits qui juraient que le résultat brut était affiché alors qu'il ne
        // l'était nulle part.
        defauts: { pageSize: '50' },
        contexte: ["le rattachement de chaque fiche quand il figure : entité, composante, département, service, lieu — dans cet ordre, en s'arrêtant à ce qui est renseigné"],
        aOmettre: ['les colonnes techniques sans portée métier : clés étrangères, horodatages de synchronisation, drapeaux internes'],
        detailsMinimums: [
            "l'identifiant ou la clé", 'le libellé', 'les dates de la fiche quand elles existent',
        ],
        domaines: ['parc', 'conformite'],
        intitule: "Consulter un catalogue par son nom — applications, serveurs, exigences, risques, réseau…",
        source: 'catalogue', chemin: '/api/{catalogue}',
        parametres: [
            { cle: 'catalogue', libelle: 'Catalogue', obligatoire: true, valeurs: [...CATALOGUES] },
            { cle: 'q', libelle: 'Recherche en texte libre dans les colonnes textuelles' },
            // `page` manquait, et son absence a caché une mesure : impossible de savoir si
            // la bascule vers { rows, total } exige `page` tant qu'executer() écartait le
            // paramètre comme non déclaré. Un filtre de paramètres filtre aussi les essais.
            { cle: 'page', libelle: 'Page' },
            // `pageSize` est TOUJOURS passé par `executer()` — voir plus bas. Il reste
            // proposé pour qu'on puisse en demander plus.
            { cle: 'pageSize', libelle: 'Nombre de résultats' },
            { cle: 'sort', libelle: 'Colonne de tri' },
            { cle: 'dir', libelle: 'Sens', valeurs: ['asc', 'desc'] },
        ],
        postconditions: [
            formeGenerique,
            () => "Ces catalogues sont DÉCLARATIFS : ils décrivent ce qui a été saisi, pas ce qui est constaté.",
        ],
    },

    /**
     * QUATRE FAMILLES QUI PASSAIENT PAR LA QUESTION GÉNÉRIQUE, DONC SANS RIEN DIRE.
     *
     * Cinquante-quatre catalogues n'ont pas de question dédiée : ils rendent des listes
     * plates, sans exigence d'identité, sans post-condition, sans rattachement. Ça convient
     * à un référentiel de commodité — les lieux, les sections CNU — et pas du tout aux
     * familles où le SILENCE porte l'information : une non-conformité sans plan, une clause
     * jamais évaluée, un régime NIS 2 non tranché.
     */
    {
        cle: 'smsi',
        attendChamps: ['rows', 'total'],
        essai: { catalogue: 'mesures-smsi', pageSize: '1' },
        domaines: ['conformite', 'risques'],
        intitule: "Où en est le SMSI — mesures de sécurité, clauses ISO 27001, non-conformités, audits, revues de direction, objectifs",
        source: 'catalogue', chemin: '/api/{catalogue}',
        defauts: { pageSize: '50' },
        parametres: [
            {
                cle: 'catalogue', libelle: 'Référentiel du SMSI', obligatoire: true,
                valeurs: [
                    'mesures-smsi', 'clauses-iso27001', 'non-conformites', 'audits-smsi',
                    'revues-direction', 'objectifs-smsi', 'documents-smsi', 'actifs-smsi',
                    'risques-smsi',
                ],
            },
            { cle: 'q', libelle: 'Recherche en texte libre' },
            { cle: 'pageSize', libelle: 'Nombre de résultats' },
        ],
        postconditions: [
            formeGenerique,
            () => "Ces référentiels sont DÉCLARATIFS : ils décrivent ce qui a été saisi, pas ce qui est constaté. "
                + "Une mesure enregistrée n'est pas une mesure vérifiée, et une non-conformité absente du registre "
                + "n'est pas une non-conformité inexistante.",
        ],
    },
    {
        cle: 'nis2_referentiel',
        attendChamps: ['rows', 'total'],
        essai: { catalogue: 'exigences-nis2', pageSize: '1' },
        domaines: ['conformite'],
        intitule: "Ce que NIS 2 exige de nous — notre régime (entité essentielle ou importante), les responsables déclarés, les exigences, le plan d'actions, les notifications déposées",
        source: 'catalogue', chemin: '/api/{catalogue}',
        defauts: { pageSize: '50' },
        parametres: [
            {
                cle: 'catalogue', libelle: 'Référentiel NIS 2', obligatoire: true,
                // `entite-nis2` A ÉTÉ RETIRÉ de cette liste : il rend UN OBJET, pas une
                // page. Le harnais l'a attrapé — « champs DISPARUS : rows, total » — et le
                // défaut était le mien : une question à paramètre fermé suppose que toutes
                // ses valeurs partagent une forme, et je n'avais pas vérifié. Le régime a
                // désormais sa question, ce qu'il méritait de toute façon : c'est une
                // réponse d'un mot, pas un référentiel à parcourir.
                valeurs: [
                    'entite-responsables', 'exigences-nis2', 'objectifs-nis2',
                    'actions-nis2', 'plan-actions-nis2', 'notifications-nis2',
                ],
            },
            { cle: 'q', libelle: 'Recherche en texte libre' },
            { cle: 'pageSize', libelle: 'Nombre de résultats' },
        ],
        postconditions: [
            formeGenerique,
            // Le régime décide des délais eux-mêmes : le confondre avec l'avancement fait
            // répondre « où on en est » à une question qui demande « ce qui s'applique ».
            () => "Le RÉGIME — entité essentielle ou importante — décide des délais de notification et du niveau "
                + "d'exigence. Ce n'est pas un indicateur d'avancement : tant qu'il n'est pas tranché, aucun délai "
                + "ne peut être affirmé.",
            () => "Une notification ENREGISTRÉE ici et un compteur qui court sont deux faits distincts : le compteur "
                + "dit qu'un délai s'écoule, la notification dit qu'une déclaration a été déposée.",

        ],
    },
    {
        cle: 'inventaire_machines',
        attendChamps: ['rows', 'total'],
        essai: { catalogue: 'serveurs', pageSize: '1' },
        domaines: ['parc', 'connecteurs'],
        intitule: "Combien de serveurs, de postes, d'appareils mobiles, d'IoT, de machines industrielles ou d'accès VPN — l'inventaire par NATURE de machine, jamais par système d'exploitation (compter les machines d'un OS, c'est `fins_de_vie`)",
        source: 'catalogue', chemin: '/api/{catalogue}',
        defauts: { pageSize: '50' },
        detailsMinimums: ["le nom de chaque machine citée", 'sa nature'],
        contexte: [
            "son rattachement quand il figure : entité, composante, service, lieu",
            // LA COMBINAISON EST UNE SEULE REQUÊTE, ET SON TOTAL EST LE VRAI CHIFFRE.
            //
            // Les filtres se combinent en ET dans la même requête, et le `where` sert à la
            // fois la page et le décompte : `total` EST le croisement, compté par la base.
            // Ce n'est donc ni une estimation ni une approximation — c'est la réponse.
            "quand plusieurs filtres sont demandés ensemble — criticité ET composante — les poser dans le MÊME appel : ils se combinent en ET et `total` est alors le décompte exact du croisement, compté par la base. Ne jamais l'estimer à partir de deux décomptes séparés",
            "l'identifiant de composante ne s'invente pas : il se lit dans la ventilation par composante du résumé par axe, ou dans le catalogue des composantes. Sans lui, dire qu'il faut d'abord le retrouver — un libellé passé en filtre ne rend rien du tout",
        ],
        aOmettre: ['les colonnes techniques sans portée métier'],
        parametres: [
            {
                cle: 'catalogue', libelle: 'Nature de machine', obligatoire: true,
                valeurs: ['serveurs', 'postes-travail', 'appareils-mobiles', 'iot', 'machines-indus', 'vpn'],
            },
            { cle: 'q', libelle: 'Recherche en texte libre' },
            /**
             * LES DEUX PREMIERS FILTRES CROISABLES — composante et criticité.
             *
             * `criticite` porte un VOCABULAIRE fermé : le modèle choisit dans une liste, ce
             * qui reste choisir et non composer.
             */
            { cle: 'criticite', libelle: 'Criticité métier', valeurs: ['vitale', 'critique', 'essentielle', 'importante', 'secondaire'] },
            { cle: 'composanteId', libelle: 'Identifiant de composante (PAS son libellé)' },
            { cle: 'pageSize', libelle: 'Nombre de résultats' },
        ],
        filtresPublies: true,
        postconditions: [
            formeGenerique,
            /**
             * UN TOTAL FILTRÉ N'EST PAS LE TOTAL DU CATALOGUE, et rien dans le nombre ne le
             * dit. « 47 » répond à « combien de serveurs critiques » comme à « combien de
             * serveurs » — c'est la phrase qui l'accompagne qui décide de sa justesse.
             */
            (corps, params) => {
                const filtres = ['criticite', 'composanteId', 'q'].filter(c => params?.[c])
                return filtres.length && Number.isFinite(corps?.total)
                    ? `\`total\` = ${corps.total} porte sur le FILTRE appliqué `
                      + `(${filtres.map(c => `${c}=${params![c]}`).join(' ET ')}), pas sur le catalogue entier. `
                      + `Nommer la restriction avec le chiffre : un total filtré et un total complet se ressemblent `
                      + `parfaitement.`
                    : null
            },
            // La criticité de sûreté d'une machine industrielle n'est pas la criticité
            // métier d'un serveur — la source a gardé les deux noms distincts pour
            // cette raison, et les additionner produirait un chiffre sans référent.
            () => "La criticité de SÛRETÉ d'une machine industrielle n'est pas la criticité MÉTIER d'un serveur : "
                + "ne jamais additionner les deux, le total n'aurait aucun référent.",
            () => "Deux fiches GLPI peuvent désigner la même machine : un total de fiches n'est pas un nombre de "
                + 'machines physiques.',
            /**
             * UNE RECHERCHE EN TEXTE LIBRE NE FAIT PAS UN RECENSEMENT.
             *
             * D'abord le décompte lui-même : `total` compte les fiches dont un champ CONTIENT
             * le texte cherché. Ce que le nombre recouvre dépend entièrement de la chaîne
             * employée — « Windows 10 » attrape les Éducation, les N, les LTSC et les IoT,
             * « 22H2 » attrape aussi les Windows 11. Le même compte varie avec la formulation,
             * ce qu'aucun recensement ne fait.
             */
            /**
             * COMPTER LES LIGNES D'UNE PAGE, C'EST MESURER UN RÉGLAGE D'AFFICHAGE.
             *
             * « Combien de serveurs avons-nous ? » a rendu « le bloc contient des
             * informations sur 50 serveurs ». Cinquante est notre `pageSize`. Le nombre
             * aurait valu 20 avec une autre valeur par défaut, et personne ne s'en serait
             * aperçu — c'est ce qui distingue ce défaut d'une simple erreur : il produit un
             * chiffre stable, plausible, et entièrement fabriqué par un paramètre.
             */
            (corps, params) => {
                const lignes = corps?.rows ?? corps?.resultats
                if (!Array.isArray(lignes) || !lignes.length) return null
                const taille = Number(params?.pageSize ?? 50)
                if (lignes.length < taille) return null
                const total = corps?.total
                return `Cette réponse ne porte que ${lignes.length} lignes — la taille d'une PAGE, c'est-à-dire un `
                    + `réglage d'affichage, jamais une mesure du parc. `
                    + (Number.isFinite(total)
                        ? `Le nombre demandé est \`total\` = ${total}. Le citer, et ne jamais annoncer ${lignes.length}.`
                        : `Aucun total n'accompagne cette page : dire qu'on ne peut pas les dénombrer, et ne surtout `
                          + `pas avancer ${lignes.length}.`)
            },
            (corps, params) => params?.q
                ? `Ce \`total\` compte les fiches dont un champ CONTIENT « ${params.q} » : c'est une `
                  + `correspondance de texte, pas un recensement. Ce qu'il recouvre dépend de la chaîne — `
                  + `dire laquelle a été employée, et ne jamais présenter ce nombre comme le nombre de machines `
                  + `d'un système. Le décompte par système, exact et versionné, se demande à /api/eol/etat.`
                : null,
        ],
    },
    {
        /**
         * LES COMPÉTENCES SONT UNE ÉVALUATION, ET C'EST TOUT LE SUJET.
         *
         * La question qui motive tout ça vient de l'audit ISO et d'EBIOS à la fois : « avons-
         * nous les compétences pour traiter un ransomware ? ». Y répondre par un décompte
         * qui mêle les non-évaluées rendrait un chiffre rassurant et faux — sur un sujet où
         * l'écart se paie une nuit d'astreinte.
         */
        cle: 'competences',
        attendChamps: ['rows', 'total'],
        essai: { catalogue: 'matrice-competences', pageSize: '1' },
        domaines: ['acces', 'conformite'],
        intitule: "Quelles compétences sont évaluées dans l'équipe, lesquelles manquent, et lesquelles n'ont jamais été évaluées",
        source: 'catalogue', chemin: '/api/{catalogue}',
        defauts: { pageSize: '50' },
        parametres: [
            {
                cle: 'catalogue', libelle: 'Référentiel de compétences', obligatoire: true,
                valeurs: ['competences', 'matrice-competences', 'referents'],
            },
            { cle: 'q', libelle: 'Recherche en texte libre' },
            { cle: 'pageSize', libelle: 'Nombre de résultats' },
        ],
        postconditions: [
            formeGenerique,
            () => "Ces niveaux sont une ÉVALUATION, portée par quelqu'un — pas une déclaration de l'intéressé. "
                + "Une compétence non évaluée n'est NI acquise NI manquante : elle ne peut entrer dans aucun des "
                + "deux décomptes, et un taux de couverture qui l'agrège est faux.",
            () => "Une compétence évaluée sur UNE personne n'est pas une compétence disponible : l'astreinte, les "
                + "congés et les départs décident de ce qui est réellement mobilisable. Le dire quand une compétence "
                + "ne repose que sur une personne.",
            /**
             * LA MATRICE NE PEUT PAS DIRE NON — signalé par la source le 30 août
             *
             * `/api/matrice-competences` est bâtie DEPUIS les détenteurs : elle joint le
             * référentiel aux personnes qui possèdent la compétence. Une compétence que
             * PERSONNE ne détient n'y figure donc pas du tout — elle est déclarée au
             * référentiel, avec son niveau requis, et invisible dans la matrice.
             */
            (_corps, params) => params?.catalogue === 'matrice-competences'
                ? "ATTENTION — cette matrice est bâtie depuis les DÉTENTEURS : une compétence que personne ne "
                  + "possède n'y apparaît pas du tout. Elle ne peut donc jamais montrer un manque total, et "
                  + "l'absence d'une compétence de cette liste ne prouve rien. Pour savoir ce qui manque, comparer "
                  + "au référentiel `competences`, qui porte tout ce qui est requis : l'écart entre les deux est la "
                  + 'réponse.'
                : null,
        ],
    },
    {
        cle: 'ebios_referentiel',
        attendChamps: ['rows', 'total'],
        essai: { catalogue: 'sources-risque', pageSize: '1' },
        domaines: ['risques'],
        intitule: "Le détail de l'analyse EBIOS — sources de risque, événements redoutés, scénarios opérationnels, parties prenantes",
        source: 'catalogue', chemin: '/api/{catalogue}',
        defauts: { pageSize: '50' },
        parametres: [
            {
                cle: 'catalogue', libelle: 'Référentiel EBIOS', obligatoire: true,
                valeurs: [
                    'sources-risque', 'evenements-redoutes', 'scenarios-operationnels',
                    'parties-prenantes', 'opportunites',
                ],
            },
            { cle: 'q', libelle: 'Recherche en texte libre' },
            { cle: 'pageSize', libelle: 'Nombre de résultats' },
        ],
        postconditions: [
            formeGenerique,
            () => "Une analyse EBIOS non commencée et une analyse sans risque produisent le même vide : un "
                + "référentiel vide ne prouve pas l'absence de menace.",
        ],
    },

    {
        /**
         * LE RÉGIME NIS 2 — une réponse d'un mot dont dépendent tous les délais.
         *
         * Essentielle ou importante décide du niveau d'exigence et des délais de
         * notification. Ce n'est pas un indicateur d'avancement, et le confondre avec l'un
         * ferait répondre « où on en est » à une question qui demande « ce qui s'applique ».
         */
        cle: 'regime_nis2',
        attendChamps: [
            'statut', 'secteur', 'enregistreAnssi', 'identifiantAnssi',
            'dateEnregistrement', 'referentId', 'justificationStatut',
        ],
        detailsMinimums: ['le régime et son secteur', "l'enregistrement auprès de l'ANSSI et son identifiant quand il existe"],
        contexte: ["la justification du statut, quand elle est écrite — c'est elle qui rend la décision défendable"],
        domaines: ['conformite'],
        intitule: "Sommes-nous entité essentielle ou importante au sens NIS 2 — le régime, le secteur, et notre enregistrement auprès de l'ANSSI",
        source: 'catalogue', chemin: '/api/entite-nis2',
        parametres: [],
        postconditions: [
            () => "Le RÉGIME décide des délais de notification et du niveau d'exigence : ce n'est pas un indicateur "
                + "d'avancement. Tant qu'il n'est pas tranché, aucun délai ne peut être affirmé.",
        ],
    },
    {
        /**
         * LE RÉSUMÉ DES COMPÉTENCES — cinq états, et trois d'entre eux appellent des
         * décisions qui n'ont rien à voir.
         *
         * Les cinq états n'appellent pas le même travail, et c'est tout l'intérêt de ne pas
         * les fondre : une formation, une évaluation, un recrutement, une décision de
         * référentiel — ou rien.
         */
        cle: 'competences_resume',
        // `jugeables` EST LE DÉNOMINATEUR, et sa présence règle le piège d'un cran plus
        // haut : une compétence sans niveau requis n'est ni couverte ni manquante, elle
        // n'est pas jugeable. Un taux calculé sur `total` mesurerait autre chose que ce
        // qu'il prétend.
        attendChamps: [
            'total', 'jugeables', 'etats.couverte', 'etats.sousNiveau', 'etats.nonEvaluee',
            'etats.sansDetenteur', 'etats.sansExigence', 'detenteurUnique', 'avertissement',
        ],
        detailsMinimums: ['le décompte de chaque état, rapporté au nombre de compétences jugeables'],
        contexte: ['les compétences à détenteur unique, nommées'],
        domaines: ['acces', 'conformite'],
        intitule: "Où en sont nos compétences — couvertes, sous le niveau requis, jamais évaluées, sans détenteur, sans exigence déclarée",
        source: 'catalogue', chemin: '/api/competences/resume',
        parametres: [{ cle: 'domaine', libelle: 'Domaine de compétence' }],
        postconditions: [
            () => "Les cinq états appellent des décisions DIFFÉRENTES et ne se fondent pas : sous le niveau requis "
                + "appelle une formation · jamais évaluée appelle une évaluation · sans détenteur appelle un "
                + "recrutement ou une montée en compétence · sans exigence déclarée appelle une décision de "
                + "référentiel, pas une action RH. Les additionner produirait un chiffre auquel aucune suite ne "
                + 'correspond.',
            () => "Une compétence tenue par UNE SEULE personne au niveau requis s'éteint avec son départ : c'est un "
                + "risque de continuité, que l'ISO 27001 et EBIOS demandent tous deux de traiter.",
            corps => corps?.jugeables !== undefined && corps?.total !== corps?.jugeables
                ? `Tout taux se rapporte à ${corps.jugeables} compétences JUGEABLES, pas à ${corps.total} : celles sans `
                  + `niveau requis déclaré n'ont aucune barre à laquelle se comparer, et les compter comme couvertes `
                  + `gonflerait un chiffre qui ne mesure rien.`
                : null,
        ],
    },

    // ----- Analyse de risques et avancement ------------------------------------------
    {
        cle: 'ebios_synthese',
        attendChamps: [
            'sourcesRisque.total', 'sourcesRisque.retenues', 'scenariosStrategiques',
            'scenariosOperationnels', 'partiesPrenantes.total', 'partiesPrenantes.zones.non_evaluee',
        ],
        domaines: ['risques'],
        intitule: "Où en est l'analyse de risques EBIOS RM",
        source: 'catalogue', chemin: '/api/ebios/synthese',
        parametres: [],
        postconditions: [
            totalNul('élément', "Une analyse EBIOS non commencée et une analyse sans risque produisent le même vide."),
        ],
    },
    {
        cle: 'ebios_ecosysteme',
        // Mesurable depuis qu'une partie prenante existe : le référentiel était vide, et
        // une forme ne se lit pas sur un tableau vide.
        attendChamps: [
            'nom', 'type', 'dependance', 'penetration', 'maturiteCyber', 'confiance',
            'exposition', 'fiabilite', 'menace', 'zone',
        ],
        detailsMinimums: ['la partie prenante et son type', 'son niveau de menace et sa zone'],
        contexte: [
            "les quatre facteurs EBIOS qui portent l'évaluation — dépendance, pénétration, maturité cyber, confiance",
            "l'exposition et la fiabilité, dont la menace et la zone sont dérivées",
        ],
        domaines: ['risques'],
        intitule: "Quelles parties prenantes de l'écosystème présentent un niveau de menace",
        source: 'catalogue', chemin: '/api/ebios/ecosysteme',
        parametres: [],
        postconditions: [
            () => "L'écosystème est DÉCLARATIF : une partie prenante non saisie n'apparaît pas, ce qui ne veut pas dire qu'elle ne présente aucune menace.",
        ],
    },
    {
        cle: 'scenarios_strategiques',
        attendChamps: [
            'nom', 'gravite', 'cheminAttaque', 'sourceRisque', 'evenementRedoute',
            'partiePrenante', 'nbOperationnels',
        ],
        detailsMinimums: [
            'le libellé du scénario et sa gravité',
            "sa source de risque et l'événement redouté qu'il vise",
        ],
        contexte: [
            "le chemin d'attaque et la partie prenante empruntée, quand ils figurent",
            'le nombre de scénarios opérationnels dérivés',
        ],
        domaines: ['risques'],
        intitule: "Quels scénarios stratégiques ont été identifiés",
        source: 'catalogue', chemin: '/api/ebios/scenarios-strategiques',
        parametres: [],
        postconditions: [
            totalNul('scénario', "Aucun scénario identifié n'est pas la même chose qu'aucun scénario possible."),
            // Un scénario stratégique sans déclinaison opérationnelle s'arrête à
            // l'intention : il dit qui pourrait attaquer et pourquoi, jamais comment. Le
            // taire laisse croire l'analyse aboutie.
            corps => (Array.isArray(corps) ? corps : []).some((x: any) => !x?.nbOperationnels)
                ? "Des scénarios stratégiques n'ont AUCUN scénario opérationnel dérivé : ils décrivent qui pourrait "
                  + "attaquer et pourquoi, jamais par quels moyens. L'analyse s'y arrête à l'intention."
                : null,
        ],
    },
    {
        cle: 'avancement_nis2',
        // `exigences.nonEvaluees` porte la post-condition sur le dénominateur : sans lui
        // déclaré, l'avertissement le plus important de cette question pouvait mourir.
        attendChamps: [
            'exigences.total', 'exigences.fait', 'exigences.nonEvaluees', 'exigences.nonApplicables',
            'actions.total', 'actions.enRetard',
        ],
        domaines: ['conformite'],
        intitule: "Quel est l'avancement global de la mise en conformité NIS 2",
        source: 'catalogue', chemin: '/api/nis2/avancement',
        parametres: [],
        postconditions: [
            // Un taux d'avancement est le pire endroit où laisser passer une non-évaluée :
            // elle disparaît du dénominateur ou compte comme faite, et le chiffre rassure.
            () => "Un taux d'avancement agrège des exigences dont certaines ne sont PAS ÉVALUÉES. Vérifier ce que le dénominateur contient avant de citer le pourcentage : une exigence non évaluée n'est ni faite, ni à faire.",
        ],
    },
    {
        cle: 'fins_de_vie',
        /**
         * LA ROUTE QUI PORTE LE DÉCOMPTE, ET QUI NE S'ANNONÇAIT PAS.
         *
         * Forme mesurée par `--formes` : `lignes[]` porte le détail, et `resume` porte les
         * décomptes calculés par le serveur — `machinesDepassees`, `machinesInconnues`,
         * `osSansDate`. C'est ici que « combien de machines ont un OS en fin de vie »
         * trouve sa réponse exacte.
         */
        // `lignes.statut` est devenu `lignes.eolStatut` — le harnais l'a attrapé, et c'est
        // la première fois qu'il signale un changement de la SOURCE plutôt qu'une erreur de
        // notre déclaration. Sans lui, mes deux post-conditions auraient cessé de se
        // déclencher sans qu'aucune erreur n'apparaisse.
        //
        // `avertissement` n'y figure plus : la règle de valeur le relaie déjà, et elle le
        // trouve à n'importe quelle profondeur. L'exiger à la racine ajoutait une
        // contrainte de PLACE que rien n'oblige la source à tenir.
        attendChamps: [
            'lignes.os', 'lignes.machines', 'lignes.finDeVie', 'lignes.finDeVieEtendue',
            'lignes.eolStatut', 'lignes.source', 'lignes.connuAutomatiquement',
            'resume.machinesDepassees', 'resume.machinesInconnues', 'resume.osSansDate',
            'resume.osDistincts:number', 'resume.referentielConstruit:boolean',
            /**
             * `famillesDuGroupe` EST EXIGÉ, LES DÉCOMPTES NE LE SONT PAS — et la répartition
             * est délibérée.
             *
             * Une exigence de rédaction s'appuie sur `famillesDuGroupe` : elle demande de
             * dire ce qu'un décompte réunit. Un champ dont une exigence dépend doit être
             * vérifié, sinon l'exigence meurt en silence ou fabrique une valeur — les cinq
             * champs fantômes de la semaine.
             */
            'resume.famillesDuGroupe:object',
        ],
        detailsMinimums: [
            "le libellé du système (`os`) tel qu'il figure",
            'le nombre de machines concernées',
            'sa date de fin de vie et son statut',
        ],
        // Une question sur une famille de produits rencontre plusieurs libellés commerciaux
        // du même système. Ne pas les sommer est correct, mais la réponse doit dire POURQUOI
        // elle ne somme pas, sinon elle a l'air incomplète.
        /**
         * UN CHAMP INEXISTANT DÉGUISÉ EN DONNÉE ABSENTE.
         *
         * Il n'y a pas de champ `version` sur cette route : le libellé complet vit dans `os`.
         * Une colonne « Version » remplie de `null` ferait passer un champ inexistant pour
         * une saisie manquante, et enverrait corriger une donnée qui n'a pas lieu d'être.
         */
        aOmettre: [
            "toute colonne « version » : ce champ N'EXISTE PAS sur cette route, le libellé complet "
            + "vit dans `os`. Une colonne remplie de `null` ferait passer un champ inexistant pour une "
            + "donnée manquante, et enverrait corriger une saisie qui n'a pas lieu d'être",
        ],
        contexte: [
            // « COMBIEN » APPELLE UN NOMBRE, ET LA VENTILATION QUI Y MÈNE.
            //
            // Et la couverture de TOUS les états n'est pas un détail de forme : la même
            // réponse n'avait listé que les `etendu` et les `depasse`, laissant dehors les
            // Windows 10 en `ok`. Une énumération amputée des états rassurants se lit comme
            // un décompte complet — c'est le défaut du `machinesOk` manquant, un cran plus
            // bas.
            // LA VENTILATION EST LA RÉPONSE D'UNE QUESTION DE FAMILLE, PAS DE TOUTES.
            "sur une question GÉNÉRALE (« combien de machines en fin de vie »), ce sont les décomptes du recensement qui répondent : n'aligner qu'un extrait des lignes les plus nombreuses, jamais le référentiel entier, et ne jamais répéter une ligne",
            "sur une question de FAMILLE (« combien de Windows 10 »), le décompte PAR FAMILLE répond ; sur une question plus large (« combien de Debian, toutes versions »), c'est le décompte PAR GROUPE. Citer celui qui correspond, et dire ce qu'il réunit d'après `famillesDuGroupe` — un nombre juste au mauvais niveau répond à une question qu'on n'a pas posée",
            "ne rien additionner dans les deux cas : une somme de lignes recopiées à la main est fausse dès qu'un chiffre est mal recopié ou qu'une ligne manque, et rien ne le signale",
            "à DÉFAUT seulement d'un décompte par famille, donner le total en POSANT L'ADDITION : écrire la suite des nombres additionnés puis leur résultat, par exemple « 743 + 272 + 22 + … = ». Un total qui n'est ni lu ni le résultat visible d'une addition écrite ne doit PAS être donné",
            "AUCUN nombre du recensement ne peut servir de total de famille : ces entrées comptent le parc entier, jamais une famille de produits. Si l'addition ne peut pas être posée, dire les lignes et ne donner aucun total — un total faux coûte plus cher qu'un total absent",
            "cette ventilation couvre TOUS les états, y compris ok et supporte — une liste réduite aux états inquiétants se lit comme un décompte complet",
            "dire quelles variantes commerciales le total réunit (Pro, Professionnel, N, Éducation, IoT, LTSC) : le périmètre est un choix, et il s'énonce au lieu de bloquer le décompte",
            "ne jamais répéter une ligne : le total demandé en dépend, et une ligne citée deux fois le gonfle sans que rien ne le signale",

        ],
        domaines: ['parc', 'connecteurs'],
        intitule: "Combien de machines ont un système en fin de vie, dépassé ou bientôt — et lesquels",
        source: 'catalogue', chemin: '/api/eol/etat',
        parametres: [],
        postconditions: [
            // LES DÉCOMPTES VIENNENT DU SERVEUR. Compter les lignes rendues donnerait un
            // nombre de systèmes distincts là où la question porte sur des machines — deux
            // grandeurs qu'un seul chiffre ne peut pas porter.
            /**
             * UN VOCABULAIRE À SIX VALEURS DONT DEUX SE RESSEMBLENT, ET LA PLUS GROSSE DISPARAÎT.
             *
             * Le modèle n'a donc rien inventé : il a OMIS la catégorie `ok`, la plus
             * nombreuse du parc, et rendu `supporte` sous le nom qui lui restait —
             * « machines supportées ». Cinq catégories sur six, cinq mille machines
             * évaporées, et un chiffre parfaitement exact pour appuyer le tout.
             */
            corps => {
                const resume = corps?.resume
                if (!resume || typeof resume !== 'object') return null
                /**
                 * L'UNITÉ SE LIT DANS LE NOM, ET ELLE SE DIT.
                 *
                 * « Nombre total de comptes avec des OS en fin de vie : 51 » — `osDistincts`
                 * rendu en COMPTES. Le mot est le pire possible dans notre domaine : un
                 * compte est un compte utilisateur, et la phrase décrit une population qui
                 * n'existe pas. Recopier le nom ne suffisait donc pas : `osDistincts` est
                 * lisible pour qui connaît la route, opaque pour qui la découvre.
                 */
                const unite = (k: string) => k.startsWith('os') ? ' (systèmes distincts, PAS des machines)'
                    : k.startsWith('machines') ? ' (machines)' : ''
                const compte = Object.entries(resume)
                    .filter(([, v]) => typeof v === 'number')
                    .map(([k, v]) => `${k} = ${v}${unite(k)}`)
                if (!compte.length) return null
                /**
                 * DEUX DE MES RÈGLES SE CONTREDISAIENT, ET LE MODÈLE A TRANCHÉ AU PIRE.
                 *
                 * « N'en agréger aucune » visait les entrées du recensement — ne pas
                 * additionner `machinesDepassees` et `machinesEtendues` pour fabriquer un
                 * total qui ne mesure rien. Une autre règle demande, sur une question de
                 * famille, LE TOTAL précédé de la ventilation qui y conduit.
                 */
                return prescrire(`Recensement du serveur, à recopier SOUS CES NOMS : ${compte.join(' · ')}. `
                    + `Ne renommer aucune de ces entrées, et n'additionne JAMAIS deux d'entre elles : une valeur `
                    + `juste sous une étiquette inventée est indétectable à la lecture. `
                    + `Cet interdit porte sur CES entrées-là et sur elles seules : aucune ne répond à « combien `
                    + `de Windows 10 ». Cette question-là se lit dans le décompte PAR FAMILLE du même bloc — `
                    + `il n'y a rien à additionner ni à transcrire.`)
            },
            /**
             * DEUX ÉTATS SANS DATE, ET CE N'EST PAS LE MÊME MANQUE.
             *
             * L'erreur est compréhensible : `inconnu` et `supporte` n'ont TOUS DEUX aucune
             * date. Ce qui les sépare n'est pas la donnée manquante mais ce qu'on sait de
             * son absence — `supporte` est un système que l'éditeur déclare maintenu et dont
             * l'échéance n'est pas encore annoncée ; `inconnu` est un système sur lequel
             * personne n'a rien dit. Le premier est une pratique de publication, le second
             * un trou.
             */
            corps => {
                const etats = new Set((corps?.lignes ?? []).map((l: any) => l?.eolStatut))
                if (!etats.has('inconnu') || !etats.has('supporte')) return null
                return "`inconnu` et `supporte` n'ont l'un comme l'autre AUCUNE date de fin de vie, et ce n'est "
                    + "pas le même manque : `supporte` est un système déclaré maintenu dont l'échéance n'est pas "
                    + "encore annoncée, `inconnu` un système sur lequel personne n'a rien dit. Ne pas les réunir "
                    + "sous un titre commun, et surtout ne pas prêter à l'un le décompte de l'autre."
            },
            corps => {
                const etats = new Set((corps?.lignes ?? []).map((l: any) => l?.eolStatut))
                if (!etats.has('ok') || !etats.has('supporte')) return null
                return "Deux états du vocabulaire disent « ça va », et leurs noms ne le laissent pas deviner : "
                    + "`ok` désigne un système dont la date de fin de vie est connue et future, `supporte` un système "
                    + "maintenu SANS date connue. Ne présenter NI l'un NI l'autre seul comme « les machines à jour » : "
                    + "le parc sain est leur somme, et « supporté » est le petit des deux."
            },
            /**
             * L'ÉTAT LE PLUS NOMBREUX DU PARC N'EST DANS AUCUNE CATÉGORIE DU RÉSUMÉ.
             *
             * Le correctif précédent avait rendu l'écart VISIBLE sans le NOMMER : deux
             * nombres qui ne se répondent pas dans la même réponse, et la charge de faire la
             * soustraction laissée au lecteur. C'est un progrès mince — un lecteur qui ne la
             * fait pas repart avec « 610 dépassées sur 3 381 », soit un parc quatre fois plus
             * malade qu'il ne l'est.
             */
            corps => {
                const lignes = corps?.lignes
                const resume = corps?.resume
                if (!Array.isArray(lignes) || !lignes.length || !resume) return null
                if (resume.osDistincts !== lignes.length) return null

                const parEtat = new Map<string, number>()
                for (const l of lignes) {
                    const e = typeof l?.eolStatut === 'string' ? l.eolStatut : null
                    if (e) parEtat.set(e, (parEtat.get(e) ?? 0) + (Number(l?.machines) || 0))
                }
                const cles = Object.keys(resume).map(k => k.toLowerCase())
                const absents = [...parEtat].filter(([etat]) => !cles.some(k => k.includes(etat.toLowerCase())))
                if (!absents.length) return null

                return `Le résumé ne compte PAS ${absents.length === 1 ? "l'état" : 'les états'} `
                    + `${absents.map(([e, n]) => `\`${e}\` (${n} machines)`).join(', ')} : `
                    + `ses catégories dénombrent ce qui inquiète et passent sous silence ce qui rassure. `
                    + `Additionner les seules catégories du résumé donne un parc bien plus malade qu'il ne l'est — `
                    + `citer ${absents.length === 1 ? 'cet état' : 'ces états'} avec les autres, ou aucune proportion.`
            },
            corps => {
                const lignes = corps?.lignes
                if (!Array.isArray(lignes) || !lignes.length) return null
                const complet = corps?.resume?.osDistincts === lignes.length
                const evaluees = lignes.reduce((s: number, l: any) => s + (Number(l?.machines) || 0), 0)
                /**
                 * LA SOURCE PORTE MAINTENANT SON PROPRE TOTAL — on se retire.
                 *
                 * On ne garde que la MISE EN GARDE, qui n'est nulle part ailleurs : ces
                 * décomptes répartissent les machines rapprochées, pas le parc.
                 */
                const totalPublie = Object.entries(corps?.resume ?? {})
                    .some(([k, v]) => /total/i.test(k) && v === evaluees)
                return `Ces décomptes répartissent les machines RAPPROCHÉES d'un système connu, et non le parc : `
                    + `une machine dont la clé n'est pas encore calculée (\`eolStatut: null\`) et une machine sans OS `
                    + `n'entrent dans aucune catégorie. `
                    + (complet
                        ? (totalPublie
                            ? `La population répartie figure au recensement : la citer avec les catégories, un `
                              + `décompte par catégorie sans sa population se lisant comme une part du parc.`
                            : `Population effectivement répartie : ${evaluees} machines — la citer avec les catégories, `
                              + `un décompte par catégorie sans sa population se lisant comme une part du parc.`)
                        : Number.isFinite(corps?.resume?.osDistincts)
                            ? `Le tableau ne contient que ${lignes.length} des ${corps.resume.osDistincts} systèmes du `
                              + `référentiel : N'ADDITIONNER AUCUNE de ses colonnes, et ne rapporter les décomptes à aucun `
                              + `total. Une somme calculée sur un extrait est fausse d'un facteur inconnu.`
                            : `Rien ne dit que ce tableau porte TOUS les systèmes du référentiel : `
                              + `N'ADDITIONNER AUCUNE de ses colonnes, et ne rapporter les décomptes à aucun total. `
                              + `Une somme calculée sur un extrait est fausse d'un facteur inconnu.`)
            },
            /**
             * `autre` EST INSPECTABLE, ET CE QU'IL CONTIENT DÉCIDE DE CE QU'IL FAUT FAIRE.
             *
             * La famille `autre` existe pour que la partition somme au total : un système
             * non reconnu ne peut pas disparaître. C'est une garantie d'arithmétique, et
             * elle ne dit rien de ce qu'il faut en penser.
             */
            corps => {
                const nr = corps?.resume?.famillesNonReconnues ?? corps?.famillesNonReconnues
                if (!nr || !(Number(nr.machines) > 0)) return null
                const cles = (nr.cles ?? []).map((c: any) => `${c?.cle} (${c?.machines})`).filter(Boolean)
                return `${nr.machines} machine(s) sur ${nr.systemes} système(s) ne sont rattachées à aucune famille `
                    + `connue et tombent dans « autre »`
                    + (cles.length ? ` : ${cles.slice(0, 6).join(', ')}` : '')
                    + `${nr.tronque ? ' — liste TRONQUÉE, d\'autres systèmes ne sont pas nommés ici' : ''}. `
                    + `Le dire quand « autre » figure dans la réponse : ce n'est pas un reliquat, c'est soit une `
                    + `famille à ajouter au référentiel, soit une saisie à corriger, et le détail seul permet de `
                    + `trancher.`
            },
            corps => corps?.resume?.osSansDate > 0
                ? `${corps.resume.osSansDate} système(s) n'ont AUCUNE date de fin de vie renseignée : ils échappent au décompte des dépassés, `
                  + `qui est donc un minimum et non un total.`
                : null,
            /**
             * UN SUPPORT SANS DATE NE S'ALERTE PAS TOUT SEUL — ET CE N'EST PAS UNE LACUNE.
             *
             * Ce qui reste vrai, et qui compte : sans échéance à comparer, ces lignes ne
             * basculeront jamais d'elles-mêmes en « bientôt ». Leur surveillance tient au
             * rafraîchissement du référentiel, pas au calendrier — une vigilance
             * périodique, là où les autres lignes s'annoncent seules.
             */
            corps => {
                const sansDate = (corps?.lignes ?? [])
                    .filter((l: any) => !l?.finDeVie && l?.eolStatut !== 'inconnu')
                    .map((l: any) => l?.os).filter(Boolean)
                return sansDate.length
                    ? `Supporté sans date de fin de vie connue : ${sansDate.slice(0, 5).join(', ')}. `
                      + `Ce n'est pas un défaut de saisie — certains éditeurs, Apple notamment, n'annoncent la fin de `
                      + `vie que quelques mois à l'avance. Mais faute d'échéance à comparer, ces lignes ne basculeront `
                      + `pas d'elles-mêmes en « bientôt » : leur surveillance tient au rafraîchissement du référentiel.`
                    : null
            },
        ],
    },
    {
        cle: 'resume_conformite',
        /**
         * UN BLOC PAR CADRE, ET SURTOUT PAS UN JEU DE CLÉS UNIQUE.
         *
         * On déclare les BLOCS, pas leurs clés, et pour la raison qu'ils ont nommée : NIS 2
         * dit `fait` là où l'ISO et le RGPD disent `conforme`, et `non_applicable` vit dans
         * `parStatut` chez NIS 2 quand il est dans `parConformite` chez les deux autres. Un
         * jeu de clés unique ferait rougir deux cadres sur trois — c'est-à-dire reproduirait
         * exactement le piège d'origine, celui qui comptait un référentiel entier comme non
         * conforme.
         */
        attendChamps: [
            'nis2', 'iso27001', 'rgpd',
            'nis2.parConformite', 'iso27001.parConformite', 'rgpd.parConformite',
            'nis2.parStatut',
        ],
        contexte: [
            "la ventilation des applications par état RGPD quand le résumé la porte — écart, non évalué, conforme, hors périmètre",
            'le pilotage du SMSI quand il figure : la dernière revue de direction réalisée, la prochaine planifiée, le prochain audit',
        ],
        domaines: ['conformite', 'rgpd'],
        intitule: "Où en est-on globalement sur la conformité — NIS 2, ISO 27001 et RGPD d'un coup",
        source: 'catalogue', chemin: '/api/conformite/resume',
        parametres: [],
        postconditions: [
            cadresNonLus,
            // Un bloc à `null` est le piège le plus coûteux de ce point d'entrée : il se lit
            // comme un cadre vide, alors que c'est un cadre qu'on n'a pas le droit de lire.
            corps => ['nis2', 'iso27001', 'rgpd'].filter(c => corps?.[c] === null).length
                ? `Cadres rendus à \`null\` : ${['nis2', 'iso27001', 'rgpd'].filter(c => corps?.[c] === null).join(', ')}. `
                  + `C'est un défaut de droits, PAS un cadre vide.`
                : null,
        ],
    },

    // ----- Incidents -----------------------------------------------------------------
    {
        cle: 'incidents_liste',
        // Tout champ qu'une exigence nomme doit être VÉRIFIÉ, sans quoi il meurt en
        // silence : `titre` était exigé et n'existe pas chez Sniff, et la réponse sortait
        // sans intitulé sans que rien ne rougisse. Ceux-ci sont relevés par --montrer.
        attendChamps: [
            'total', 'tri', 'resultats', 'resultats.niveau', 'resultats.machines',
            'resultats.severity', 'resultats.description', 'resultats.knowledgeAt',
            'resultats.knowledgeEstimated', 'resultats.urlAbsolue', 'resultats.perimeter',
            'resultats.pilot', 'resultats.takenOverBy',
        ],
        essai: { pageSize: '1' },
        contexte: [
            "le rattachement de chaque machine : son entité, son groupe, son lieu quand il figure, et si elle est critique",
            "l'URL de sa fiche GLPI, et l'URL de l'incident (`urlAbsolue`) — c'est par où on va le traiter",
            // Un P1 en cours sans pilote est un fait opérationnel, pas un champ vide de
            // plus : il dit que personne ne l'a pris en main.
            "le pilote et la prise en charge (`pilot`, `takenOverBy`) — leur absence sur un incident en cours se dit",
            'le périmètre',
            // Neutre à dessein : on demande de RAPPORTER la valeur, pas de l'interpréter.
            // C'est cette date qui arme les compteurs NIS 2 et RGPD ; ce que son caractère
            // estimé implique doit venir de la lecture publiée par Sniff, pas de nous.
            "l'état de la date de connaissance (`knowledgeEstimated`) tel qu'il figure — c'est cette date qui fait courir les compteurs réglementaires",
        ],
        aOmettre: ['les identifiants internes de machine, sauf si la question porte sur une machine précise'],
        detailsMinimums: [
            "l'identifiant",
            // PAS DE `titre` DANS LA CHARGE UTILE DE SNIFF — relevé par `--montrer` le
            // Le demander revenait à réclamer un champ qui n'existe pas, et le
            // modèle rendait alors une réponse sans intitulé du tout. C'est la description
            // qui tient ce rôle.
            // Sniff assume l'absence d'un champ titre (clé publiée `titre-inexistant`) et
            // propose la composition : id, niveau et type sont présents, normalisés et
            // courts. Tronquer la description à une longueur arbitraire couperait au
            // milieu d'une phrase et varierait d'un lecteur à l'autre.
            "un intitulé COMPOSÉ de l'identifiant, du niveau et du type — Sniff ne porte pas de champ titre, et la description ne se tronque pas pour en tenir lieu",
            'la description en entier, qui porte le fond du signalement',
            // Le type décide de la conduite attachée : une réponse qui le tait rend le
            // comportement du pont illisible — on ne peut pas distinguer « pas de fiche
            // pour ce type » de « pont en panne » sans aller voir le corps brut.
            "le type d'incident",
            'la gravité en P1–P4 — le champ `niveau` la porte, à côté de `severity`',
            'le statut',
            'la date de DÉTECTION (`knowledgeAt`) et, si elle diffère, la date de signalement',
            // LA MACHINE DÉCIDE DE LA SUITE. Elle était déclarée en « rattachement », donc
            // sous une formule qui s'efface — « quand ils figurent dans les données ». Une
            // réponse P1 sans sa machine a déjà été rendue deux fois : exacte, et
            // inutilisable, parce que c'est la machine qu'on va isoler.
            'LES MACHINES CONCERNÉES, chacune avec son nom, son entité et son système — sans elles, la réponse ne dit pas sur quoi agir',
        ],
        intitule: "Quels incidents, sur quelle période, de quel type ou de quelle gravité",
        source: 'sniff', chemin: '/api/incidents/liste',
        parametres: [
            { cle: 'type', libelle: "Type d'incident", valeurs: [...SNIFF_TYPE] },
            { cle: 'status', libelle: 'Statut', valeurs: [...SNIFF_STATUT] },
            { cle: 'severity', libelle: 'Gravité — P1 à P4 acceptés', valeurs: [...SNIFF_SEVERITE] },
            { cle: 'sort', libelle: 'Tri', valeurs: ['knowledgeAt', 'createdAt', 'updatedAt', 'severity'] },
            { cle: 'pageSize', libelle: 'Nombre de résultats' },
            { cle: 'avecMachines', libelle: 'Joindre les machines concernées', valeurs: ['true', 'false'] },
            { cle: 'depuis', libelle: 'Borne de début (date ISO) — porte sur la date de CONNAISSANCE' },
            { cle: 'jusqua', libelle: 'Borne de fin (date ISO)' },
            { cle: 'resolution', libelle: 'Issue du triage', valeurs: [...SNIFF_RESOLUTION] },
        ],
        /**
         * `avecMachines` est mis à `true` PAR DÉFAUT, et c'est un écart assumé.
         *
         * L'équipe Sniff conseille de ne le demander que si la question porte sur le parc :
         * la jointure a un coût, et une liste de suivi n'en a pas besoin. Le conseil est bon
         * en général et faux pour nous. Cet assistant sert une cellule qui demande « a-t-on
         * eu un P1 » pour savoir QUOI FAIRE : la machine touchée est ce qui décide de la
         * suite, et une réponse sans elle a déjà été rendue une fois — exacte et inutile.
         */
        defauts: { sort: 'knowledgeAt', avecMachines: 'true' },
        postconditions: [
            /**
             * BORNER PAR PÉRIODE ÉCARTE EN SILENCE — signalé par Sniff en livrant le filtre.
             *
             * Un incident sans date de connaissance sort de tout résultat borné, sans
             * qu'aucune ligne ne manque visiblement. Le cas ne concerne que d'anciens
             * incidents — la date est obligatoire à la création depuis — mais un décompte
             * mensuel peut s'en trouver MINORÉ, et rien dans la réponse ne le dit.
             */
            (_corps, params) => params?.depuis || params?.jusqua
                ? "Ce résultat est BORNÉ par période, sur la date de CONNAISSANCE et non sur la date de saisie : "
                  + "un incident de mars enregistré en avril appartient à mars. Les incidents sans date de "
                  + "connaissance — d'anciens incidents seulement — en sont écartés SANS TRACE : ce décompte est "
                  + "donc un minorant. Pour lever la réserve, comparer au même décompte sans bornes."
                : null,
            triParModification,
            /**
             * ABSENT N'EST PAS VIDE, et aucune règle champ-valeur ne peut le dire.
             *
             * Les couches de mise en garde s'appliquent à un champ ET à sa valeur. Un champ
             * ABSENT n'a pas de valeur : la lecture que Sniff publie sur ce cas ne peut donc
             * pas se déclencher toute seule. C'est la limite exacte de ce mécanisme, et elle
             * se comble ici.
             */
            corps => {
                const lignes: any[] = corps?.resultats ?? []
                if (!lignes.length) return null
                return lignes.some(l => l && !('machines' in l))
                    ? "Les machines n'ont PAS été demandées sur cet appel (`avecMachines` absent) : leur "
                      + "absence de la réponse ne veut pas dire qu'aucune machine n'est concernée. Ne pas "
                      + "conclure sur le parc touché, et relancer avec `avecMachines=true` si la question "
                      + 'porte dessus.'
                    : null
            },
        ],
    },
    {
        /**
         * LA VEILLE BORNÉE — une question que la procédure décrit et que rien n'ouvrait.
         *
         * Le statut est imposé par défaut : la question ne porte que sur les veilles, et
         * demander « les veilles » ne doit pas rendre tous les incidents.
         */
        cle: 'veilles',
        attendChamps: ['total', 'resultats', 'resultats.surveillanceExpiresAt', 'resultats.status'],
        essai: { pageSize: '1' },
        defauts: { status: 'surveillance', sort: 'knowledgeAt' },
        detailsMinimums: [
            "l'identifiant de l'incident et son intitulé composé",
            "la date d'expiration de la veille, et le nombre de jours qui restent ou qui ont passé",
        ],
        contexte: ['la raison de la mise en veille quand elle figure dans la résolution ou la description'],
        intitule: "Quelles veilles sont en cours, et lesquelles ont dépassé leur échéance",
        source: 'sniff', chemin: '/api/incidents/liste',
        parametres: [
            { cle: 'status', libelle: 'Statut', valeurs: [...SNIFF_STATUT] },
            { cle: 'pageSize', libelle: 'Nombre de résultats' },
            { cle: 'sort', libelle: 'Tri', valeurs: ['knowledgeAt', 'createdAt', 'updatedAt', 'severity'] },
            // Livré par Sniff avec les bornes de période : « lesquelles arrivent à terme »
            // n'avait aucune porte, alors que le statut exige une échéance depuis toujours.
            { cle: 'veilleExpireAvant', libelle: "Veilles dont l'échéance tombe avant cette date (ISO)" },
        ],
        postconditions: [
            /**
             * UNE VEILLE EXPIRÉE N'EST PLUS UNE VEILLE.
             *
             * Le triage la définit comme BORNÉE : passé son échéance, elle n'est ni close ni
             * surveillée — elle est en suspens, et rien dans le statut ne le dit puisqu'il
             * reste `surveillance`. C'est le seul endroit du registre où le temps change la
             * nature d'un état sans changer sa valeur.
             */
            corps => {
                const passees = (corps?.resultats ?? []).filter((r: any) =>
                    r?.surveillanceExpiresAt && new Date(r.surveillanceExpiresAt).getTime() < Date.now())
                return passees.length
                    ? `${passees.length} veille(s) ont DÉPASSÉ leur échéance : ${passees.slice(0, 5).map((r: any) => r.id).join(', ')}. `
                      + `Une veille bornée qui expire n'est ni close ni surveillée — le statut reste « surveillance » `
                      + `et ne le dit pas. Elle demande une décision : clore, ou reborner.`
                    : null
            },
            corps => (corps?.resultats ?? []).some((r: any) => r?.status === 'surveillance' && !r?.surveillanceExpiresAt)
                ? "Des veilles n'ont AUCUNE date d'expiration alors que le triage la rend obligatoire : elles ne "
                  + "remonteront dans aucune échéance et resteront ouvertes indéfiniment."
                : null,
            triParModification,
        ],
    },
    {
        cle: 'incidents_contexte',
        attendChamps: ['lus', 'plafond', 'resultats'],
        contexte: [
            'pour chaque machine : sa criticité, sa composante, son groupe GLPI, la présence ou non d\'un agent EDR',
            'les listes blanches rattachées à l\'incident',
        ],
        detailsMinimums: [
            "l'identifiant de l'incident", 'son titre', 'sa gravité en P1–P4',
            'les machines concernées et leur criticité', 'la présence ou non d\'un agent EDR',
        ],
        domaines: ['parc', 'edr', 'connecteurs'],
        intitule: "Cet incident touche-t-il une machine critique, était-elle surveillée, quelles listes blanches en découlent",
        source: 'catalogue', chemin: '/api/incidents/croisement',
        parametres: [
            { cle: 'statut', libelle: 'Statut' },
            { cle: 'critiques', libelle: 'Machines critiques seulement', valeurs: ['true'] },
        ],
        postconditions: [
            relaisPlafonne, triParModification,
        ],
    },
    {
        cle: 'compteurs_reglementaires',
        attendChamps: ['resultats', 'source.dernierAccesAt'],
        detailsMinimums: [
            'le compteur et son cadre', 'son état — il court, déposé, ou à trancher',
            "l'échéance ou les jours restants quand ils figurent",
        ],
        domaines: ['connecteurs'],
        intitule: "Où en sont les compteurs réglementaires — NIS 2 article 23, CNIL, CERT RENATER",
        source: 'catalogue', chemin: '/api/nis2/echeances',
        parametres: [
            { cle: 'court', libelle: 'Seulement les compteurs qui courent', valeurs: ['true'] },
            { cle: 'aTrancher', libelle: "Seulement ceux dont l'applicabilité n'est pas décidée", valeurs: ['true'] },
        ],
        postconditions: [
            fraicheurMiroir,
            corps => (corps?.resultats ?? []).some((r: any) => r.aTrancher)
                ? "Des compteurs sont « à trancher » : leur applicabilité n'a pas été déterminée, et aucun délai ne court tant que la décision n'est pas enregistrée. Ce n'est pas « non applicable ». Un `aTrancher` massif sur des P2 signifie que la date d'entrée en vigueur n'est pas réglée chez Sniff, pas que personne n'a fait son travail."
                : null,
            corps => (corps?.resultats ?? []).some((r: any) => r.deposeLe && (r.joursRestants ?? 0) < 0)
                ? "Des compteurs affichent des jours négatifs alors que la déclaration EST déposée : ce n'est pas un retard."
                : null,
        ],
    },
    {
        cle: 'recherche_catalogue',
        attendChamps: ['exhaustif', 'total'],
        essai: { q: 'srv' },
        domaines: [],
        intitule: "Trouver une entité par son nom — serveur, application, personne, lieu",
        source: 'catalogue', chemin: '/api/recherche',
        parametres: [{ cle: 'q', libelle: 'Nom cherché', obligatoire: true }],
        postconditions: [],
    },
    {
        // Forme MESURÉE par `--montrer` : un tableau NU de
        // { type, severity, message, entite, entiteId, dueDate } — 48 000 caractères au
        // relevé, dominé par des `techno_eol` aux échéances anciennes. Pas de
        // `total` : le décompte fiable est donné par la postcondition ci-dessous, comptée
        // par NOTRE serveur sur le corps entier — le bloc montré au modèle, lui, sera
        // tronqué.
        cle: 'alertes_catalogue',
        attendChamps: ['type', 'severity', 'message', 'dueDate', 'entiteId'],
        detailsMinimums: ["le `message` de l'alerte", 'son `type` et sa gravité', "son échéance (`dueDate`) quand elle figure"],
        aOmettre: ['les identifiants internes (`entiteId`), sauf pour retrouver une fiche précise'],
        domaines: ['certificats', 'acces', 'parc', 'connecteurs'],
        intitule: "Quelles alertes le Catalogue lève en ce moment — échéances, défauts, revues",
        source: 'catalogue', chemin: '/api/alerts',
        parametres: [],
        postconditions: [
            // Le tableau est nu : sans ce décompte serveur, le modèle n'aurait que les
            // lignes tronquées à compter — l'interdit exact des listes blanches.
            corps => Array.isArray(corps)
                ? `Le flux contient ${corps.length} alerte(s) au moment de l'appel : c'est le seul décompte fiable, le bloc montré pouvant être tronqué.`
                : null,
            // Même règle que les échéances du patrimoine, et pas de seuil inventé : on
            // rend la mesure, et ce qu'on ne peut pas en déduire.
            corps => {
                const lignes: any[] = Array.isArray(corps) ? corps : []
                const passees = lignes.filter(l => l?.dueDate && new Date(l.dueDate).getTime() < Date.now())
                if (!passees.length) return null
                const plusAncienne = passees.map(l => String(l.dueDate)).sort()[0]
                return `${passees.length} alerte(s) sur ${lignes.length} portent une échéance DÉJÀ passée, la plus `
                    + `ancienne du ${plusAncienne}. Ne pas les classer par profondeur de retard : un retard profond `
                    + `signale autant une donnée que personne ne tient qu'une tâche non faite — ce qui vient de `
                    + `lâcher se rattrape encore, ce qui traîne demande d'abord de décider si la ligne est valable.`
            },
            () => "Une alerte absente de cette liste n'est pas un état sain : ce qui n'a jamais été relevé ne lève aucune alerte.",
        ],
    },
    // ----- Sniff : ce que le Catalogue ne transporte pas ------------------------------
    //
    // Le Catalogue est explicite sur ce qu'il ne porte pas d'un incident : ni chronologie,
    // ni notes, ni pièces jointes, ni blocs de détail par type, ni historique des actions.
    // « Que s'est-il passé » n'avait donc AUCUNE réponse — l'assistant savait dire qu'un
    // incident touchait une machine critique, pas ce qui s'y était produit.
    {
        cle: 'incident_detail',
        /**
         * DEUX CHAMPS FANTÔMES, relevés par `--montrer`.
         *
         * Ce que la route porte réellement en propre, par rapport à la liste : les blocs de
         * détail par type (`malwareDetails`, `phishingDetails`), les personnes touchées, et
         * la résolution.
         */
        attendChamps: [
            'id', 'type', 'severity', 'status', 'description', 'resolution', 'knowledgeAt',
            'knowledgeEstimated', 'pilot', 'takenOverBy', 'perimeter', 'affectedUsers',
            'malwareDetails', 'phishingDetails',
        ],
        contexte: [
            'les personnes touchées (`affectedUsers`) quand il y en a',
            'la résolution quand elle est renseignée, et son absence quand l\'incident est en cours',
        ],
        aOmettre: ['les blocs de détail technique par type, sauf si la question les vise'],
        detailsMinimums: [
            "l'identifiant", 'le titre', 'la description', 'la gravité en P1–P4', 'le statut',
            'la date de détection', 'la résolution quand elle est renseignée',
        ],
        intitule: "Que s'est-il passé sur cet incident — chronologie, notes, détails par type",
        source: 'sniff', chemin: '/api/incidents/{id}',
        parametres: [{ cle: 'id', libelle: "Identifiant de l'incident", obligatoire: true }],
        postconditions: [
            () => "Le contenu d'un incident est saisi par l'équipe : il vaut ce que vaut la saisie, et un champ vide n'est pas un fait établi.",
        ],
    },
    {
        cle: 'incident_conduite',
        /**
         * SNIFF SERT SA PROPRE COPIE DE LA FICHE — 26 000 caractères de corps, mesurés le
         * C\'est commode et c\'est le piège que tout ce projet combat : une
         * procédure recopiée dans un second dépôt diverge, et les deux copies ont l'air
         * également vraies.
         *
         * D'où deux exigences. La version et le statut de LEUR copie se disent, pour qu'une
         * divergence se voie au lieu de se deviner. Et le texte des étapes se cite depuis
         * le corpus indexé — celui que la rédaction tient à jour et dont les renvois
         * ancrés mènent aux gestes — jamais depuis cette copie, qui n'a ni ancre ni
         * fraîcheur garantie.
         */
        attendChamps: [
            'niveau', 'procedure.fiche', 'procedure.checklist', 'procedure.motif',
            'procedure.impose', 'alternatives', 'fiche.reference', 'fiche.version', 'fiche.statut',
        ],
        contexte: [
            'les compteurs réglementaires qui courent sur cet incident, avec leur échéance',
            "les fiches ALTERNATIVES et leur motif — c'est l'aiguillage vu depuis la donnée, et il dit ce qui s'appliquerait si la qualification changeait",
        ],
        aOmettre: ["le corps intégral de la fiche servi par Sniff : le citer depuis le corpus indexé, qui porte les ancres et la version à jour"],
        intitule: "Quelle conduite tenir sur cet incident, et quels compteurs réglementaires courent",
        source: 'sniff', chemin: '/api/incidents/{id}/conduite',
        parametres: [{ cle: 'id', libelle: "Identifiant de l'incident", obligatoire: true }],
        postconditions: [
            // La procédure vient de Sniff, pas de notre index. Le dire évite qu'une réponse
            // mêle les deux sans qu'on puisse démêler ce qui vient d'où.
            () => "La procédure applicable est celle que Sniff rattache à ce type d'incident. Elle ne vient pas du corpus indexé : si les deux divergent, c'est à trancher par la cellule.",
            corps => corps?.fiche?.reference
                ? `Sniff sert ici SA COPIE de ${corps.fiche.reference} (version ${corps.fiche.version ?? 'non déclarée'}, statut ${corps.fiche.statut ?? 'non déclaré'}). `
                  + `Citer les étapes depuis le corpus indexé, qui porte les ancres et la version à jour ; nommer cette version-ci si elle diffère.`
                : null,
            corps => corps?.procedure?.impose === false
                ? "Le rattachement de fiche est PROPOSÉ par Sniff, pas imposé : il se change. Les alternatives listées disent ce qui s'appliquerait sous une autre qualification."
                : null,
        ],
    },
    {
        cle: 'incident_machines',
        attendChamps: ['nom', 'glpiId', 'entite', 'groupe', 'os', 'critique', 'presente', 'url'],
        detailsMinimums: [
            'le nom de chaque machine',
            "son identifiant GLPI quand il existe — sinon dire qu'elle est saisie librement",
            'son système et son entité',
        ],
        contexte: [
            "l'état de présence à l'inventaire (`presente`) — une machine absente du parc porte quand même l'incident, et ce qu'on peut en dire n'est pas le même",
            "sa criticité (`critique`) et l'URL de sa fiche GLPI (`url`)",
        ],
        intitule: "Quelles machines sont concernées par cet incident",
        source: 'sniff', chemin: '/api/incidents/{id}/machines',
        parametres: [{ cle: 'id', libelle: "Identifiant de l'incident", obligatoire: true }],
        postconditions: [
            // ELLE SE DÉCLENCHAIT TOUJOURS, y compris quand toutes les machines portaient
            // leur identifiant GLPI — une mise en garde qui s'affiche sans objet est une
            // mise en garde qu'on cesse de lire. Elle ne parle plus que des machines
            // réellement concernées, et elle les nomme.
            (corps: any) => {
                const libres = (Array.isArray(corps) ? corps : [])
                    .filter((m: any) => !m?.glpiId).map((m: any) => m?.nom).filter(Boolean)
                return libres.length
                    ? `Saisie(s) librement, sans identifiant GLPI : ${libres.slice(0, 6).join(', ')}. `
                      + `Ces machines ne peuvent être rapprochées d'aucune fiche : pour leur contexte — criticité, `
                      + `agent EDR — passer par le croisement du Catalogue, qui ne les verra pas non plus.`
                    : null
            },
        ],
    },
    {
        cle: 'historique_machine',
        // Forme mesurée : un tableau nu d'incidents, sans leurs machines — c'est la
        // machine qui est le point d'entrée ici.
        attendChamps: [
            'id', 'type', 'severity', 'status', 'description', 'knowledgeAt',
            'knowledgeEstimated', 'pilot', 'perimeter',
        ],
        detailsMinimums: ["l'identifiant et le titre de chaque incident", 'sa gravité en P1–P4', 'sa date de détection'],
        intitule: "Quels incidents cette machine a-t-elle connus",
        source: 'sniff', chemin: '/api/machines/{glpiId}/incidents',
        parametres: [{ cle: 'glpiId', libelle: 'Identifiant GLPI de la machine', obligatoire: true }],
        postconditions: [
            totalNul('incident', "Cela vaut pour les incidents RATTACHÉS à cette fiche GLPI. Une machine saisie librement dans un incident n'y est pas rattachée, et deux fiches GLPI peuvent désigner la même machine."),
        ],
    },
    {
        cle: 'exclusions_sniff',
        detailsMinimums: [
            'la règle concernée', "l'incident d'origine quand il figure",
            'le motif et la date de revue — ou leur absence',
        ],
        /**
         * LA ROUTE CHANGE, ET C'EST CE QUI REND LA QUESTION MESURABLE.
         *
         * `alimentation` dit que les exclusions se consignent À LA MAIN : aucun connecteur
         * ne les écrit, donc un registre vide ne peut pas être une panne d'écriture. C'est
         * la réponse à la question qu'on posait, et elle est meilleure que la question.
         */
        attendChamps: ['total', 'actives', 'alimentation', 'releveEdr', 'resultats'],
        intitule: "Quelles exclusions ont été posées, à partir de quel incident, et le registre est-il à jour",
        source: 'sniff', chemin: '/api/exclusions/registre',
        parametres: [],
        postconditions: [
            () => "C'est ici que se corrigent le motif et la date de revue d'une règle rattachée à un incident — pas dans le Catalogue, qui n'écrit nulle part.",
            corps => corps?.total === 0
                ? "Le registre est VIDE. Les exclusions s'y consignent à la main, depuis un incident : aucun connecteur "
                  + "ne les écrit, donc ce vide ne peut pas être une panne d'écriture — c'est un fait établi. Ce n'est "
                  + "pas pour autant « aucune liste blanche » : les deux registres ne se déduisent pas l'un de l'autre."
                : null,
            // L'écart entre le registre et l'EDR n'est pas calculable sans relevé, et
            // conclure dans un sens ou dans l'autre serait faux des deux façons.
            corps => !corps?.releveEdr
                ? "Aucun relevé EDR : l'écart entre les exclusions consignées et les règles réellement en place n'est "
                  + "PAS calculable. Ne conclure ni à la conformité du registre, ni à son insuffisance."
                : null,
        ],
    },
    /**
     * LES QUATRE RÉSUMÉS QUE PERSONNE NE POUVAIT DEMANDER.
     *
     * Le harnais a nommé treize partitions déclarées sur des routes qu'aucune question
     * n'interrogeait. Ce n'était pas un défaut : c'étaient des décomptes exacts, publiés,
     * documentés, et inatteignables — la source savait répondre, personne ne pouvait poser
     * la question.
     */
    {
        cle: 'parc_resume',
        attendChamps: [
            'serveurs.parCriticite', 'postesTravail.parCriticite', 'machinesIndus.parCriticiteSurete',
        ],
        detailsMinimums: [
            'le décompte par niveau, sous les noms du référentiel',
            'la population concernée — serveurs, postes ou machines industrielles',
        ],
        contexte: ["ce que « non renseignée » représente : une machine sans criticité échappe à tout classement, et son absence de niveau n'est pas un niveau bas"],
        aOmettre: ["toute somme entre la criticité MÉTIER et la criticité de SÛRETÉ : ce sont deux échelles"],
        domaines: ['parc'],
        intitule: "Comment le parc se répartit par CRITICITÉ — serveurs, postes, machines industrielles (le décompte, pas la liste des machines)",
        source: 'catalogue', chemin: '/api/parc/resume',
        parametres: [],
        postconditions: [],
    },
    {
        cle: 'applications_resume',
        attendChamps: [
            'parStatut', 'parExposition', 'parHebergement', 'parSensibilite', 'parCriticite', 'parEtatRgpd',
        ],
        detailsMinimums: ['le décompte par valeur, sous les noms du référentiel'],
        contexte: [
            "le croisement quand la question le demande — une application exposée sur Internet ET confidentielle n'est pas la somme des deux décomptes, et ce croisement ne se lit pas ici",
            "l'état RGPD quand il est demandé : les mêmes nombres figurent dans le résumé de conformité",
        ],
        domaines: ['rgpd', 'conformite', 'parc'],
        intitule: "Combien d'applications par statut, exposition, hébergement, sensibilité, criticité ou état RGPD — le décompte du catalogue applicatif",
        source: 'catalogue', chemin: '/api/applications/resume',
        parametres: [],
        postconditions: [
            /**
             * LE CROISEMENT N'EST PAS DANS CE BLOC, ET C'EST LA QUESTION QU'ON POSERA.
             *
             * « Combien d'applications exposées sur Internet et confidentielles » est la
             * question naturelle, et six partitions côte à côte donnent l'illusion qu'elle
             * s'y répond. Elles partitionnent la MÊME population six fois, sous six angles :
             * croiser deux d'entre elles demande de savoir quelles applications sont dans
             * les deux, ce qu'aucun de ces décomptes ne dit.
             */
            corps => {
                const vues = ['parStatut', 'parExposition', 'parHebergement', 'parSensibilite', 'parCriticite', 'parEtatRgpd']
                    .filter(k => corps?.[k] && typeof corps[k] === 'object')
                return vues.length > 1
                    ? `Ces ${vues.length} décomptes partitionnent la MÊME population sous ${vues.length} angles `
                      + `différents. Aucun ne se croise avec un autre : « exposée sur Internet ET confidentielle » `
                      + `demande de savoir quelles applications sont dans les deux, ce qu'aucun de ces nombres ne dit. `
                      + `Ne jamais additionner ni multiplier deux de ces décomptes, et dire que le croisement se `
                      + `demande sur la liste des applications, pas ici.`
                    : null
            },
        ],
    },
    {
        cle: 'certificats_resume',
        attendChamps: ['parStatut', 'parSource'],
        detailsMinimums: ['le décompte par état de dernier relevé, sous les noms du référentiel'],
        contexte: ["l'origine des certificats quand elle éclaire la question : un certificat entré par scan n'a pas la même fiabilité de suivi qu'un certificat saisi"],
        domaines: ['certificats'],
        intitule: "Comment les certificats se répartissent par ÉTAT DE RELEVÉ et par origine — le décompte, pas la liste des certificats qui expirent",
        source: 'catalogue', chemin: '/api/certificats/resume',
        parametres: [],
        postconditions: [
            /**
             * DEUX FAMILLES DE COMPTEURS DANS LE MÊME BLOC, ET UNE SEULE SOMME AU TOTAL.
             *
             * `parStatut` est une partition ; `expires`, `invalides`, `injoignables` sont des
             * indicateurs qui SE RECOUPENT — un certificat peut être expiré et injoignable.
             * Le Catalogue le dit dans la note de la partition. Ce que la note ne dit pas,
             * c'est qu'ils sont voisins dans le même objet : un lecteur qui les additionne
             * obtient un nombre supérieur au parc de certificats sans que rien ne rougisse.
             */
            corps => {
                const voisins = ['expires', 'invalides', 'injoignables'].filter(k => typeof corps?.[k] === 'number')
                return voisins.length > 1 && corps?.parStatut
                    ? `\`${voisins.join('\`, \`')}\` SE RECOUPENT — un même certificat peut être expiré et `
                      + `injoignable. Les additionner rend un nombre supérieur au parc surveillé. Seul \`parStatut\` `
                      + `répartit sans recouvrement : c'est lui qui répond à « combien de certificats dans chaque état ».`
                    : null
            },
        ],
    },
    {
        cle: 'listes_blanches_resume',
        attendChamps: ['parSource', 'parMotifSansEcheance'],
        detailsMinimums: ['le décompte par origine ou par motif, sous les noms du référentiel'],
        contexte: ["ce que le motif implique : une règle sans échéance pour raison éditeur ne se traite pas comme une règle sans échéance faute de date saisie"],
        domaines: ['listes-blanches'],
        intitule: "Comment les règles de liste blanche se répartissent par ORIGINE et par motif d'absence d'échéance — le décompte, pas la liste des règles",
        source: 'catalogue', chemin: '/api/whitelists/resume',
        parametres: [],
        postconditions: [],
    },
    /**
     * LES AXES DE FILTRE — « combien de serveurs à l'UFR ST », qu'on ne savait pas poser.
     *
     * Le Catalogue rend désormais un résumé par axe sur chaque catalogue générique, DÉRIVÉ
     * des colonnes de la table : une partition par colonne d'énumération, une ventilation
     * par clé étrangère vers un référentiel. Ce sont exactement les filtres des écrans, sans
     * que personne les ait recopiés — ajouter une colonne fait apparaître son compteur.
     */
    {
        cle: 'resume_par_axe',
        attendChamps: ['total', 'partitions', 'ventilations', 'axes'],
        essai: { catalogue: 'serveurs' },
        detailsMinimums: [
            'le décompte par valeur, sous les noms du référentiel',
            "le total de la population, à côté de la répartition",
        ],
        contexte: [
            "l'axe demandé et lui seul : ce résumé en porte plusieurs, et les aligner tous noie la réponse",
        ],
        domaines: ['parc', 'conformite', 'risques'],
        intitule: "Combien d'objets d'un catalogue PAR AXE — par composante, service, département, lieu, responsable, ou par statut, environnement, criticité, type. C'est ici que se répond « combien de serveurs à l'UFR ST »",
        source: 'catalogue', chemin: '/api/{catalogue}/resume',
        parametres: [
            {
                cle: 'catalogue', libelle: 'Catalogue', obligatoire: true,
                valeurs: [
                    'serveurs', 'postes-travail', 'appareils-mobiles', 'iot', 'machines-indus', 'vpn',
                    'equipements-reseau', 'personnes', 'composantes', 'services', 'lieux', 'poles',
                    'technologies', 'actifs-informationnels', 'risques-smsi', 'mesures-smsi',
                    'non-conformites', 'actions-nis2', 'exigences-legales', 'processus',
                ],
            },
        ],
        postconditions: [
            /**
             * UN AXE ABSENT DE `axes` N'EST PAS UN AXE VIDE.
             */
            corps => {
                const a = corps?.axes
                if (!a) return null
                const p = (a.partitions ?? []).join(', ')
                const v = (a.ventilations ?? []).join(', ')
                return `Cette table porte les axes suivants, et EUX SEULS — partitions : ${p || 'aucune'} · `
                    + `ventilations : ${v || 'aucune'}. Un axe absent de cette liste n'existe pas sur cette table : `
                    + `ce n'est PAS un axe dont les valeurs seraient vides. Si la question porte sur un axe absent, `
                    + `le dire ainsi, et ne jamais présenter son absence comme une donnée manquante à saisir.`
            },
            /**
             * LE CROISEMENT N'EST PAS DANS CE BLOC — ET C'EST TOUT CE QU'ON PEUT EN DIRE.
             *
             * Cette mise en garde disait « le croisement n'existe pas et ne se calcule pas ».
             * La seconde moitié est vraie et le restera : multiplier deux proportions
             * supposerait les axes indépendants, ce qu'ils ne sont pas — une composante peut
             * n'avoir que de la production, une autre que de la recette.
             */
            corps => {
                const nb = Object.keys(corps?.partitions ?? {}).length + Object.keys(corps?.ventilations ?? {}).length
                return nb > 1
                    ? `Ces ${nb} axes ne se croisent pas DANS CE BLOC : « en production À l'UFR ST » n'y figure `
                      + `pas. Ne jamais l'estimer en multipliant deux proportions — cela supposerait les axes `
                      + `indépendants, ce qu'ils ne sont pas. Le croisement s'obtient en filtrant le catalogue sur `
                      + `plusieurs champs à la fois ; si la question le demande, dire que le décompte exact existe `
                      + `et que cette question-ci ne sait pas encore le poser.`
                    : null
            },
            /**
             * LES DEUX COMPLÉMENTS SANS LESQUELS AUCUNE SOMME NE FERAIT LE TOTAL.
             *
             * `sansRattachement` sur une ventilation, `non_renseigne` sur une partition. Ce
             * sont les cases qui empêchent la répartition de perdre des objets en silence —
             * exactement le `machinesOk` manquant, prévenu cette fois.
             */
            corps => {
                const orphelins = Object.entries(corps?.ventilations ?? {})
                    .map(([axe, v]: [string, any]) => [axe, Number(v?.sansRattachement) || 0] as const)
                    .filter(([, n]) => n > 0)
                return orphelins.length
                    ? `Objets sans rattachement, à citer avec la répartition : `
                      + `${orphelins.map(([axe, n]) => `${n} sur l'axe \`${axe}\``).join(', ')}. `
                      + `Sans eux, additionner les lignes rend un parc plus petit que le parc, et rien ne le signale.`
                    : null
            },
        ],
    },
    /**
     * CE QUI EST EXPOSÉ SUR INTERNET — la façade, que nous ne savions pas interroger.
     *
     * Le catalogue générique `/api/sites-services` rend les colonnes ; il ne calcule pas les
     * états, qui viennent d'une jointure entre les détections, le référentiel de technologies
     * et le certificat. Cette route-ci les rend.
     */
    {
        cle: 'services_exposes',
        attendChamps: ['resultats', 'resultats.miseAJour', 'resultats.support', 'resultats.certificat'],
        detailsMinimums: [
            "l'hôte ou le libellé du service",
            'son état de mise à jour et son état de support',
            "l'état de son certificat",
        ],
        contexte: [
            "sa technologie principale — produit et version — quand elle est connue",
            "le nombre de technologies dont la version est VÉRIFIÉE, rapporté au nombre total : « deux sur trois » et « aucune sur trois » n'appellent pas le même travail",
        ],
        domaines: ['parc', 'certificats', 'connecteurs'],
        intitule: "Quels sites et services exposés sont à jour, hors support, ou présentent un problème de certificat — l'état de la façade Internet",
        source: 'catalogue', chemin: '/api/sites-services/liste',
        defauts: { pageSize: '50' },
        parametres: [
            { cle: 'q', libelle: 'Recherche — hôte, libellé, produit détecté' },
            // FERMÉS DEPUIS QU'ILS SONT PUBLIÉS. Je les avais laissés libres faute de
            // connaître leurs valeurs ; `service.type` et `service.etatMiseAJour` sont
            // arrivés dans /api/lectures avec leurs lectures. Le gain n'est pas la
            // validation — c'est que le modèle VOIT les valeurs et emploie les bonnes.
            { cle: 'type', libelle: 'Type de service', valeurs: ['web', 'messagerie', 'annuaire', 'autre'] },
            {
                cle: 'miseAJour', libelle: 'État de mise à jour',
                valeurs: ['a_jour', 'correctif_disponible', 'non_maintenue', 'version_inconnue'],
            },
            // Les valeurs de `support` ne nous sont pas TOUTES connues — la source en a nommé
            // trois. Une liste fermée incomplète écarterait silencieusement les autres et
            // rendrait une réponse non filtrée : mieux vaut un paramètre libre et un 422
            // franc de la source qu'un filtre qui disparaît sans bruit.
            { cle: 'support', libelle: "État de support (dont `aucun` : plus aucune technologie rapprochée)" },
            {
                cle: 'certificat', libelle: 'État du certificat',
                valeurs: ['valide', 'expire_bientot', 'expire', 'invalide', 'injoignable', 'jamais_releve', 'aucun'],
            },
            { cle: 'technologie', libelle: "Nom exact d'un produit" },
            { cle: 'pageSize', libelle: 'Nombre de résultats' },
            { cle: 'page', libelle: 'Page' },
        ],
        postconditions: [
            formeGenerique,
            /**
             * `support: null` N'EST PAS « SUPPORTÉ » — c'est l'absence de rapprochement.
             *
             * Aucune technologie du service n'a été retrouvée dans le référentiel. Rien
             * n'est donc su de son support, et un service dont on ne sait rien est le plus
             * inquiétant de tous, pas le plus rassurant. Le confondre avec « à jour »
             * inverse exactement la conclusion.
             */
            corps => {
                const sans = (corps?.resultats ?? []).filter((r: any) => r?.support === null || r?.support === undefined)
                return sans.length
                    ? `${sans.length} service(s) portent \`support: null\` : AUCUNE de leurs technologies n'est `
                      + `rapprochée du référentiel. Ce n'est PAS « supporté » — c'est qu'on ne sait rien de leur `
                      + `support, ce qui est plus inquiétant, pas moins. Ne jamais les compter parmi les services sains.`
                    : null
            },
            /**
             * `supporte` N'EST PAS `ok` — le même couple que sur les machines, un étage plus haut.
             */
            corps => {
                const etats = new Set((corps?.resultats ?? []).map((r: any) => r?.support))
                return etats.has('ok') && etats.has('supporte')
                    ? "`ok` et `supporte` sont deux états DISTINCTS : `ok` a une date de fin connue et future, "
                      + "`supporte` est déclaré maintenu SANS échéance annoncée. Ne pas les fondre, et ne pas "
                      + "présenter l'un seul comme « les services à jour »."
                    : null
            },
            /**
             * SUR UNE MESSAGERIE, UNE LISTE DE TECHNOLOGIES VIDE EST NORMALE.
             *
             * Le scan applicatif cherche un serveur web, un langage, un CMS. Sur un service
             * SMTPS ou LDAPS il n'y a rien de tel à trouver : l'absence de détection est le
             * résultat attendu, pas un échec.
             */
            corps => {
                const muets = (corps?.resultats ?? []).filter((r: any) =>
                    (r?.type === 'messagerie' || r?.type === 'annuaire')
                    && Array.isArray(r?.technologies) && !r.technologies.length)
                return muets.length
                    ? `${muets.length} service(s) de messagerie ou d'annuaire ne portent AUCUNE technologie `
                      + `détectée. C'est NORMAL : le scan applicatif cherche un serveur web, un langage, un CMS — `
                      + `il n'y a rien de tel sur un SMTPS ou un LDAPS. Ne jamais présenter cette absence comme `
                      + `une détection en échec ni comme un défaut à corriger.`
                    : null
            },
            /**
             * DISTINGUER LE MÉLANGE DE L'IGNORANCE — et ne pas transformer une bonne pratique
             * en anomalie.
             */
            corps => {
                const partiels = (corps?.resultats ?? []).filter((r: any) => r?.miseAJour?.partiel)
                if (!partiels.length) return null
                const d = partiels.slice(0, 3).map((r: any) =>
                    `${r?.miseAJour?.verifiees}/${r?.miseAJour?.surTechnologies}`).join(', ')
                return `${partiels.length} service(s) sont en connaissance PARTIELLE (versions vérifiées : ${d}). `
                    + `Dire ce qui est vérifié plutôt que « rien n'est vérifié » : annoncer l'ignorance totale là où `
                    + `presque tout est connu fait perdre le travail déjà fait. Et masquer sa version est une BONNE `
                    + `pratique côté site — ne jamais la signaler comme une anomalie à corriger.`
            },
        ],
    },
    {
        cle: 'service_expose_detail',
        /**
         * `etat.certificat` EST DÉRIVÉ — et c'est tout le sujet de la rupture du 31 août.
         *
         * Ce champ rendait auparavant `certificat.dernierStatut`, qui dit si la LECTURE du
         * certificat a abouti — pas si le certificat est valide. Un certificat expiré depuis
         * un an se lit parfaitement et rend `ok`. Leur écran affichait « certificat lu » là
         * où il fallait lire « expiré ».
         */
        attendChamps: ['etat', 'etat.certificat'],
        detailsMinimums: ["l'état du certificat tel qu'il est rendu", "l'état de mise à jour du service"],
        contexte: ['les technologies détectées et leur version quand elle est connue'],
        domaines: ['parc', 'certificats'],
        intitule: "Tout ce qu'on sait d'UN site ou service exposé dont la question donne l'identifiant — technologies, support, certificat",
        source: 'catalogue', chemin: '/api/sites-services/{id}/fiche',
        parametres: [{ cle: 'id', libelle: 'Identifiant du service', obligatoire: true }],
        postconditions: [
            () => "`etat.certificat` est un état DÉRIVÉ : il conclut à la validité. `dernierStatut`, lui, dit "
                + "seulement si le relevé a abouti — un certificat expiré se lit parfaitement et rend `ok`. "
                + "Ne jamais conclure à la validité depuis le second.",
        ],
    },
    {
        cle: 'decompte_incidents',
        attendChamps: ['total'],
        intitule: "Combien d'incidents sur telle période, de tel type ou de telle gravité",
        source: 'sniff', chemin: '/api/incidents/count',
        parametres: [
            { cle: 'type', libelle: "Type d'incident", valeurs: [...SNIFF_TYPE] },
            { cle: 'status', libelle: 'Statut', valeurs: [...SNIFF_STATUT] },
            { cle: 'severity', libelle: 'Gravité — P1 à P4 acceptés', valeurs: [...SNIFF_SEVERITE] },
            { cle: 'depuis', libelle: 'Borne de début (date ISO) — porte sur la date de CONNAISSANCE' },
            { cle: 'jusqua', libelle: 'Borne de fin (date ISO)' },
            { cle: 'resolution', libelle: 'Issue du triage', valeurs: [...SNIFF_RESOLUTION] },
        ],
        postconditions: [
            /**
             * BORNER PAR PÉRIODE ÉCARTE EN SILENCE — signalé par Sniff en livrant le filtre.
             *
             * Un incident sans date de connaissance sort de tout résultat borné, sans
             * qu'aucune ligne ne manque visiblement. Le cas ne concerne que d'anciens
             * incidents — la date est obligatoire à la création depuis — mais un décompte
             * mensuel peut s'en trouver MINORÉ, et rien dans la réponse ne le dit.
             */
            (_corps, params) => params?.depuis || params?.jusqua
                ? "Ce résultat est BORNÉ par période, sur la date de CONNAISSANCE et non sur la date de saisie : "
                  + "un incident de mars enregistré en avril appartient à mars. Les incidents sans date de "
                  + "connaissance — d'anciens incidents seulement — en sont écartés SANS TRACE : ce décompte est "
                  + "donc un minorant. Pour lever la réserve, comparer au même décompte sans bornes."
                : null,
            // Le Catalogue le dit lui-même : son croisement plafonne à 100 et ne sert pas à
            // dénombrer. C'est cette route-ci qui répond à « combien ».
            () => "Ce décompte vient de Sniff, qui fait autorité sur les incidents. Le croisement du Catalogue plafonne à 100 et ne sert pas à dénombrer.",
            // Avant `72d3857`, la liste, la liste enveloppée et le décompte recopiaient
            // chacun leur filtre et divergeaient. Un total qui ne compte pas ce que la
            // liste montre est un mensonge discret : il a l'air d'un fait.
            () => "Ce décompte et la liste passent par le même filtre depuis la version 72d3857 de Sniff. Sur une version antérieure, ils peuvent diverger — voir le témoin de version de la source.",
        ],
    },

] as const

const PAR_CLE = new Map(QUESTIONS.map(q => [q.cle, q]))
export const question = (cle: string) => PAR_CLE.get(cle) ?? null

/** Ce que le modèle voit pour choisir. Ni chemins, ni détails techniques. */
export function catalogueLisible(
    filtres: { catalogue: string, filtres: { champ: string, nature: string, valeurs?: string[] }[],
               commentCroiser?: string, neJamaisFaire?: string }[] = [],
): string {
    return QUESTIONS.map(q => {
        const p = q.parametres.map(x => x.valeurs?.length ? `${x.cle}=${x.valeurs.join('|')}` : x.cle)
        let bloc = `- ${q.cle} : ${q.intitule}${p.length ? `\n    paramètres : ${p.join(' · ')}` : ''}`

        /**
         * LES FILTRES SE MONTRENT, SINON ILS N'EXISTENT PAS.
         *
         * Valider un filtre reçu ne sert à rien si le modèle ignore qu'il peut le poser. On
         * rend donc, pour les questions qui les acceptent, les filtres publiés de chacun de
         * leurs catalogues — vocabulaires avec leurs valeurs, autres natures par leur nom.
         */
        if (q.filtresPublies) {
            const admis = new Set(q.parametres.find(x => x.cle === 'catalogue')?.valeurs ?? [])
            const lignes = filtres
                .filter(f => admis.has(f.catalogue))
                .map((f) => {
                    // Le TEXTE libre n'est pas proposé : son total compte une correspondance
                    // de chaîne, variable avec la formulation, et se lit comme un recensement.
                    // Il reste accepté s'il est demandé — nous cessons d'y pousser, nous ne
                    // retirons pas la capacité.
                    const d = f.filtres.filter(x => x.nature !== 'texte').map(x =>
                        x.nature === 'vocabulaire' && x.valeurs?.length
                            ? `${x.champ}=${x.valeurs.join('|')}`
                            : `${x.champ}`)
                    if (!d.length) return ''
                    const garde = [f.commentCroiser, f.neJamaisFaire].filter(Boolean).join(' — ')
                    return `      ${f.catalogue} : ${d.join(' · ')}${garde ? `\n        ${garde}` : ''}`
                })
                .filter(Boolean)
            if (lignes.length) {
                bloc += `\n    filtres combinables en ET (le total devient celui du croisement) :\n${lignes.join('\n')}`
            }
        }
        return bloc
    }).join('\n')
}

/**
 * Un chemin de forme est-il présent dans un corps ?
 *
 * `présent` signifie « la clé existe », valeur nulle comprise — c'est le contrat des
 * sources, où `null` porte un sens (`resume.nis2: null` = hors portée). Un tableau se
 * vérifie sur son premier élément ; vide, la réponse est `indécidable` : on ne peut pas
 * distinguer « le champ a disparu des lignes » de « il n'y a pas de lignes », et conclure
 * faux sur une liste vide fabriquerait des fausses alertes à chaque référentiel calme.
 */
export function champPresent(corps: unknown, chemin: string): 'present' | 'absent' | 'indecidable' {
    let n: any = corps
    const parts = chemin.split('.')
    for (const [i, part] of parts.entries()) {
        if (Array.isArray(n)) {
            if (!n.length) return 'indecidable'
            n = n[0]
        }
        /**
         * UN BLOC `null` NE PARLE PAS DE SES ENFANTS — signalé par le Catalogue le 30 août
         *
         * `/api/conformite/resume` rend `nis2: null` quand l'appelant n'a pas le droit de
         * lire ce cadre. Ce n'est ni un cadre vide ni un champ disparu : c'est une portée.
         * Déclarer `nis2.parConformite` en champ attendu aurait donc fait rougir le harnais
         * sur une clé de service restreinte — un rouge dû à nos droits, imputé à leur
         * livraison, et la fois d'après on cesse de croire le rouge.
         */
        // Un corps ENTIER à `null` n'est pas une portée, c'est une source qui n'a rien
        // rendu : la distinction ne vaut qu'à l'intérieur.
        if (n === null) return i === 0 ? 'absent' : 'indecidable'
        if (typeof n !== 'object' || !(part in n)) return 'absent'
        n = n[part]
    }
    return 'present'
}

/**
 * Interprète ce que l'orientation a répondu — veto compris.
 *
 * Le veto vit en CODE parce qu'aucune question déclarée ne sait répondre à un « comment
 * faire » : c'est un fait du catalogue, pas une préférence de consigne. Une clé choisie ne
 * survit jamais à `nature: "conduite"`. Nature absente ou inconnue : on laisse passer — un
 * modèle qui n'émet pas le champ ne doit pas éteindre tout le chemin données.
 */
export function interpreterOrientation(
    j: { nature?: string, cle?: string | null, params?: Record<string, string> } | null,
): { cle: string, params: Record<string, string> } | null {
    const q = j?.cle ? question(j.cle) : null
    if (!j?.cle || !q) return null
    if (j.nature === 'conduite') return null
    if (identifiantGenerique(q, j.params ?? {})) return null
    return { cle: j.cle, params: j.params ?? {} }
}

const mots = (s: string) => s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/**
 * UN IDENTIFIANT QUI RÉPÈTE LE NOM DE SA CATÉGORIE N'EST PAS UN IDENTIFIANT.
 *
 * La règle est déterministe et se lit sur la déclaration elle-même : quand la valeur d'un
 * paramètre obligatoire À VALEURS LIBRES est exactement un mot de son propre libellé, elle
 * désigne la catégorie et non l'objet. « nom » sur « Nom ou identifiant de l'application »
 * ne peut pas valoir « application », pas plus qu'un identifiant d'incident ne vaut
 * « incident ».
 */
export function identifiantGenerique(q: Question, params: Record<string, string>): boolean {
    return q.parametres.some((p) => {
        // Les valeurs fermées sont déjà filtrées par `executer()` : ce garde-fou ne vise
        // que les identifiants libres, les seuls qu'un modèle puisse inventer.
        if (!p.obligatoire || p.valeurs?.length) return false
        const v = params[p.cle]
        if (!v) return false
        const propres = mots(v)
        return propres.length === 1 && mots(p.libelle).includes(propres[0]!)
    })
}

/** Applique les post-conditions d'une question au corps reçu. */
export function mentionsDe(q: Question, corps: unknown, params: Record<string, string> = {}): string[] {
    const out: string[] = []
    for (const regle of q.postconditions ?? []) {
        try { const m = regle(corps, params); if (m) out.push(m) }
        catch { /* une post-condition ne doit jamais faire échouer une réponse */ }
    }
    return out
}
