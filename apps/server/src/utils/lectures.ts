// LES LECTURES FAUSSES, LUES CHEZ CELUI QUI SAIT.
//
// `GET /api/lectures` rend, pour chaque couple (champ, valeur), ce que la valeur signifie,
// ce qu'elle NE signifie PAS, la conséquence sur une réponse qui s'y appuierait, et où la
// donnée se répare.

import { db } from "@assistants/database";
import { indexSchema } from "@assistants/database/tables";
import { eq, and } from "drizzle-orm";
import { dechiffrer } from "./secrets";

export type Lecture = {
    /** Identifiant stable de la mise en garde, chez la source qui la publie. */
    cle: string
    champ: string
    /** La valeur concernée, telle que la source l'écrit. `null` est rendu par la chaîne "null". */
    valeur: unknown
    signifie: string
    neSignifiePas: string
    consequence: string
    ouCorriger: string | null
    /** Ajouté par nous : de qui vient cette lecture. Jamais rendu par la source. */
    origine?: string
}

/**
 * LES VOCABULAIRES FERMÉS, ET LE CONTRÔLE DE FRAÎCHEUR QU'ILS AUTORISENT.
 *
 * Ils portent une garantie plus forte que les lectures : chaque valeur est liée à sa lecture
 * par le compilateur — vérifié en ajoutant réellement une valeur et en constatant l'échec,
 * pas supposé. D'où la règle que le Catalogue énonce maintenant dans la charge utile, sous
 * `garantie.vocabulairesFermes.controleDeFraicheur` :
 */
/**
 * LE RECENSEMENT DES CHAMPS CALCULÉS — publié en charge utile, donc CONSOMMÉ.
 *
 * Ce que ces entrées disent n'est pas ce qu'une valeur SIGNIFIE — c'est ce qu'on n'a pas
 * le droit d'en FAIRE. Un champ posé après la pagination se lit, mais ne se filtre ni ne
 * se compte : le dénombrer sur une page donne un nombre qui a toutes les apparences d'une
 * mesure et n'en est pas.
 */
export type ChampCalcule = {
    champs: string[]
    porte?: string
    calcule?: string
    filtrable?: false | string
    compte?: false | string
    piege?: string
    origine?: string
}

export type Vocabulaire = {
    cle: string
    champ: string
    /** Le contrôle de fraîcheur ne vaut que sur `true`. Voir le commentaire ci-dessus. */
    applicable: boolean
    valeurs?: { valeur: string, signifie?: string }[] | string[]
    /** `applicable: false` — où le même nom est repris, et à quoi le distinguer. */
    ailleurs?: string
    discriminer?: string
    /** Autres contenants portant les mêmes valeurs : `domainesConnus[]`, `domainesExamines[]`… */
    aussi?: string[]
    origine?: string
}

/**
 * `vocabulairesFermes` a d'abord été un booléen, puis un objet portant l'énoncé du contrôle.
 * On accepte les deux : Sniff rend encore la première forme, et refuser la garantie pour un
 * changement de forme la ferait disparaître sans que personne s'en aperçoive.
 */
export type Garantie = {
    vocabulairesFermes: boolean | { exhaustif?: boolean, controleDeFraicheur?: string }
    champsAmbigus: boolean | { exhaustif?: boolean }
}

/** Ramène les deux formes de garantie à la question qui nous intéresse. */
export function exhaustif(v: Garantie['champsAmbigus']): boolean {
    return typeof v === 'boolean' ? v : v?.exhaustif !== false
}

/**
 * UNE PARTITION DÉCLARÉE — le lien que l'inférence ne pouvait pas trouver.
 *
 * Notre premier contrôle appariait un bloc de compteurs à un vocabulaire par RECOUVREMENT
 * de ses clés. Il ne pouvait donc rien faire de `machinesDepassees` : le nom du compteur ne
 * ressemble pas à la valeur qu'il compte. Le Catalogue publie l'`alias`, et l'inférence
 * cède la place à la déclaration.
 */
export type Partition = {
    route: string
    chemin: string
    vocabulaire: string
    cles: string[]
    /** Nom du compteur → valeur du vocabulaire qu'il dénombre. */
    alias?: Record<string, string>
    /** Compteur des valeurs nulles, ou `null` s'il n'y a pas de nul possible. */
    nul?: string | null
    /**
     * CE QUE COMPTENT LES VALEURS — que le vocabulaire ne dit pas.
     *
     * Le vocabulaire dit ce que valent les CLÉS. Cinq partitions de `technologie.eolStatut`
     * coexistent chez le Catalogue et comptent des choses différentes : des machines, des
     * systèmes distincts, des technologies du référentiel. Sans cette note, deux décomptes
     * du même vocabulaire se lisent comme interchangeables, et l'un répond à côté.
     */
    note?: string
    /**
     * UN CROISEMENT : ses valeurs sont des OBJETS, pas des nombres.
     *
     * `machinesParFamilleEtStatut` répond à la question réelle — « combien de Windows 10
     * dépassés » — en croisant deux vocabulaires. Le Catalogue l'a signalé avec le champ
     * lui-même, et pour une raison qu'il faut retenir : un contrôle de complétude qui
     * sommerait ces valeurs additionnerait des objets « sans erreur ni signal ». En
     * JavaScript, `{} + {}` ne lève rien.
     */
    sousPartition?: string
    /**
     * CE QUE LA PARTITION COMPTE, SOUS FORME COMPARABLE.
     *
     * Notre suggestion d'une `note` en prose etait bonne et insuffisante : une phrase libre
     * ne se compare pas. Deux partitions dont les notes disaient toutes deux « MACHINES »
     * rendaient 612 et 581 — et rien ne permettait de trancher entre une regression et deux
     * questions distinctes. C'etait precisement la situation ou nous nous trouvions.
     */
    population?: string
}

/**
 * UN FILTRE PUBLIÉ — dérivé d'une colonne, donc exhaustif par construction.
 *
 * Le Catalogue publie 649 filtres sur 48 catalogues, et la garantie est d'une autre nature
 * que celle des partitions : `critereDe` accepte exactement les colonnes de la table, donc
 * la liste des filtres EST la liste des colonnes. Elle ne peut pas être incomplète.
 */
export type Filtre = {
    champ: string
    nature: 'vocabulaire' | 'referentiel' | 'booleen' | 'nombre' | 'texte' | 'date'
    valeurs?: string[]
    axe?: string
}

export type FiltresCatalogue = {
    catalogue: string
    prefix?: string
    filtres: Filtre[]
    /** Ce que la source dit du croisement, et ce qu'elle interdit. Publié, donc relayé. */
    commentCroiser?: string
    neJamaisFaire?: string
}

/**
 * CE QUI MÉRITE D'ÊTRE MONTRÉ AU MODÈLE — pas tout, et pas au hasard.
 *
 * Écarter ne veut pas dire refuser : un filtre de texte reste ACCEPTÉ s'il est demandé, il
 * n'est simplement pas proposé. La distinction compte — nous ne retirons pas une capacité,
 * nous cessons d'y pousser.
 */
export function filtresMontrables(filtres: Filtre[]): Filtre[] {
    return filtres.filter(f => f.nature !== 'texte')
}

export type Catalogue = {
    lectures: Lecture[]
    vocabulaires: Vocabulaire[]
    champsCalcules: ChampCalcule[]
    partitions: Partition[]
    filtres: FiltresCatalogue[]
    garantie: Garantie | null
    erreur: string | null
}

/**
 * Une fois par session, pas une fois par question.
 *
 * Ce catalogue change au rythme des déploiements de la source, pas des questions. Le
 * relire à chaque appel doublerait le trafic pour une information stable — et le cache est
 * vidé au redémarrage, ce qui suit exactement le rythme d'un déploiement.
 */
const cache = new Map<string, Catalogue>()

const VIDE: Catalogue = { lectures: [], vocabulaires: [], champsCalcules: [], partitions: [], filtres: [], garantie: null, erreur: null }

export async function lecturesDe(type: string): Promise<Catalogue> {
    const vu = cache.get(type)
    if (vu) return vu

    const [src] = await db.select().from(indexSchema.source)
        .where(and(eq(indexSchema.source.type, type), eq(indexSchema.source.actif, true)))
    if (!src) return VIDE

    const cfg = (src.config ?? {}) as Record<string, unknown>
    const base = String(cfg.base ?? '').replace(/\/+$/, '')
    const jeton = dechiffrer(src.jetonChiffre)
    if (!base || !jeton) return VIDE

    let resultat: Catalogue
    try {
        const r = await fetch(`${base}/api/lectures`, {
            headers: { 'x-service-key': jeton, Authorization: `Bearer ${jeton}` },
            signal: AbortSignal.timeout(15_000),
        })
        if (r.status === 404) {
            // Une source qui n'a pas encore livré la route. Ce n'est pas une panne : nos
            // règles locales prennent le relais, et l'origine des mentions le dira.
            resultat = { ...VIDE, erreur: null }
        }
        else if (!r.ok) {
            resultat = { ...VIDE, erreur: `${type} /api/lectures → ${r.status}` }
        }
        else {
            const j = await r.json() as {
                lectures?: Lecture[]
                // Un tableau depuis leur dernier correctif ; l'ancienne forme indexée est
                // encore acceptée, pour qu'un déploiement en retard ne perde pas le bloc.
                vocabulaires?: Vocabulaire[] | Record<string, unknown>
                champsCalcules?: ChampCalcule[]
                partitions?: Partition[]
                filtres?: unknown
                garantie?: Garantie
            }
            resultat = {
                lectures: (j.lectures ?? []).map(l => ({ ...l, origine: type })),
                vocabulaires: normaliserVocabulaires(j.vocabulaires, type),
                champsCalcules: (j.champsCalcules ?? []).filter(c => Array.isArray(c?.champs)),
                // Une partition sans chemin ni clés n'est pas vérifiable : on l'écarte
                // plutôt que d'en tirer un contrôle qui ne contrôle rien.
                partitions: (j.partitions ?? []).filter(p => typeof p?.chemin === 'string' && Array.isArray(p?.cles) && p.cles.length),
                // Un catalogue sans nom ou sans filtre ne sert à rien : on l'écarte plutôt
                // que d'en tirer une liste vide qu'on lirait comme « aucun filtre ».
                filtres: normaliserFiltres(j.filtres),
                garantie: j.garantie ?? null,
                erreur: null,
            }
        }
    }
    catch (e) {
        resultat = { ...VIDE, erreur: e instanceof Error ? e.message : String(e) }
    }

    cache.set(type, resultat)
    return resultat
}

/**
 * TOUTES les sources, pas seulement celle qu'on interroge.
 *
 * Une réponse du Catalogue relaie des données de Sniff — `/api/incidents/croisement` porte
 * `severity`, dont la lecture appartient à Sniff. N'appliquer que le catalogue de la source
 * appelée perdrait cette mise en garde exactement là où elle compte, et le manque serait
 * silencieux.
 */
export async function catalogueFusionne(types: string[]): Promise<Catalogue> {
    const cats = await Promise.all(types.map(lecturesDe))

    const parCle = new Map<string, Lecture>()
    const parCouple = new Map<string, Lecture>()
    for (const c of cats) {
        for (const l of c.lectures) {
            const couple = `${l.champ}\u0000${String(l.valeur)}`
            if (parCle.has(l.cle) || parCouple.has(couple)) continue
            parCle.set(l.cle, l)
            parCouple.set(couple, l)
        }
    }

    return {
        lectures: [...parCle.values()],
        vocabulaires: cats.flatMap(c => c.vocabulaires),
        // Les recensements s'additionnent sans dédoublonnage : deux sources qui déclarent
        // le même nom de champ ne parlent pas forcément du même champ — `source` et
        // `dernierStatut` l'ont déjà montré sur les vocabulaires.
        champsCalcules: cats.flatMap(c => c.champsCalcules),
        partitions: cats.flatMap(c => c.partitions),
        filtres: cats.flatMap(c => c.filtres),
        // La garantie la plus FAIBLE l'emporte : si une seule source ne garantit pas ses
        // champs ambigus, la réponse ne peut pas se donner pour couverte.
        garantie: cats.some(c => c.garantie)
            ? {
                vocabulairesFermes: cats.every(c => c.garantie?.vocabulairesFermes !== false),
                champsAmbigus: cats.every(c => c.garantie?.champsAmbigus !== false),
            }
            : null,
        erreur: cats.map(c => c.erreur).filter(Boolean).join(' · ') || null,
    }
}

/** Pour les essais et pour un rechargement à la demande. */
export function oublierLectures(): void { cache.clear() }

/**
 * Accepte les deux formes de `vocabulaires` — le tableau actuel, et l'ancien objet indexé.
 *
 * Une entrée sans `champ` est ÉCARTÉE plutôt que devinée depuis sa clé : c'est précisément
 * ce que le Catalogue vient de nous démontrer dangereux. Une entrée écartée ne fait rien ;
 * une entrée mal appariée crie à la péremption sur une réponse saine.
 */
function normaliserVocabulaires(v: unknown, origine: string): Vocabulaire[] {
    const liste: unknown[] = Array.isArray(v) ? v : Object.values(v ?? {})
    return liste
        .filter((x): x is Vocabulaire =>
            !!x && typeof x === 'object' && typeof (x as Vocabulaire).champ === 'string')
        .map(x => ({ ...x, origine }))
}

/** Les valeurs déclarées d'un vocabulaire, quelle que soit la forme employée. */
function valeursDe(v: Vocabulaire): Set<string> {
    return new Set((v.valeurs ?? []).map(x => typeof x === 'string' ? x : String(x?.valeur)))
}

/**
 * CONTRÔLE DE FRAÎCHEUR — appliqué au seul cas où il ne peut pas mentir.
 *
 * Trois refus délibérés, chacun protégeant d'un faux positif :
 */
export function fraicheur(vocabulaires: Vocabulaire[], corps: unknown, profondeurMax = 8): string[] {
    const applicables = vocabulaires.filter(v => v.applicable === true && (v.valeurs ?? []).length)
    if (!applicables.length) return []

    const parChamp = new Map<string, Vocabulaire[]>()
    for (const v of applicables) {
        for (const nom of [v.champ, ...(v.aussi ?? [])]) {
            parChamp.set(nom, [...(parChamp.get(nom) ?? []), v])
        }
    }

    const inconnues = new Map<Vocabulaire, Set<string>>()
    const vus = new WeakSet<object>()

    const verifier = (v: Vocabulaire, valeur: unknown) => {
        if (valeur === null || valeur === undefined) return
        if (typeof valeur === 'object') return
        const texte = String(valeur)
        if (valeursDe(v).has(texte)) return
        inconnues.set(v, (inconnues.get(v) ?? new Set()).add(texte))
    }

    const parcourir = (n: unknown, profondeur: number) => {
        if (profondeur > profondeurMax || n === null || typeof n !== 'object') return
        if (vus.has(n as object)) return
        vus.add(n as object)

        if (Array.isArray(n)) {
            for (const x of n) parcourir(x, profondeur + 1)
            return
        }
        for (const [cle, valeur] of Object.entries(n as Record<string, unknown>)) {
            for (const v of parChamp.get(cle) ?? []) {
                if (Array.isArray(valeur)) for (const x of valeur) verifier(v, x)
                else verifier(v, valeur)
            }
            parcourir(valeur, profondeur + 1)
        }
    }
    parcourir(corps, 0)

    return [...inconnues].map(([v, vals]) =>
        `CATALOGUE PÉRIMÉ : le champ \`${v.champ}\` porte ${[...vals].map(x => `« ${x} »`).join(', ')}, `
        + `valeur(s) absente(s) du vocabulaire fermé « ${v.cle} » publié par ${v.origine ?? 'la source'}. `
        + `Sur un vocabulaire fermé, une valeur inconnue n'existe pas : c'est notre catalogue de lectures `
        + `qui est antérieur au déploiement de la source. Les mises en garde de cette réponse peuvent être `
        + `incomplètes — redémarrer le serveur les recharge.`)
}

/**
 * Applique un catalogue de lectures à une réponse.
 *
 * Même parcours que la couche locale : on descend dans toute la structure, chaque règle ne
 * se déclenche qu'une fois, avec le nombre d'occurrences. Répéter trente fois la même phrase
 * noierait la réponse.
 */
export function appliquer(lectures: Lecture[], corps: unknown, profondeurMax = 8): string[] {
    if (!lectures.length) return []
    const comptes = new Map<Lecture, number>()
    const vus = new WeakSet<object>()

    const memeValeur = (attendue: unknown, vue: unknown) =>
        attendue === vue || String(attendue) === String(vue)

    const parcourir = (n: unknown, profondeur: number) => {
        if (profondeur > profondeurMax || n === null || typeof n !== 'object') return
        if (vus.has(n as object)) return
        vus.add(n as object)

        if (Array.isArray(n)) {
            for (const x of n) parcourir(x, profondeur + 1)
            return
        }
        for (const [cle, v] of Object.entries(n as Record<string, unknown>)) {
            for (const l of lectures) {
                if (l.champ === cle && memeValeur(l.valeur, v)) comptes.set(l, (comptes.get(l) ?? 0) + 1)
            }
            parcourir(v, profondeur + 1)
        }
    }
    parcourir(corps, 0)

    const phrase = (t: string) => `${t.trim().replace(/\.+$/, '')}.`
    return [...comptes].map(([l, n]) => {
        const bouts = [
            `\`${l.champ}: ${JSON.stringify(l.valeur)}\` — ${phrase(l.signifie)}`,
            `Ce n'est PAS ${phrase(l.neSignifiePas)}`,
            l.consequence ? phrase(l.consequence) : null,
            l.ouCorriger ? `Où corriger : ${phrase(l.ouCorriger)}` : null,
            n > 1 ? `(${n} occurrences)` : null,
        ].filter(Boolean)
        return bouts.join(' ')
    })
}

/**
 * Ce qu'on n'a pas le droit de FAIRE d'un champ présent dans une réponse.
 *
 * `appliquer` ci-dessus s'apparie sur un couple (champ, valeur) : il dit ce qu'une valeur
 * signifie. Cette couche-ci s'apparie sur la PRÉSENCE d'un champ, parce que le piège ne
 * dépend pas de sa valeur — `eolStatut` ne se compte pas sur une page, quelle que soit la
 * valeur lue, et `incidentOuvert` ne se filtre pas même quand il est faux.
 */
export function mentionsDeChampsCalcules(
    corps: unknown, champs: ChampCalcule[], cheminUtilise?: string, profondeurMax = 8,
): string[] {
    if (!champs.length) return []
    const vus = new Set<ChampCalcule>()
    const dejaParcourus = new WeakSet<object>()

    const parcourir = (n: unknown, profondeur: number) => {
        if (profondeur > profondeurMax || n === null || typeof n !== 'object') return
        if (dejaParcourus.has(n as object)) return
        dejaParcourus.add(n as object)
        if (Array.isArray(n)) {
            for (const x of n) parcourir(x, profondeur + 1)
            return
        }
        for (const [cle, v] of Object.entries(n as Record<string, unknown>)) {
            for (const c of champs) {
                // Une entrée qui ne dit RIEN — ni interdit, ni route, ni piège — n'a rien à
                // répercuter. Dès qu'elle dit quelque chose, on le dit : « voici où se
                // demande le décompte » vaut mieux que le silence, parce que c'est ce qui
                // remplace le comptage sur une page par la bonne requête.
                if (c.filtrable === undefined && c.compte === undefined && !c.piege) continue
                if (c.champs.includes(cle)) vus.add(c)
            }
            parcourir(v, profondeur + 1)
        }
    }
    parcourir(corps, 0)

    const phrase = (t: string) => `${t.trim().replace(/\.+$/, '')}.`

    /**
     * LA TUYAUTERIE NE SE NOMME PAS DANS UNE RÉPONSE — et ces entrées en sont pleines.
     *
     * La charge utile des champs calculés porte DEUX publics dans un même objet. `calcule`
     * (« en sql »), `filtrable` sous forme de recette (« ?eolStatut= — valeur hors
     * vocabulaire refusée en 422 ») et la route de décompte s'adressent au CLIENT : elles
     * nous disent comment construire la requête, et c'est ainsi qu'on a trouvé la bonne
     * route. `piege`, lui, s'adresse au LECTEUR de la réponse.
     */
    const memeRoute = (r: string) =>
        cheminUtilise !== undefined && r.trim().replace(/\.+$/, '') === cheminUtilise

    return [...vus].map((c) => {
        const noms = c.champs.map(x => `\`${x}\``).join(', ')
        const bouts = [
            // « en sql » ne change rien pour qui lit la réponse. « Calculé » si, un peu :
            // le champ n'est pas une saisie, donc il n'y a personne à envoyer le corriger.
            `${noms} : champ calculé, pas une saisie.`,
            c.filtrable === false ? "Il ne peut pas servir de CRITÈRE DE RECHERCHE." : null,
            // Le décompte est le piège le plus coûteux : compter sur une page rend un
            // nombre qui a toutes les apparences d'une mesure et n'en est pas.
            c.compte === false
                ? "Il ne se DÉNOMBRE PAS : citer les éléments vus, jamais un nombre."
                : typeof c.compte === 'string' && !memeRoute(c.compte)
                    ? `Le décompte se demande à ${phrase(c.compte)}`
                    : null,
            c.piege ? phrase(c.piege) : null,
        ].filter(Boolean)
        return bouts.join(' ')
    })
}

/**
 * PARTITIONS INCOMPLÈTES — un compteur par valeur du vocabulaire, ou l'aveu qu'il en manque.
 *
 * LE VOCABULAIRE EST LE JUGE, PAS UNE LISTE ÉCRITE ICI. Leur point de méthode est le nôtre,
 * commis trois fois cette semaine de part et d'autre : un contrôle qui épingle les valeurs
 * qu'il connaît rougit le jour où la source en ajoute une — c'est-à-dire pour une
 * amélioration. On part donc des vocabulaires publiés par `/api/lectures`, que nous
 * consommons déjà, et le contrôle suit leurs ajouts sans qu'on y touche.
 */
export function partitionsIncompletes(
    corps: unknown, vocabulaires: Vocabulaire[], profondeurMax = 8,
): { chemin: string, vocabulaire: string, manquantes: string[] }[] {
    const applicables = vocabulaires.filter(v => v.applicable !== false && (v.valeurs ?? []).length)
    if (!applicables.length) return []

    const trouves: { chemin: string, vocabulaire: string, manquantes: string[] }[] = []
    const vus = new WeakSet<object>()

    const parcourir = (n: unknown, chemin: string, profondeur: number) => {
        if (profondeur > profondeurMax || n === null || typeof n !== 'object') return
        if (vus.has(n as object)) return
        vus.add(n as object)
        if (Array.isArray(n)) {
            for (const x of n) parcourir(x, `${chemin}[]`, profondeur + 1)
            return
        }

        const entrees = Object.entries(n as Record<string, unknown>)
        // Un bloc de compteurs : au moins deux clés, et QUE des nombres. Un objet mixte
        // porte autre chose qu'une répartition, et n'a pas à en répondre.
        const estCompteurs = entrees.length >= 2 && entrees.every(([, v]) => typeof v === 'number')
        if (estCompteurs) {
            const cles = new Set(entrees.map(([k]) => k))
            let meilleur: { v: Vocabulaire, couvre: number } | null = null
            for (const v of applicables) {
                const valeurs = valeursDe(v)
                // Une clé étrangère disqualifie : ce bloc n'est pas une partition de ce
                // vocabulaire, et il ne faut surtout pas lui reprocher ce qu'il n'a pas.
                if ([...cles].some(k => !valeurs.has(k))) continue
                const couvre = [...cles].filter(k => valeurs.has(k)).length
                if (couvre >= 2 && (!meilleur || couvre > meilleur.couvre)) meilleur = { v, couvre }
            }
            if (meilleur) {
                const manquantes = [...valeursDe(meilleur.v)].filter(x => !cles.has(x))
                if (manquantes.length) {
                    trouves.push({ chemin: chemin || '(racine)', vocabulaire: meilleur.v.champ, manquantes })
                }
            }
        }

        for (const [cle, v] of entrees) parcourir(v, chemin ? `${chemin}.${cle}` : cle, profondeur + 1)
    }
    parcourir(corps, '', 0)
    return trouves
}

/**
 * VÉRIFIE UNE PARTITION DÉCLARÉE CONTRE LA CHARGE REÇUE.
 *
 * Trois verdicts, et le troisième est celui que le Catalogue nous a donné les moyens de
 * rendre pour toujours :
 */
export function partitionManquante(
    corps: unknown, p: Partition,
): { etat: 'absent' | 'nul' | 'incomplet', manquantes: string[], ou?: string } | null {
    let n: any = corps
    const parts = p.chemin.split('.')
    for (const [i, part] of parts.entries()) {
        if (n === null) return { etat: 'nul', manquantes: [], ou: parts.slice(0, i).join('.') || '(racine)' }
        /**
         * UN CONTRÔLE DOIT DÉSIGNER LE BON CHAMP, PAS SEULEMENT LE BON DÉFAUT.
         *
         * Premier passage réel : « `resume.parEolStatut` DÉCLARÉ mais ABSENT ». Vrai, et
         * trompeur — les DEUX partitions de cette route manquaient, ce qui accuse `resume`
         * lui-même bien plus que ses deux blocs. Un rapport envoyé au fournisseur l'aurait
         * lancé sur la mauvaise piste, et un rapport qui désigne le mauvais champ coûte plus
         * cher qu'un silence : il consomme le crédit qu'on aura besoin d'avoir la fois où
         * l'on vise juste.
         */
        if (typeof n !== 'object' || !(part in n)) {
            return { etat: 'absent', manquantes: [], ou: parts.slice(0, i).join('.') || '(racine)' }
        }
        n = n[part]
    }
    // Le chemin s'est résolu entièrement et le bloc vaut `null` : c'est une portée, et
    // `ou` désigne alors le bloc lui-même.
    if (n === null) return { etat: 'nul', manquantes: [], ou: p.chemin }
    if (typeof n !== 'object' || Array.isArray(n)) return { etat: 'absent', manquantes: [], ou: p.chemin }

    // `nul` fait partie de la partition quand il est nommé : sans son compteur, la somme
    // des parts ne fait pas le total.
    const attendues = [...p.cles, ...(p.nul ? [p.nul] : [])]
    const manquantes = attendues.filter(c => !(c in (n as Record<string, unknown>)))
    return manquantes.length ? { etat: 'incomplet', manquantes } : null
}

/**
 * LES NOTES DES PARTITIONS DÉCLARÉES, RELAYÉES TELLES QUELLES.
 *
 * Quand la source publie, c'est la sienne qui vaut — même règle que pour `avertissement` sur
 * la chaîne d'impact, et pour les couples (champ, valeur). La différence ici est qu'elle
 * arrive attachée à un EMPLACEMENT : on ne la dit que si le bloc figure réellement dans la
 * réponse, sinon on avertirait à propos d'un décompte que personne n'a sous les yeux.
 */
export function valeursDePartition(corps: unknown, p: Partition): Record<string, number> | null {
    let n: any = corps
    for (const part of p.chemin.split('.')) {
        if (!n || typeof n !== 'object' || !(part in n)) return null
        n = n[part]
    }
    if (!n || typeof n !== 'object') return null

    const out: Record<string, number> = {}
    for (const cle of p.cles) {
        const v = (n as Record<string, unknown>)[cle]
        if (typeof v !== 'number') continue
        out[p.alias?.[cle] ?? cle] = v
    }
    return out
}

export function mentionsDePartitions(
    corps: unknown, partitions: Partition[], chemin: string,
): string[] {
    const retenues = partitions
        .filter(p => p.route === chemin && p.note)
        .filter(p => partitionManquante(corps, p) === null)

    /**
     * UNE VUE REDONDANTE N'A RIEN À DIRE DE PLUS.
     *
     * Le Catalogue publie `resume` — les mêmes nombres que `resume.machinesParStatut`, sous
     * les noms historiques — et l'assume : « redondant à dessein, rompre ces noms casserait
     * les appelants en place ». C'est un bon choix d'API et une note faite pour NOUS.
     * Relayée telle quelle, elle expliquait à quelqu'un qui compte des machines pourquoi
     * deux champs portent les mêmes valeurs.
     */
    const vues = new Set<string>()
    const uniques = retenues.filter((p) => {
        const v = valeursDePartition(corps, p)
        if (!v) return true
        const signature = `${p.vocabulaire}|${JSON.stringify(Object.entries(v).sort())}`
        if (vues.has(signature)) return false
        vues.add(signature)
        return true
    })

    return uniques.map(p => `\`${p.chemin}\` — ${p.note!.trim().replace(/\.+$/, '')}.`)
}

/**
 * Les filtres publiés pour un catalogue, ou une liste vide.
 *
 * Vide se lit « nous ne savons pas », jamais « aucun filtre » : une source qui ne publie
 * pas son bloc `filtres` n'a pas dit qu'elle n'en avait aucun. La différence décide de ce
 * qu'on répond à l'utilisateur — « ce catalogue ne se filtre pas » serait faux.
 */
/**
 * DEUX FORMES POSSIBLES, ET SUPPOSER LA MAUVAISE A TOUT ÉTEINT.
 *
 * Les deux sont donc admises. Une forme inconnue rend une liste vide plutôt que de faire
 * tomber le reste : un bloc qu'on ne sait pas lire ne doit pas emporter ceux qu'on sait lire.
 */
export function normaliserFiltres(brut: unknown): FiltresCatalogue[] {
    const valide = (f: any): f is FiltresCatalogue => Array.isArray(f?.filtres)
    if (Array.isArray(brut)) {
        return brut.filter(f => typeof f?.catalogue === 'string' && valide(f))
    }
    if (brut && typeof brut === 'object') {
        return Object.entries(brut as Record<string, any>)
            .filter(([, f]) => valide(f))
            .map(([cle, f]) => ({ ...f, catalogue: typeof f.catalogue === 'string' ? f.catalogue : cle }))
    }
    return []
}

export function filtresDe(cat: Catalogue, catalogue: string): Filtre[] {
    return cat.filtres.find(f => f.catalogue === catalogue)?.filtres ?? []
}

/**
 * Un filtre demandé est-il ADMIS par le contrat publié ?
 *
 * Le champ doit être déclaré, et sur un vocabulaire la valeur doit en faire partie. C'est
 * plus strict qu'une liste écrite à la main, et ça suit la source sans qu'on y touche.
 */
export function filtreAdmis(filtres: Filtre[], champ: string, valeur: string): boolean {
    const f = filtres.find(x => x.champ === champ)
    if (!f) return false
    if (f.nature === 'vocabulaire') return (f.valeurs ?? []).includes(valeur)
    return valeur.length > 0
}
