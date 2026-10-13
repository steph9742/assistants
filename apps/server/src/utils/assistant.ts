// OUTIL 1 — RÉPONSE ANCRÉE DANS LE CORPUS.
//
// Chercher, encadrer, demander, citer. Le modèle n'a accès qu'aux passages retenus et n'a
// aucun moyen d'en obtenir d'autres : il n'appelle aucun outil, il reçoit un texte et rend
// un texte.

import { db } from "@assistants/database";
import { corrigerAdditions } from "./additions";
import { trierMentions } from "./mentions";
import { sql } from "drizzle-orm";
import { indexSchema } from "@assistants/database/tables";
import { blocNonFiable, discuter, lireConfigIA, promptSysteme, empreinte, type ConfigIA, type Origine } from "./ia";
import { chercher, preseance, sourcesConsultees, RANGS, type PassageTrouve } from "./recherche";
import { lire, lireNombre } from "./reglages";
import { calculerVecteur } from "./embeddings";
import { extraireJson } from "./ia";
import { catalogueLisible, interpreterOrientation, question, SNIFF_TYPE } from "./questions";
import { executer, sourcesDonneesActives, type Appel } from "./donnees";
import { catalogueFusionne } from "./lectures";
import { construireResume, reformuler, tronquerFil, type TourFil } from "./fil";

/** Ce qui est affiché à côté de la réponse. Chaque affirmation doit pouvoir y renvoyer. */
export type Citation = {
    reference: string | null
    titre: string
    section: string | null
    url: string | null
    /**
     * Affiché systématiquement. 35 des 53 fiches du corpus sont en `brouillon` : sans cette
     * mention, l'assistant présenterait majoritairement des brouillons comme des procédures
     * arrêtées.
     */
    statut: string | null
    version: string | null
    dateRevision: string | null
    source: string
    score: number
    /** Phrase que la réponse doit porter quand ce document est cité. */
    mention: string | null
}

export type Reponse = {
    /** Renseigné quand la réponse vient d'une source vivante et non de l'index. */
    donnees?: { requete: string, corps: unknown, mentions: string[], erreur?: string }
    trouve: boolean
    /**
     * POURQUOI il n'y a pas de réponse. `trouve: false` couvrait trois situations que rien
     * ne distinguait, et l'interface les affichait toutes comme un trou documentaire versé
     * au journal des lacunes.
     */
    issue: 'reponse' | 'rien_ecrit' | 'insuffisant' | 'illisible' | 'echec_source'
    /**
     * La question telle que la reformulation l'a comprise, quand un fil la précédait et
     * que le modèle l'a réécrite. AFFICHÉE à l'utilisateur, et corrigeable : la chaîne
     * entière a tourné sur elle, pas sur ce qui a été tapé — le dire est la règle 7
     * appliquée au fil.
     */
    questionComprise?: string
    /**
     * Le résumé d'état de cette réponse, construit en code — ce que le tour suivant en
     * saura. Le client le renvoie tel quel dans le fil ; il ne contient que des faits
     * extraits : requête exécutée, identifiants, types, références citées.
     */
    resume: string
    /**
     * Renseigné UNIQUEMENT sur `rien_ecrit` : ce que la recherche a cherché, et ce qui est
     * passé juste à côté. Un terme à `df: 0` ne figure dans aucun passage indexé — c'est ce
     * qui distingue « le document emploie d'autres mots » de « le document n'est pas là ».
     */
    diagnostic?: {
        termes: { mot: string, df: number, poids: number }[]
        frolements: { titre: string, section: string | null, score: number, url: string | null }[]
        plancher: number
    }
    texte: string
    citations: Citation[]
    /** Étiquettes d'autorité présentes parmi les passages cités. */
    autoritesEnPresence: string[]
    prime?: { categorie: string, sur: string[] }
    /** Documents repérés mais dont le contenu n'est pas indexable — PDF scannés. */
    nonIndexables: Citation[]
    mode: 'lexical' | 'hybride'
    origine: Origine
}

export const CONSIGNE_DEFAUT = [
    "Réponds à la question À PARTIR DES BLOCS <donnee> UNIQUEMENT.",
    '',
    "CHAQUE AFFIRMATION PORTE SA SOURCE, sous la forme [RÉFÉRENCE — titre de section]. Une procédure reformulée sans sa source est une procédure qui a perdu son autorité.",
    "Ne recopie pas les passages en entier : ils sont affichés à côté de ta réponse. Cite le point qui répond, et sa section.",
    '',
    "Si les blocs ne permettent pas de répondre, écris exactement « Ce n'est pas écrit. » et rien d'autre. Ne complète JAMAIS avec ce que tu sais par ailleurs d'un outil du commerce : le déploiement de l'établissement n'est pas celui de la documentation officielle.",
    // « Ne permettent pas de répondre » s'évaluait sur les MOTS : « que faire si un
    // utilisateur signale un mail suspect qui demande ses identifiants ? » a rendu
    // « Ce n'est pas écrit » devant la fiche compte compromis presque entière et la
    // checklist phishing — parce qu'aucun bloc ne disait « mail suspect ». Les sections
    // « Déclencheurs » existent précisément pour reconnaître les situations dans les mots
    // de l'utilisateur ; la consigne doit le dire, sinon le refus honnête mange les
    // questions posées autrement que la fiche ne s'écrit.
    "« Ne permettent pas de répondre » s'évalue sur le FOND, pas sur les mots : une question posée dans les mots de l'utilisateur est traitée si les blocs portent la conduite correspondante dans le vocabulaire des fiches. Quand des déclencheurs ou un aiguillage d'un bloc reconnaissent la situation décrite, la fiche répond — restitue sa conduite, en citant l'aiguillage d'abord. Réserve « Ce n'est pas écrit » au cas où AUCUNE conduite applicable à la situation ne figure dans les blocs.",
    "Si deux blocs de MÊME autorité se contredisent, signale la contradiction et cite les deux. Ne choisis pas : une note d'équipe qui dit autre chose qu'une procédure, c'est une divergence que la cellule doit trancher.",
    "Si une CONSIGNE DE PRÉSÉANCE t'est donnée ci-dessous, applique-la : elle ne vient pas de toi, elle vient d'une règle écrite par la cellule.",
    "Tu ne comptes ni ne tries : si la question demande un dénombrement ou un classement, dis que cela relève d'une requête et non d'une lecture.",
].join('\n')

/** La consigne des réglages si elle existe, celle du code sinon. */
async function consigneReponse(): Promise<string> {
    return (await lire('ia.prompt.assistant')) || CONSIGNE_DEFAUT
}

/**
 * Compose ce que voit le modèle.
 *
 * Chaque passage est encadré séparément avec sa référence en attribut de source. Un seul
 * gros bloc aurait suffi techniquement, mais le modèle doit pouvoir attribuer chaque phrase
 * à un document précis pour citer juste — et un passage empoisonné doit rester attribuable.
 */
/**
 * Les liens RELATIFS des documents ne survivent pas à la citation.
 *
 * La règle vit dans le contrat de sortie, pas dans la consigne éditable : un lien mort est
 * un défaut de forme que personne ne devrait pouvoir réintroduire en réécrivant un réglage.
 */
const CONTRAT_LIENS = "\nNE RECOPIE JAMAIS un lien Markdown relatif tiré d'un document"
    + " — il ne mène nulle part hors du dépôt. Nomme la référence à la place : « voir"
    + " l'annexe J §3 », sans parenthèses de lien. Les liens complets (https…) restent permis."

/**
 * Désarme les liens Markdown dont la cible n'est pas une URL complète.
 */
export function desarmerLiensMorts(texte: string): string {
    return texte.replace(/!?\[([^\]]*)\]\((?!https?:\/\/)[^)]*\)/g, '$1')
}

function composer(passages: PassageTrouve[]): string {
    return passages.map(p => {
        const etiquette = [p.reference, p.titreSection].filter(Boolean).join(' — ') || p.titre
        const entete = [
            `Document : ${p.titre}${p.reference ? ` (${p.reference})` : ''}`,
            p.statut ? `Statut : ${p.statut}` : null,
            p.dateRevision ? `Révision : ${p.dateRevision}` : null,
        ].filter(Boolean).join(' · ')
        return blocNonFiable(etiquette, `${entete}\n\n${p.texte}`)
    }).join('\n\n')
}

function citer(p: PassageTrouve): Citation {
    return {
        reference: p.reference, titre: p.titre, section: p.titreSection,
        url: p.url, statut: p.statut, version: p.version, dateRevision: p.dateRevision,
        source: p.sourceNom, score: Math.round(p.score * 1000) / 1000,
        mention: p.mention,
    }
}

/**
 * ORIENTATION — question de documents, ou question de données ?
 *
 * Un appel court et séparé, plutôt qu'un modèle laissé libre de décider en cours de
 * rédaction. Deux raisons : la décision est ainsi TRAÇABLE — on sait quelle question a été
 * choisie et avec quels paramètres — et une réponse mal orientée se voit tout de suite au
 * lieu de se cacher dans une phrase.
 */
async function orienter(cfg: ConfigIA, question_: string): Promise<{ cle: string, params: Record<string, string> } | null> {
    const dispo = await sourcesDonneesActives()
    if (!dispo.length) return null

    // LA NATURE SE DÉCIDE AVANT LE CHOIX, dans un champ à part. En une seule passe, un mot
    // de la question qui ressemble à un nom du catalogue aimantait le choix avant que la
    // règle « comment faire = procédure » ne soit appliquée — constaté sur « comment mettre
    // à jour notre application catalogue ? », partie données. Répondre d'abord « état ou
    // conduite ? » est une question plus facile, et le veto est ensuite appliqué en code
    // par interpreterOrientation : une clé choisie ne survit pas à une nature « conduite ».
    const consigne = [
        "On te donne une question posée par un analyste, et la liste des questions que l'application sait poser aux systèmes vivants.",
        '',
        "DÉCIDE D'ABORD LA NATURE de la question, avant de regarder la liste :",
        "- « etat » : elle demande ce qui EST — ce qui existe, ce qui a expiré, où on en est, combien il y en a.",
        "- « conduite » : elle demande ce qu'il faut FAIRE ou COMMENT le faire — une procédure, une marche à suivre, une règle, une explication.",
        '',
        "Aucune question de la liste ne sait répondre à une « conduite » : dans ce cas, cle est null, TOUJOURS — "
        + "même si un mot de la question ressemble à un nom de la liste. « Comment mettre à jour notre application "
        + "catalogue ? » est une conduite : « catalogue » y nomme l'application visée, pas une donnée à lire. "
        + "« Comment isoler », « que faire », « comment faire X » sont des conduites même quand elles nomment un "
        + "incident ou une machine précise : le nom situe la question, il ne la transforme pas en demande de données.",
        "Si la nature est « etat », choisis la question de la liste qui y répond. Dans le doute, ne choisis rien.",
        // « on a une application qui a des problèmes RGPD ? » a été orientée
        // vers la fiche d'UNE application, nom rempli avec le mot « application ». Un
        // champ obligatoire se remplit parce qu'il est obligatoire, pas parce qu'on sait
        // quoi y mettre. Le garde-fou de code (identifiantGenerique) rattrape le cas ;
        // cette ligne évite d'y arriver.
        "UN PARAMÈTRE OBLIGATOIRE QUI IDENTIFIE UN OBJET — nom d'application, identifiant d'incident, "
        + "machine — doit être NOMMÉ dans la question. Si la question n'en nomme aucun, ne remplis pas "
        + "ce champ avec un mot ordinaire de la question : choisis plutôt une question qui LISTE, ou ne "
        + "choisis rien.",
        '',
        'QUESTIONS DISPONIBLES',
        catalogueLisible((await catalogueFusionne(dispo)).filtres),
        '',
        'Réponds par {"nature": "etat"|"conduite", "cle": "...", "params": {...}} — cle à null si aucune question ne convient. Rien d\'autre.',
    ].join('\n')

    try {
        const r = await discuter(cfg, await promptSysteme(cfg),
            `${blocNonFiable('question-utilisateur', question_)}\n\n${consigne}`)
        const j = extraireJson<{ nature?: string, cle?: string | null, params?: Record<string, string> }>(r)
        return interpreterOrientation(j)
    }
    catch {
        // Une orientation qui échoue ne doit pas empêcher de répondre sur documents.
        return null
    }
}

/**
 * Rédige à partir d'un résultat de source vivante.
 *
 * Le corps est encadré comme non fiable au même titre qu'un passage d'index : il vient d'une
 * API, donc d'ailleurs, et il peut transporter du texte saisi par un tiers — le libellé
 * d'une règle EDR, la description d'un incident recopiée d'un courriel d'hameçonnage.
 */
/**
 * Les champs qu'une réponse doit porter pour chaque élément cité.
 *
 * Déclarés par question, parce qu'un incident et une échéance ne s'identifient pas par les
 * mêmes champs — et en CODE plutôt qu'en consigne, pour la même raison que les
 * post-conditions : une consigne se réécrit dans les réglages, et « dis lequel » ne doit pas
 * pouvoir se perdre.
 */
export function detailsAttendus(appel: Appel): string {
    const q = question(appel.cle)
    if (!q) return ''
    const bouts: string[] = []

    if (q.detailsMinimums?.length) {
        bouts.push(`Chaque élément cité porte : ${q.detailsMinimums.join(', ')}.`)
    }
    if (q.contexte?.length) {
        bouts.push(`RATTACHEMENTS, quand ils figurent dans les données : ${q.contexte.join(' ; ')}. `
            + `S'ils n'y figurent pas, le dire — et ne jamais les deviner.`)
    }
    if (q.aOmettre?.length) {
        bouts.push(`À TAIRE pour cette question : ${q.aOmettre.join(' ; ')}.`)
    }
    return bouts.join('\n')
}

/**
 * Borne le corps envoyé au modèle — aux frontières de lignes, et EN LE DISANT.
 *
 * Ici, le plus grand tableau du corps est réduit par moitiés jusqu'à tenir, le JSON reste
 * VALIDE, et la note dit au modèle ce qu'il ne voit pas. La coupe au couperet ne subsiste
 * que pour un corps sans tableau à réduire — et elle se nomme aussi.
 */
export function bornerCorps(corps: unknown, plafond: number): { texte: string, note: string | null } {
    const entier = JSON.stringify(corps)
    if (entier.length <= plafond) return { texte: entier, note: null }

    const note = (montrees: number, recues: number, champ: string) =>
        `BLOC TRONQUÉ : seules les ${montrees} premières lignes de \`${champ}\` (sur ${recues} reçues) te sont `
        + `montrées. Les totaux du bloc font foi — ne conclus JAMAIS un décompte des lignes visibles, et dis `
        + `explicitement que le détail rendu est partiel.`

    const reduire = (lignes: unknown[], rebatir: (garde: unknown[]) => unknown, champ: string) => {
        for (let garde = Math.floor(lignes.length / 2); garde >= 1; garde = Math.floor(garde / 2)) {
            const essai = JSON.stringify(rebatir(lignes.slice(0, garde)))
            if (essai.length <= plafond) return { texte: essai, note: note(garde, lignes.length, champ) }
        }
        return null
    }

    if (Array.isArray(corps)) {
        const r = reduire(corps, g => g, 'la racine')
        if (r) return r
    }
    else if (corps && typeof corps === 'object') {
        const o = corps as Record<string, unknown>
        const cle = Object.keys(o).filter(k => Array.isArray(o[k]))
            .sort((a, b) => (o[b] as unknown[]).length - (o[a] as unknown[]).length)[0]
        if (cle) {
            const r = reduire(o[cle] as unknown[], g => ({ ...o, [cle]: g }), cle)
            if (r) return r
        }
    }

    return {
        texte: entier.slice(0, plafond),
        note: `BLOC TRONQUÉ à ${plafond} caractères : la fin manque et le JSON est incomplet. Les totaux `
            + `font foi ; dis explicitement que le détail rendu est partiel.`,
    }
}

async function redigerDonnees(cfg: ConfigIA, question_: string, appel: Appel, conduite: PassageTrouve[]): Promise<string> {
    const borne = bornerCorps(appel.corps, 24_000)
    const consigne = [
        "Réponds à la question à partir du bloc de données UNIQUEMENT.",
        // La requête, avec ses paramètres : sans elle, le modèle ne peut pas savoir que le
        // bloc est DÉJÀ filtré. Constaté sur `sansMotif=true` : « impossible de déterminer
        // combien parmi les 68 » — alors que les 68 étaient toutes sans motif, le filtre
        // ayant fait le tri avant lui. Le total d'un bloc filtré répond à la question du
        // filtre.
        `REQUÊTE EXÉCUTÉE : ${appel.requete} — le bloc est la réponse à CETTE requête. Ses filtres sont `
        + "déjà appliqués : si la question correspond au filtre, le `total` du bloc EST la réponse, pas "
        + "une borne inférieure.",
        "Tu ne comptes ni ne tries : les totaux te sont fournis, emploie-les tels quels. Si un total ne figure pas dans les données, dis que le décompte n'est pas disponible plutôt que de compter les lignes reçues.",
        borne.note ?? '',

        // TU NE PRESCRIS JAMAIS DE TON PROPRE CHEF. « comment mettre à jour
        // l'application » orienté par erreur vers les données a rendu une fiche, puis une
        // marche à suivre INVENTÉE — « il est nécessaire de corriger les écarts RGPD… » —
        // qu'aucune source n'écrit. Une conduite improvisée sur des faits réels est pire
        // qu'une absence de réponse : elle a l'air fondée. Les conduites viennent des
        // fiches, attachées par l'application quand une déclaration existe — jamais de toi.
        "TU NE PRESCRIS AUCUNE CONDUITE de ta propre initiative. Si la question demande COMMENT FAIRE "
        + "et que les données ne contiennent que des faits, dis-le : « ces données décrivent l'état, la "
        + "marche à suivre n'y figure pas — reposez la question en termes de procédure ». Les seules "
        + "étapes que tu peux restituer sont celles des fiches qui te sont explicitement fournies.",

        // UN OUI N'EST PAS UNE RÉPONSE. « Sois bref » produisait « Oui, il y a un incident
        // P1 » — exact, et inutilisable : on ne sait pas lequel, ni quand, ni où le
        // retrouver. Quelqu'un qui demande s'il y a eu un P1 veut savoir ce qui s'est passé,
        // pas obtenir la confirmation qu'une ligne existe quelque part.
        //
        // L'identité de chaque élément est donc EXIGÉE, et la brièveté rabattue là où elle
        // a du sens : le commentaire, pas le constat.
        "\nCHAQUE ÉLÉMENT QUE TU CITES DOIT ÊTRE IDENTIFIABLE. Pour chacun, donne au minimum "
        + "son identifiant, son titre ou son libellé, sa description quand elle existe, et ses dates. "
        + "Ne réponds JAMAIS par un simple oui ou non quand des éléments figurent dans les données : "
        + "le lecteur doit pouvoir retrouver la fiche dont tu parles sans relire le résultat brut.",
        // Le balancier : « une » (faux) corrigé a donné « 68 » tout court — le nombre
        // seul, l'autre signature interdite. Le total répond au combien, l'échantillon
        // répond au « lesquelles » que la question suivante posera de toute façon.
        "UN TOTAL SEUL N'EST PAS UNE RÉPONSE quand des lignes figurent dans le bloc : donne le total, "
        + "puis détaille les premières lignes en échantillon — identifiant, libellé, dates — en disant "
        + "qu'il y en a d'autres. Le lecteur doit repartir avec le chiffre ET de quoi commencer à agir.",
        detailsAttendus(appel),
        "Cite les dates telles qu'elles figurent, en précisant de quelle date il s'agit — "
        + "une date de détection et une date de modification ne se remplacent pas.",
        // L'interface rend le Markdown, tableaux compris. Le dire, sinon le modèle produit
        // des listes à puces là où trois colonnes se lisent d'un coup d'œil.
        "Au-delà de deux éléments, présente-les en TABLEAU Markdown, une colonne par champ. "
        + "En deçà, une phrase suffit — un tableau d'une ligne se lit moins bien qu'une phrase.",

        // CE QU'ON TAIT. Sans cette moitié, la consigne précédente produit un mur de texte
        // où la réponse se perd — le contraire de ce qu'on cherche, obtenu en voulant bien
        // faire. Ajouter des champs sans en retrancher n'est pas enrichir, c'est diluer.
        "\nNE RECOPIE PAS TOUT LE RÉSULTAT. Il est affiché brut à côté de ta réponse : ce qui s'y "
        + "trouve n'a pas besoin d'y être deux fois. Tais les identifiants internes qui ne servent à "
        + "rien retrouver, les horodatages de synchronisation, les drapeaux techniques, et les champs "
        + "dont la valeur ne change rien à la compréhension.",

        // Et l'exception, qui est tout le sujet de cet outil : un vide qui compte.
        "N'énumère PAS les champs vides — sauf lorsque la source les désigne elle-même comme "
        + "manquants, dans un champ `manques` ou équivalent. Un champ optionnel non rempli est du "
        + "bruit ; un manque que la source signale est une information, et il se dit.",

        "\nSois bref DANS LE COMMENTAIRE, pas dans les faits. La requête exécutée et le résultat brut "
        + "sont affichés à côté de ta réponse.",
    ].filter(Boolean).join('\n')

    /**
     * LES MISES EN GARDE FORMENT LA RÉPONSE, ELLES NE SONT PAS LA RÉPONSE.
     *
     * Cette consigne disait « ta réponse doit reprendre CHACUNE, mot pour mot ; en omettre
     * une est une faute ». Écrite quand il y en avait trois et qu'elles tombaient, elle
     * était juste. À douze, elle produit exactement ce qu'elle demande : une section
     * « Mises en garde obligatoires » de douze puces, plus longue que la donnée. Le lecteur
     * venu compter des machines lit un règlement.
     */
    const { aDire, aFaire } = trierMentions(appel.mentions)
    const voletMentions = (aDire.length ? `\n\nÀ DIRE — ${aDire.length} réserve(s) qui qualifient un fait de ce bloc. `
        + `Chacune se place IMMÉDIATEMENT à côté du fait qu'elle qualifie, dans tes mots. Une réserve reléguée `
        + `en bas de réponse ne protège personne : le chiffre reste en haut, nu. N'écris AUCUNE section `
        + `« mises en garde », aucune liste de réserves, aucune note finale.\n`
        + aDire.map((m, i) => `${i + 1}. ${m}`).join('\n') : '')
        + (aFaire.length ? `\n\nÀ FAIRE — ${aFaire.length} contrainte(s) sur ta façon d'écrire. Tu les respectes `
        + `en écrivant ainsi. Ne les cite JAMAIS, ne les recopie pas, n'y fais pas allusion : les montrer, `
        + `c'est afficher la consigne au lieu de l'appliquer.\n`
        + aFaire.map((m, i) => `${i + 1}. ${m}`).join('\n') : '')

    // Le volet conduite : les sections des fiches sont fournies comme sur le chemin
    // documentaire — encadrées, attribuables, et accompagnées de leurs mentions
    // obligatoires (brouillon compris).
    const voletConduite = conduite.length
        ? `\n\n${composer(conduite)}\n\nVOLET « LA CONDUITE À TENIR » : les incidents de la réponse ont un type`
          + ` couvert par ${[...new Set(conduite.map(c => c.reference))].join(' et ')}. Après les faits, restitue`
          + ` les étapes de conduite fournies ci-dessus, dans l'ordre, chacune citée [RÉFÉRENCE — section].`
          + ` Ne mélange jamais un fait constaté (la donnée) et une étape prescrite (la fiche) dans la même phrase.`
          + `${consigneMentions(conduite)}`
        : ''

    return discuter(cfg, await promptSysteme(cfg),
        `${blocNonFiable('resultat-api', borne.texte)}\n\n${consigne}${voletConduite}`
        + `\n\nQUESTION : ${question_}${voletMentions}`)
}

/**
 * L'ÉTAPE EN COURS — ce que la chaîne est en train de faire.
 *
 * Une question met plusieurs dizaines de secondes : orientation, recherche, puis rédaction
 * par le modèle, qui est de loin le plus long. Devant un « Recherche… » figé, on ne peut
 * pas distinguer une chaîne qui avance d'une chaîne bloquée — et les gens relancent, ce qui
 * double la charge sur un serveur déjà lent.
 */
export type Etape =
    | { etape: 'reformulation' }
    | { etape: 'orientation' }
    | { etape: 'donnees', requete: string }
    | { etape: 'recherche' }
    | { etape: 'redaction', passages?: number, conduite?: number }

export type SurEtape = (e: Etape) => void

export async function repondre(
    cfg: ConfigIA,
    question: string,
    utilisateur: string | null,
    fil: TourFil[] = [],
    surEtape?: SurEtape,
): Promise<Reponse> {
    /**
     * LE CONTEXTE N'ENTRE QUE PAR LA REFORMULATION. Elle transforme « comment j'isole ? »
     * en question autonome — identifiants recopiés — puis toute la chaîne tourne sur cette
     * question, inchangée et déterministe. L'orientation, la recherche et la rédaction ne
     * voient jamais le fil : un seul point d'entrée du contexte, un seul endroit où il peut
     * se tromper, un seul endroit à regarder quand une réponse est à côté.
     */
    /**
     * CHAQUE ÉTAPE PEUT AVOIR SON MODÈLE — et chacune n'a pas besoin du même.
     *
     * L'orientation classe dans un vocabulaire fermé : c'est la discipline qui compte, pas
     * la finesse. La reformulation réécrit sous contrainte : un modèle qui infère trop y est
     * un danger — c'est lui qui a substitué une composante à une autre. La rédaction tient
     * seize contraintes à la fois, et c'est là que la taille paie.
     */
    const cfgReformulation = (await lireConfigIA('reformulation')) ?? cfg
    const tronque = await tronquerFil(fil)
    if (tronque.length) surEtape?.({ etape: 'reformulation' })
    const { question: comprise, reformulee } = await reformuler(cfgReformulation, tronque, question)

    const r = await repondreInterne(cfg, comprise, utilisateur, surEtape)

    // RÈGLE 7 : le texte dit qui l'a formé, à chaque étape qui a réellement changé de
    // modèle. Un seul nom pour un texte produit par trois rendrait « est-ce l'orientation
    // ou la rédaction ? » sans réponse — et c'est la première question qu'on pose devant
    // une réponse à côté.
    const etapes: Record<string, string> = { ...(r.origine?.etapes ?? {}) }
    if (tronque.length && cfgReformulation.modele !== cfg.modele) etapes.reformulation = cfgReformulation.modele

    return {
        ...r,
        origine: r.origine && Object.keys(etapes).length ? { ...r.origine, etapes } : r.origine,
        questionComprise: reformulee ? comprise : undefined,
        resume: construireResume(r),
    }
}

async function repondreInterne(
    cfg: ConfigIA,
    question: string,
    utilisateur: string | null,
    surEtape?: SurEtape,
): Promise<Omit<Reponse, 'resume'>> {
    const sys = await promptSysteme(cfg)

    // Chemin « données » d'abord : si la question porte sur un état actuel, l'index ne peut
    // qu'en donner une version périmée.
    surEtape?.({ etape: 'orientation' })
    const cfgOrientation = (await lireConfigIA('orientation')) ?? cfg
    const oriente = await orienter(cfgOrientation, question)
    // L'ÉTAPE QUI DÉCIDE DE TOUT LE RESTE. Une erreur de rédaction se voit ; une erreur
    // d'orientation envoie sur la mauvaise route et la réponse reste cohérente. Elle se
    // note donc dans l'origine même quand elle ne rend rien : c'est elle qu'on soupçonnera.
    const etapeOrientation: Record<string, string> = cfgOrientation.modele !== cfg.modele
        ? { orientation: cfgOrientation.modele }
        : {}
    if (oriente) {
        const appel = await executer(oriente.cle, oriente.params)
        if (appel) {
            surEtape?.({ etape: 'donnees', requete: appel.requete })
            const rd = await reponseDonnees(cfg, question, appel, utilisateur, surEtape)
            return { ...rd, origine: { ...rd.origine, etapes: { ...rd.origine.etapes, ...etapeOrientation } } }
        }
    }

    surEtape?.({ etape: 'recherche' })
    const r = await chercher(question, calculerVecteur)
    const origine: Origine = {
        modele: cfg.modele,
        consigne: empreinte(sys, await consigneReponse()),
        ...(Object.keys(etapeOrientation).length ? { etapes: etapeOrientation } : {}),
        date: new Date().toISOString(),
    }

    if (r.sousLePlancher) {
        await consignerLacune(question, r.meilleurScore, utilisateur)
        return {
            trouve: false, issue: 'rien_ecrit',
            texte: "Ce n'est pas écrit.",
            // Le diagnostic voyage avec la réponse. « Pourtant c'est dans la doc » a deux
            // causes qui n'appellent pas la même suite — un écart de vocabulaire ou une
            // vraie lacune — et rien ne permettait de les distinguer.
            diagnostic: r.diagnostic,
            citations: [], autoritesEnPresence: [], nonIndexables: [],
            mode: r.mode, origine,
        }
    }

    // Un PDF scanné s'indexe sans texte : il ne peut pas fonder une réponse, mais son
    // existence est une information. Le taire produirait « ce n'est pas écrit » alors que
    // c'est écrit — dans une image — et polluerait le journal des lacunes.
    const indexables = r.passages.filter(p => p.extraction === 'complete')
    const nonIndexables = r.passages.filter(p => p.extraction !== 'complete').map(citer)

    if (!indexables.length) {
        return {
            trouve: false, issue: 'illisible',
            texte: "Ce n'est pas écrit dans un document indexable. Des documents existent sur ce sujet, mais leur contenu n'a pas pu être lu — voir ci-contre.",
            citations: [], autoritesEnPresence: [], nonIndexables,
            mode: r.mode, origine,
        }
    }

    const p = preseance(indexables)
    /**
     * L'EMPREINTE COUVRE CE QUI EST PARTI, PAS SEULEMENT LA CONSIGNE DE BASE.
     *
     * Elle ne portait que le prompt système et la consigne éditable — les consignes
     * CALCULÉES en étaient absentes : volets, aiguillage, préséance, mentions. Deux
     * réponses produites avec des instructions matériellement différentes affichaient donc
     * la même empreinte, et une correction de ces consignes ne se voyait nulle part. C'est
     * la règle 7 tenue à moitié : « toute sortie porte son origine » veut dire l'origine
     * réelle, sinon l'empreinte rassure au lieu d'identifier.
     */
    const consigneComplete = `${await consigneReponse()}${CONTRAT_LIENS}${consigneFiche(indexables)}`
        + `${consigneVolets(indexables)}${consigneAiguillage(indexables)}${consignePreseance(p)}${consigneMentions(indexables)}`
    surEtape?.({ etape: 'redaction', passages: indexables.length })
    const texte = await discuter(cfg, sys,
        `${composer(indexables)}\n\n${consigneComplete}\n\nQUESTION : ${question}`)
    // Seule cette branche a réellement appelé le modèle : elle seule peut porter l'empreinte
    // de ce qui est parti. Les branches sans appel gardent l'empreinte de base ci-dessus —
    // une empreinte de consignes qu'on n'a pas bâties serait une empreinte inventée.
    const origineRedigee: Origine = { ...origine, consigne: empreinte(sys, consigneComplete) }
    /**
     * L'ARITHMÉTIQUE SE CORRIGE SUR TOUS LES CHEMINS, PAS SUR CELUI OÙ ON L'A VUE ÉCHOUER.
     */
    const { texte: calcule, corrections } = corrigerAdditions(texte)
    for (const c of corrections) {
        console.log(`ADDITION corrigée (documents) — ${c.termes.length} termes, écrit ${c.ecrit}, exact ${c.exact}`)
    }
    const propre = desarmerLiensMorts(calcule.trim())

    /**
     * DEUX VIDES QUI NE SE RESSEMBLENT PAS, ET DONT LE PLUS UTILE JETAIT SES PREUVES.
     *
     * `sousLePlancher` veut dire « la recherche n'a rien rapporté ». Ici, elle a rapporté :
     * les passages ont passé le plancher, et c'est le MODÈLE qui juge qu'ils ne répondent
     * pas. Les documents parlent du bon sujet, la question précise n'y est pas.
     */
    const vide = /^ce n['’]est pas écrit\.?$/i.test(propre)
    if (vide) await consignerLacune(question, r.meilleurScore, utilisateur)

    return {
        trouve: !vide,
        issue: vide ? 'insuffisant' : 'reponse',
        texte: propre,
        citations: indexables.map(citer),
        autoritesEnPresence: p.autorites,
        prime: p.prime,
        nonIndexables,
        mode: r.mode,
        origine: origineRedigee,
    }
}

/**
 * LE PONT DONNÉES → PROCÉDURE.
 *
 * « On a eu un P1 ? » rendait l'incident, ses machines, sa gravité — et s'arrêtait là.
 * L'incident est de type `malware`, et la conduite à tenir existe : INC-04. Personne ne
 * faisait le pont, alors que c'est la question que le demandeur pose réellement — pas
 * « y a-t-il une ligne dans un registre », mais « qu'est-ce qu'on fait ».
 */
export function extraireTypesIncidents(corps: unknown, profondeurMax = 6): string[] {
    const connus = new Set<string>(SNIFF_TYPE)
    const vus = new Set<string>()
    const marques = new WeakSet<object>()
    const parcourir = (n: unknown, prof: number) => {
        if (prof > profondeurMax || n === null || typeof n !== 'object') return
        if (marques.has(n as object)) return
        marques.add(n as object)
        if (Array.isArray(n)) { for (const x of n) parcourir(x, prof + 1); return }
        for (const [cle, v] of Object.entries(n as Record<string, unknown>)) {
            if (cle === 'type' && typeof v === 'string' && connus.has(v)) vus.add(v)
            else parcourir(v, prof + 1)
        }
    }
    parcourir(corps, 0)
    return [...vus]
}

/**
 * Les sections de conduite des fiches qui DÉCLARENT ces types ou ces domaines.
 *
 * Deux voies vers une fiche, et une préséance entre elles. `type_incident` désigne un
 * incident précis — la voie la plus forte. `domaine_catalogue` couvre les questions d'état :
 * « quels certificats expirent » attache la procédure de renouvellement si une fiche déclare
 * le domaine `certificats`. À plafond partagé, les fiches de type passent d'abord : un
 * incident nommé est plus précis qu'un domaine.
 */
/**
 * AUCUN ACCENT GRAVE DANS CETTE REQUÊTE — c'est un délimiteur, pas un signe de ponctuation.
 *
 * Le commentaire SQL écrit ici disait, en citant l'opérateur entre accents graves, que les
 * deux côtés de l'appariement sont des listes. L'accent grave a REFERMÉ le gabarit : la
 * requête s'arrêtait au commentaire, l'opérateur de recouvrement devenait un ET logique de
 * JavaScript, et la suite — la vraie condition, avec les valeurs interpolées en clair — se
 * lisait comme une simple chaîne. `db.execute` recevait du texte au lieu d'une requête
 * préparée, et toute question de données portant une déclaration de pont échouait.
 */
export async function fichesDeConduite(types: string[], domaines: string[], plafondFiches: number): Promise<PassageTrouve[]> {
    if ((!types.length && !domaines.length) || plafondFiches <= 0) return []
    const r = await db.execute(sql`
        SELECT p.id AS "passageId", d.id AS "documentId", p.ordre, p.texte,
               p.titre_section AS "titreSection", p.ancre, d.reference, d.titre,
               d.statut, d.type_doc AS "typeDoc", d.chemin, d.version,
               d.date_revision AS "dateRevision",
               d.url, d.extraction, d.mention, src.nom AS "sourceNom", src.autorite, src.categorie,
               (d.types_incident && string_to_array(${types.join(',')}, ',')) AS "parType"
        FROM passage p
        JOIN document d ON d.id = p.document_id
        JOIN source src ON src.id = d.source_id
        WHERE src.actif
          AND (d.statut IS NULL OR d.statut <> 'obsolete')
          -- Recouvrement, et non égalité : les deux côtés sont des listes. Un document
          -- déclare plusieurs domaines, une réponse porte plusieurs types, et l'égalité
          -- ne pouvait apparier ni l'un ni l'autre au-delà de sa première valeur.
          AND (d.types_incident && string_to_array(${types.join(',')}, ',')
               OR d.domaines_catalogue && string_to_array(${domaines.join(',')}, ','))
        ORDER BY d.reference, p.ordre
    `)
    const lignes = (r.rows as unknown as (Omit<PassageTrouve, 'score' | 'scoreLexical' | 'scoreSemantique'> & { parType: boolean })[])
        .map(({ parType, ...l }) => ({ ...l, score: 0, scoreLexical: 0, scoreSemantique: 0, parType }))

    const parFiche = new Map<string, (PassageTrouve & { parType?: boolean })[]>()
    for (const l of lignes) parFiche.set(l.documentId, [...(parFiche.get(l.documentId) ?? []), l].slice(0, 6))
    return [...parFiche.values()]
        .sort((x, y) => Number(y[0]!.parType ?? false) - Number(x[0]!.parType ?? false))
        .slice(0, plafondFiches)
        .flat()
        .map(({ parType: _, ...l }) => l)
}

/**
 * Réponse fondée sur une source vivante.
 *
 * Une erreur d'appel n'est PAS une absence de résultat, et la différence est tout le sujet :
 * « le connecteur n'a pas répondu » et « il n'y a rien » produisent la même liste vide, et
 * seule la première est une panne. On la dit franchement plutôt que de laisser le modèle
 * conclure au calme.
 */
async function reponseDonnees(
    cfg: ConfigIA, question_: string, appel: Appel, utilisateur: string | null,
    surEtape?: SurEtape,
): Promise<Omit<Reponse, 'resume'>> {
    const origine: Origine = {
        modele: cfg.modele,
        // L'empreinte couvre la requête ET les exigences de rédaction de cette question —
        // détails minimums, rattachements, ce qu'on tait. Elle ne portait que la requête :
        // changer ce qu'une réponse doit contenir ne se voyait donc nulle part, et nous
        // avons passé un tour à ne pas pouvoir dire si un correctif était déployé. Même
        // défaut que côté documents, corrigé une heure plus tôt.
        /**
         * L'EMPREINTE DOIT COUVRIR TOUT CE QUI FORME LA RÉPONSE — les mises en garde comprises.
         *
         * Les mentions dépendent de la charge utile, donc l'empreinte devient propre à la
         * réponse et non plus à la question. C'est le prix, et il est juste : la règle 7
         * promet qu'un lecteur puisse savoir CE QUI a produit CE texte-là. Deux réponses aux
         * consignes différentes ne doivent pas partager une empreinte.
         */
        consigne: empreinte(await promptSysteme(cfg),
            `${appel.requete}\n${detailsAttendus(appel)}\n${appel.mentions.join('\n')}`),
        date: new Date().toISOString(),
    }

    if (appel.erreur) {
        // AUCUNE LACUNE N'EST VERSÉE ICI, et c'est délibéré. Une source qui n'a pas répondu
        // ne dit rien sur ce qui est écrit ou non : verser la question au journal des
        // lacunes y ferait entrer des pannes, et la file de rédaction documentaire se
        // remplirait de questions auxquelles la documentation répond déjà.
        return {
            trouve: false, issue: 'echec_source',
            texte: appel.erreur,
            citations: [], autoritesEnPresence: [], nonIndexables: [],
            donnees: { requete: appel.requete, corps: null, mentions: appel.mentions, erreur: appel.erreur },
            mode: 'lexical', origine,
        }
    }

    // Les domaines viennent de la QUESTION déclarée, pas de la réponse : c'est le même
    // rattachement qui confronte déjà chaque réponse aux angles morts de /api/lacunes.
    const types = extraireTypesIncidents(appel.corps)
    const conduite = await fichesDeConduite(
        types,
        question(appel.cle)?.domaines ?? [],
        await lireNombre('recherche.conduite'),
    )

    /**
     * PAS DE DÉCLARATION, PAS DE PONT — ET LA RÉPONSE LE DIT.
     *
     * C'est écrit au § 7 du protocole d'essai depuis qu'on l'a rédigé, et ce n'était pas
     * implémenté : sans fiche, le volet de conduite était simplement absent, et la réponse
     * se terminait sur les faits comme si aucune procédure n'avait été cherchée. Une
     * affirmation de documentation que le code ne tient pas — la troisième de la semaine,
     * après « le résultat brut est affiché » et « on passe toujours pageSize ».
     */
    const sansConduite = types.length && !conduite.length
        ? [`Aucune fiche du corpus ne déclare de conduite pour le type d'incident rencontré `
           + `(${types.join(', ')}). Le dire : la conduite à tenir n'est pas absente parce qu'elle n'existe pas, `
           + `elle est absente parce qu'aucune fiche ne s'est déclarée sur ce type. Ne jamais la suppléer.`]
        : []

    const avecMentions: Appel = { ...appel, mentions: [...appel.mentions, ...sansConduite] }
    surEtape?.({ etape: 'redaction', conduite: new Set(conduite.map(c => c.documentId)).size })
    const texte = await redigerDonnees(cfg, question_, avecMentions, conduite)

    /**
     * L'ADDITION EST RENDUE AU CODE, ET RIEN D'AUTRE.
     *
     * Le correctif ne décide de rien : il ne choisit pas les termes, ne fabrique aucune
     * somme, n'ajoute pas de total là où il n'y en a pas. Il relit une addition écrite par
     * le modèle et corrige son résultat.
     */
    const { texte: calcule, corrections } = corrigerAdditions(texte)
    for (const c of corrections) {
        console.log(`ADDITION corrigée — ${c.termes.length} termes, écrit ${c.ecrit}, exact ${c.exact}`)
    }

    return {
        trouve: true, issue: 'reponse',
        texte: desarmerLiensMorts(calcule.trim()),
        // Les sections de conduite sont CITÉES comme sur le chemin documentaire : le
        // lecteur clique vers la fiche, voit son statut et sa date. Une prescription sans
        // source serait pire ici que nulle part — elle accompagne un incident réel.
        citations: conduite.map(citer),
        autoritesEnPresence: [], nonIndexables: [],
        donnees: { requete: appel.requete, corps: appel.corps, mentions: avecMentions.mentions },
        mode: 'lexical', origine,
    }
}

/**
 * Mentions obligatoires des sources citées.
 *
 * Injectées dans la consigne ET renvoyées avec chaque citation : la première fait que le
 * modèle les écrit dans sa réponse, la seconde fait que l'interface peut les afficher même
 * s'il les a oubliées. Une seule des deux voies ne suffirait pas — le modèle peut omettre,
 * et l'interface ne sait pas rédiger.
 */
function consigneMentions(passages: PassageTrouve[]): string {
    const mentions = [...new Set(passages.map(p => p.mention).filter((m): m is string => !!m))]

    /**
     * UN BROUILLON CITÉ DOIT SE DIRE BROUILLON.
     *
     * Le corpus n'exclut de la recherche que le statut `obsolete` : un document en
     * `brouillon` est indexé, remonte, et concourt au rang de sa catégorie — une annexe en
     * brouillon parle donc avec l'autorité d'une procédure. C'est voulu : une fiche utile
     * n'attend pas sa validation pour servir. Mais rien ne le disait dans la réponse — le
     * statut figurait dans les citations, pas dans le texte, et personne ne lit les
     * citations sous pression.
     */
    const brouillons = [...new Set(passages
        .filter(p => p.statut === 'brouillon' || p.statut === 'en_revision')
        .map(p => p.reference ?? p.titre))]
    if (brouillons.length) {
        /**
         * LA RÉSERVE SE DIT, L'INSTRUCTION NE SE DIT PAS — et les deux étaient dans la même
         * phrase. « … et cette réserve doit accompagner ce que tu en cites » s'est retrouvé
         * imprimé tel quel en bas d'une réponse, avec son « tu ». Le lecteur a reçu l'ordre
         * qu'on donnait au rédacteur.
         *
         * La mention ne porte plus que le fait. Où le placer est dit une fois pour toutes
         * juste en dessous, hors de la mention elle-même.
         */
        mentions.push(`${brouillons.join(', ')} ${brouillons.length > 1 ? 'sont des documents' : 'est un document'} `
            + `EN BROUILLON, non encore validé${brouillons.length > 1 ? 's' : ''} par la cellule : le contenu `
            + `s'applique, mais il peut changer.`)
    }

    if (!mentions.length) return ''
    return `\n\nRÉSERVES SUR CES DOCUMENTS — chacune se place à côté de ce qu'elle concerne, dans tes mots. `
        + `N'écris ni section ni note de bas de réponse : une réserve détachée de ce qu'elle qualifie est perdue.\n`
        + mentions.map(m => `- ${m}`).join('\n')
}

/**
 * Consigne de préséance, ajoutée seulement quand des rangs différents sont en présence.
 *
 * Écrite par le code et non laissée à l'appréciation du modèle : l'ordre vient du corpus,
 * pas d'un jugement. Un modèle à qui l'on demanderait de décider quelle source prime
 * répondrait parfois bien et parfois non, sans qu'on puisse dire pourquoi.
 */
/**
 * Signale au modèle qu'une procédure lui est donnée ENTIÈRE et DANS L'ORDRE.
 *
 * Calculée à partir de ce qui a été trouvé, comme la préséance — donc pas dans les réglages :
 * une consigne réécrite ne doit pas pouvoir défaire une propriété de ce qui est fourni.
 */
function consigneFiche(passages: PassageTrouve[]): string {
    const parDoc = new Map<string, PassageTrouve[]>()
    for (const x of passages) parDoc.set(x.documentId, [...(parDoc.get(x.documentId) ?? []), x])
    const fiche = [...parDoc.values()].find(l => l.length >= 3)
    if (!fiche) return ''

    const nom = fiche[0]!.reference ? `${fiche[0]!.titre} (${fiche[0]!.reference})` : fiche[0]!.titre
    // « N'en saute aucune » était écrit pour une question d'ENSEMBLE — « que faire en cas
    // de malware » — et produisait, sur une question d'ÉTAPE, la récitation des huit
    // sections là où une seule répondait. Constaté sur « comment confiner » : détection,
    // communication, éradication et rapport dans la réponse, pour une question qui
    // s'arrêtait au confinement. La consigne distingue donc les deux — c'est au modèle de
    // lire ce que la question vise, mais les deux issues sont décrites, pas une seule.
    return `\n\nCONSIGNE DE PROCÉDURE : ${fiche.length} sections de « ${nom} » te sont fournies,`
        + ` DANS L'ORDRE DE LA FICHE. Elles forment une suite : « confiner » vient avant`
        + ` « éradiquer », et l'ordre n'est pas une présentation, c'est la procédure.`
        + ` Si la question porte sur la CONDUITE ENTIÈRE, restitue les étapes dans cet ordre`
        + ` sans en sauter — les sections qui décrivent une action nomment rarement le sujet,`
        + ` ce sont pourtant elles qui répondent. Si la question vise UNE ÉTAPE, développe`
        + ` cette étape-là, et situe-la en une phrase : ce qui doit être fait avant, ce qui`
        + ` suit. Réciter la fiche entière sur une question d'étape noie la réponse.`
}

/**
 * LE QUOI ET LE COMMENT, QUAND LES DEUX SONT LÀ.
 *
 * Le corpus est construit en deux étages : les fiches d'incident disent QUOI faire et dans
 * quel ordre, les annexes et fiches outils disent COMMENT, avec les commandes par système.
 * Quand la recherche rapporte les deux, le modèle tendait à ne restituer que la procédure —
 * les étapes, sans les gestes — parce que c'est elle qui répond le plus directement à la
 * question posée.
 */
function consigneVolets(passages: PassageTrouve[]): string {
    const types = new Set(passages.map(x => x.typeDoc).filter(Boolean))
    const procedure = types.has('fiche-incident') || types.has('quotidien')
    const gestes = types.has('annexe') || types.has('fiche-outil')
    if (!procedure || !gestes) return ''

    return `\n\nSTRUCTURE EN DEUX VOLETS : les blocs fournis contiennent une procédure ET des gestes`
        + ` techniques. Commence par L'ESSENTIEL — les étapes de la procédure, dans l'ordre. Poursuis`
        + ` par LE COMMENT — les commandes et outils exacts tirés des annexes et fiches outils, par`
        + ` système, cités tels quels et jamais reconstitués de mémoire. Chaque volet cite ses sources.`
        + ` Si un geste de la procédure n'a pas sa commande dans les blocs fournis, dis-le plutôt que`
        + ` de la compléter toi-même.`
        // NE PAS RECOPIER LE RENVOI À LA PLACE DE SON CONTENU.
        //
        // Une checklist écrit ces renvois pour un lecteur humain qui ouvrira le document.
        // L'assistant, lui, a déjà la cible sous les yeux : la recopier revient à renvoyer
        // quelqu'un vers une page qu'on tient ouverte devant lui.
        // Premier jet : « ne recopie jamais un renvoi à la place de son contenu ». Sans
        // effet, et l'échec apprend quelque chose — le modèle ne recopiait pas UNE PHRASE,
        // il restituait fidèlement un PASSAGE entier de checklist qui en contient une.
        // Un interdit ne lui disait pas quoi faire du renvoi rencontré en chemin. La règle
        // est donc réécrite en geste : ouvrir, puis substituer.
        + `\nUN PASSAGE QUE TU CITES PEUT RENVOYER AILLEURS POUR LA COMMANDE — « … dont OUT-05 §2 porte`
        + ` la commande exacte ». Quand la cible de ce renvoi fait partie des blocs fournis, REMPLACE la`
        + ` phrase de renvoi par la commande qu'elle annonce, citée depuis sa propre section. Ces renvois`
        + ` sont écrits pour un lecteur qui ouvrira le document ; tu l'as déjà ouvert. Ne restitue le`
        + ` renvoi tel quel que si sa cible MANQUE aux blocs, et dis alors qu'elle manque.`
        // LE SYSTÈME DE LA QUESTION FILTRE LES GESTES.
        + `\nSI LA QUESTION NOMME UN SYSTÈME, ne restitue que les gestes de CE système. Les autres existent`
        + ` et se disent en une ligne — « les commandes Windows et macOS figurent dans la même section » —`
        + ` jamais recopiés en entier à côté de celui qui s'applique.`
        // UNE PROCÉDURE NE NOMME PAS UNE MACHINE, ET CE N'EST PAS UN MANQUE.
        + `\nUNE PROCÉDURE NE NOMME JAMAIS une machine ni un incident précis, et ce n'est pas un manque :`
        + ` ne le signale pas. La question porte un identifiant pour situer le cas, pas pour être cherché`
        + ` dans les fiches.`
}

/**
 * L'AIGUILLAGE, QUAND UN BLOC ORIENTE — calculé, jamais permanent.
 *
 * Le § 0 d'INC-01 dit désormais « un signalement n'est pas une compromission… cette fiche
 * ne se déroule pas » et renvoie au triage. Le modèle lisait la fiche la plus autoritaire
 * se récuser, et rendait « ce n'est pas écrit » — alors que la récusation est la PREMIÈRE
 * MOITIÉ de la réponse, et que la suite (les gestes du triage) était fournie deux blocs
 * plus loin.
 */
function consigneAiguillage(passages: PassageTrouve[]): string {
    const oriente = passages.some(x => x.reference === 'INC-00'
        || /^0\./.test(x.titreSection ?? '')
        || /déclencheurs|triage/i.test(x.titreSection ?? ''))
    if (!oriente) return ''

    return `\n\nAIGUILLAGE : les blocs contiennent une section de déclencheurs ou de triage. Si elle`
        + ` distingue plusieurs situations selon un fait que la question ne tranche pas, ta réponse`
        + ` COMMENCE par cette distinction, chaque branche citée. Un bloc qui dit qu'une situation`
        + ` « ne se traite pas ici » et renvoie ailleurs n'est PAS une absence de réponse : c'est la`
        + ` première moitié de la réponse. Restitue l'orientation, puis la conduite du bloc visé`
        + ` quand il est fourni — cherche-la aussi dans les sous-titres des blocs, pas seulement`
        + ` dans leurs titres.`
}

function consignePreseance(p: ReturnType<typeof preseance>): string {
    if (!p.prime) return ''
    const LIBELLE: Record<string, string> = {
        juridique: 'un texte réglementaire',
        procedure: 'une procédure de la cellule',
        exploitation: "la documentation d'exploitation de nos outils",
        equipe: "une note d'équipe",
        produit: "la documentation de l'éditeur du produit",
        bonne_pratique: 'un guide de bonnes pratiques',
    }
    const tete = LIBELLE[p.prime.categorie] ?? p.prime.categorie
    const suite = p.prime.sur.map(c => LIBELLE[c] ?? c).join(', ')
    return `\n\nCONSIGNE DE PRÉSÉANCE : les blocs fournis mêlent ${tete} et ${suite}.`
        + ` En cas de divergence, ${tete} l'emporte — dis-le explicitement, cite les deux,`
        + ` et signale que l'autre document est à corriger. Cette règle est écrite par la cellule, pas déduite par toi.`
}

/**
 * Consigne une question restée sans réponse.
 *
 * On garde la QUESTION et les sources fouillées, jamais autre chose. Les sources fouillées
 * disent si le trou est documentaire — rien n'est écrit — ou d'index : la source qui aurait
 * la réponse n'était pas active.
 */
async function consignerLacune(question: string, meilleurScore: number, utilisateur: string | null) {
    await db.insert(indexSchema.lacune).values({
        question: question.slice(0, 2000),
        sourcesConsultees: await sourcesConsultees(),
        meilleurScore: meilleurScore.toFixed(4),
        utilisateur,
    })
}
