// CHEMIN « DONNÉES » — interroger le Catalogue et Sniff au moment de la question.
//
// Rien n'est indexé ici. Un incident recopié dans un index est faux dès la minute suivante,
// et il a l'air aussi vrai que les autres.

import { db } from "@assistants/database";
import { indexSchema } from "@assistants/database/tables";
import { eq, and } from "drizzle-orm";
import { dechiffrer } from "./secrets";
import { question, mentionsDe, QUESTIONS, type Question } from "./questions";
import { valeurOuDefaut } from "@assistants/database/registre";
import { mentionsDeValeurs, nonCouvertes } from "./valeurs";
import { prescrire } from "./mentions";
import { appliquer, catalogueFusionne, exhaustif, fraicheur, mentionsDeChampsCalcules, mentionsDePartitions } from "./lectures";

/**
 * Lit une réponse en JSON, ou dit ce qu'elle contenait vraiment.
 *
 * `r.json()` sur une page HTML rend « Failed to parse JSON », qui n'apprend rien. Or c'est
 * le cas le plus fréquent quand une adresse est fausse : le proxy ne trouve pas la route,
 * retombe sur l'interface, et rend un 200 avec du HTML. Un message qui nomme le type reçu et
 * en montre le début transforme une énigme en diagnostic.
 */
export async function lireJson(r: Response, ou: string): Promise<{ ok: true, corps: unknown } | { ok: false, erreur: string }> {
    const type = r.headers.get('content-type') ?? '(non déclaré)'
    const texte = await r.text()

    if (!/json/i.test(type)) {
        const debut = texte.replace(/\s+/g, ' ').slice(0, 160)
        return {
            ok: false,
            erreur: /<(!doctype|html)/i.test(texte)
                ? `${ou} rend une PAGE HTML au lieu de JSON. L'adresse ne mène pas à l'API : le proxy n'a pas trouvé la route et a servi l'interface. Vérifiez l'adresse de base et le chemin. Reçu : « ${debut} »`
                : `${ou} rend « ${type} » au lieu de JSON. Reçu : « ${debut} »`,
        }
    }
    try { return { ok: true, corps: JSON.parse(texte) } }
    catch { return { ok: false, erreur: `${ou} annonce du JSON mais n'en rend pas. Reçu : « ${texte.slice(0, 160)} »` } }
}

export type Appel = {
    /** La question déclarée dont il vient — sert à retrouver ses exigences de rédaction. */
    cle: string
    /** La requête telle qu'exécutée, affichée à côté de la réponse. */
    requete: string
    corps: unknown
    /** Post-conditions déclenchées : ce que la réponse DOIT dire. */
    mentions: string[]
    /** Renseigné si la source n'a pas répondu. */
    erreur?: string
}

async function sourceActive(type: string) {
    const [s] = await db.select().from(indexSchema.source)
        .where(and(eq(indexSchema.source.type, type), eq(indexSchema.source.actif, true)))
    return s ?? null
}

/**
 * Vérifie la version de Sniff. TROIS ÉTATS, jamais un booléen.
 *
 * ON COMPARE DES DATES, PLUS DES EMPREINTES. `9d08b6c` et `02ba656` ne portent aucun ordre :
 * ce sont des empreintes, pas des numéros. On ne pouvait donc que signaler une différence,
 * et demander à l'exploitant de trancher à notre place — un avertissement vrai et inutile,
 * qui restait affiché.
 */
export async function verifierSniff(
    base: string, jeton: string, attendue: string, dateMinimale?: string,
): Promise<{ etat: 'verifie' | 'non_verifiable' | 'ancienne', version: string, mention: string | null }> {
    try {
        const r = await fetch(`${base}/health`, {
            headers: { 'x-service-key': jeton },
            signal: AbortSignal.timeout(10_000),
        })
        const j = await r.json() as { version?: string | null, construitLe?: string | null }
        const version = String(j.version ?? 'inconnue')

        // Le commit attendu, quand il correspond, tranche sans avoir besoin de la date.
        if (version !== 'inconnue' && version.startsWith(attendue)) {
            return { etat: 'verifie', version, mention: null }
        }

        const construitLe = j.construitLe ? new Date(j.construitLe) : null
        const seuil = dateMinimale ? new Date(dateMinimale) : null
        const lisible = construitLe && !Number.isNaN(construitLe.getTime())

        if (lisible && seuil && !Number.isNaN(seuil.getTime())) {
            return construitLe >= seuil
                ? { etat: 'verifie', version, mention: null }
                : {
                    etat: 'ancienne', version,
                    mention: `Sniff est en « ${version} », construite le ${construitLe.toLocaleDateString('fr-FR')}, `
                        + `antérieure au minimum requis (${seuil.toLocaleDateString('fr-FR')}). `
                        + `Conséquences connues sur les versions antérieures : la pagination des incidents n'est pas `
                        + `fiable, et le décompte peut ne pas compter ce que la liste montre.`,
                }
        }

        if (!lisible) {
            return {
                etat: 'non_verifiable', version,
                mention: "La version de Sniff n'est pas vérifiable : son image a été construite sans date. "
                    + "Ce n'est PAS l'indication d'une version ancienne.",
            }
        }

        // Date lisible mais aucun seuil configuré : on ne peut rien conclure, mais on peut
        // au moins dire ce qui tourne — ce qui suffit à un humain pour trancher, là où deux
        // abrégés de commit ne le permettaient pas.
        return {
            etat: 'non_verifiable', version,
            mention: `Sniff est en « ${version} », construite le ${construitLe!.toLocaleDateString('fr-FR')}. `
                + `Aucune date minimale n'est configurée sur cette source : renseignez « Date minimale » `
                + `dans ses réglages pour que ce contrôle se fasse tout seul.`,
        }
    }
    catch {
        return { etat: 'non_verifiable', version: 'injoignable', mention: null }
    }
}

/**
 * LES ANGLES MORTS SE CONSULTENT AVANT LA DONNÉE, PAS À LA DEMANDE.
 *
 * Le contrat appelle `/api/lacunes` « point d'entrée à consulter en premier ». Il était
 * pourtant déclaré chez nous comme une question parmi les autres : le modèle ne la
 * choisissait que si on l'interrogeait sur les angles morts. Une réponse sur la couverture
 * EDR pouvait donc sortir sans mentionner que le Catalogue est aveugle sur l'EDR — ce qui
 * est exactement l'erreur que ce point d'entrée existe pour empêcher.
 */
const CACHE_LACUNES_MS = 5 * 60_000
const cacheLacunes = new Map<string, { a: number, corps: any | null, erreur: string | null }>()

async function lireLacunes(base: string, jeton: string): Promise<{ corps: any | null, erreur: string | null }> {
    const vu = cacheLacunes.get(base)
    if (vu && Date.now() - vu.a < CACHE_LACUNES_MS) return { corps: vu.corps, erreur: vu.erreur }

    let resultat: { corps: any | null, erreur: string | null }
    try {
        const r = await fetch(`${base}/api/lacunes`, {
            headers: { 'x-service-key': jeton, Authorization: `Bearer ${jeton}` },
            signal: AbortSignal.timeout(15_000),
        })
        if (!r.ok) resultat = { corps: null, erreur: `/api/lacunes a répondu ${r.status}` }
        else {
            const lu = await lireJson(r, '/api/lacunes')
            resultat = lu.ok ? { corps: lu.corps, erreur: null } : { corps: null, erreur: lu.erreur }
        }
    }
    catch (e) {
        resultat = { corps: null, erreur: e instanceof Error ? e.message : String(e) }
    }
    cacheLacunes.set(base, { a: Date.now(), ...resultat })
    return resultat
}

/**
 * Ce qu'il faut dire d'une réponse, au vu des angles morts déclarés par le Catalogue.
 *
 * TROIS LISTES, TROIS QUESTIONS DIFFÉRENTES. Le Catalogue rend désormais les trois, et
 * c'est ce qui permet un avertissement net là où on devait énoncer deux causes possibles :
 */
export function lacunesApplicables(lacunes: any, domaines: string[]): string[] {
    if (!domaines.length) return []
    const lignes: any[] = lacunes?.resultats ?? lacunes?.lacunes ?? []
    const connus: string[] | null = Array.isArray(lacunes?.domainesConnus) ? lacunes.domainesConnus : null
    const examines: string[] | null = Array.isArray(lacunes?.domainesExamines) ? lacunes.domainesExamines : null
    const out: string[] = []

    for (const d of domaines) {
        // 1. L'étiquette n'existe pas. C'est NOTRE défaut, et il doit se voir comme tel :
        //    la question ne sera jamais confrontée à aucune lacune, et personne ne s'en
        //    apercevrait si on n'en disait rien.
        if (connus && !connus.includes(d)) {
            out.push(`DÉFAUT DE L'ASSISTANT : le domaine « ${d} » déclaré sur cette question n'existe pas `
                + `au Catalogue (domaines connus : ${connus.join(', ')}). Cette réponse n'a donc PAS été `
                + `confrontée aux angles morts de ce domaine. À corriger dans questions.ts.`)
            continue
        }

        const l = lignes.find(x => (x?.domaine ?? x?.cle) === d)
        if (l?.pourquoi) {
            /**
             * UNE FRACTION N'EXISTE QUE SI SON DÉNOMINATEUR EXISTE.
             *
             * Le défaut n'était pas que d'affichage. Sur cette lacune-là, `combien` vaut 3
             * parce que la donnée date de trois JOURS : ce n'est pas un numérateur, et le
             * `pourquoi` le dit déjà en toutes lettres. La parenthèse transformait une
             * ancienneté en proportion, et inventait un rapport que personne n'avait
             * calculé — plus grave qu'un « null » affiché.
             */
            const unite: string = typeof l.unite === 'string' ? l.unite
                // Sans `unite`, on est devant l'ancien contrat : un dénominateur utilisable
                // est la seule chose qui distingue encore un vrai décompte.
                : (Number.isFinite(l.sur) && l.sur > 0 ? 'fiches' : 'inconnue')
            const combien = unite === 'fiches' && Number.isFinite(l.combien) && Number.isFinite(l.sur) && l.sur > 0
                ? ` (${l.combien} sur ${l.sur})`
                : unite === 'jours' && typeof l.depuis === 'string' && l.depuis
                    ? ` (dernière collecte : ${l.depuis})`
                    : ''
            out.push(l.gravite === 'aveugle'
                ? `ANGLE MORT sur « ${d} »${combien} : ${l.pourquoi}`
                : `Information incomplète sur « ${d} »${combien} : ${l.pourquoi}`)
            continue
        }

        // 2. Connue mais non examinée : hors de la portée du compte. Plus d'ambiguïté.
        if (examines && !examines.includes(d)) {
            out.push(`Le domaine « ${d} », sur lequel cette réponse s'appuie, est HORS DE LA PORTÉE de la `
                + `clé de service : le Catalogue le connaît mais ne l'a pas examiné pour ce compte. `
                + `Cette réponse repose donc sur un référentiel dont personne n'a vérifié qu'il est rempli. `
                + `La clé doit porter le scope « read » et aucun scope « cat:… ».`)
        }
        // 3. Examinée, sans lacune : rien à dire.
    }

    if (examines === null) {
        out.push("Le Catalogue ne rend pas `domainesExamines` sur /api/lacunes : impossible de distinguer "
            + "un domaine sain d'un domaine jamais regardé. Il est antérieur au correctif du 27 août 2026.")
    }
    return out
}

/**
 * Place dans le CHEMIN les paramètres qui y vont, et retire-les de la requête.
 *
 * Le chemin déclaré porte ses trous : `/api/incidents/{id}/conduite`. C'était une chaîne de
 * `if` par point d'entrée, ce qui ne tenait plus à quatre et n'aurait pas tenu à dix.
 */
/**
 * LES FILTRES DEMANDÉS QUI NE SONT PAS PARTIS — et pourquoi cette fonction existe à part.
 *
 * Elle vivait dans `executer`, donc hors d'atteinte de tout essai : il aurait fallu une base
 * et un réseau pour l'exercer. Elle a rendu un faux positif en production dès sa première
 * nuit, et le faux positif a coûté une réponse.
 */
/**
 * UN FILTRE NON APPLIQUÉ N'EST PAS UNE RÉPONSE IMPOSSIBLE — et cette nuance a coûté deux
 * refus sur des données présentes.
 *
 * C'est exactement l'inverse du service rendu. Une RÉPARTITION par la valeur cherchée est
 * la réponse : elle porte chaque valeur séparément, et n'avoir pas filtré ne retire rien.
 * Le filtre aurait fait gagner une lecture, pas une information.
 */
export function mentionFiltreEcarte(ecartes: string[], corps: unknown): string {
    const c = corps as any
    const repartitions = [
        ...Object.keys(c?.ventilations ?? {}),
        ...Object.keys(c?.partitions ?? {}),
    ]
    return `FILTRE NON APPLIQUÉ : ${ecartes.join(' · ')}. Un \`total\` de cette réponse porte donc sur `
        + `l'ENSEMBLE, jamais sur la restriction demandée : ne présenter aucun total comme le décompte de `
        + `ce qui était demandé.`
        + (repartitions.length
            ? ` MAIS la réponse porte une RÉPARTITION (${repartitions.join(', ')}) : si la valeur cherchée y `
              + `figure, son décompte est là et il est exact. Le filtre aurait fait gagner une lecture, pas une `
              + `information — chercher la ligne avant de conclure à l'absence.`
            : ` Rien dans cette réponse ne porte la valeur cherchée séparément : le dire, et dire que le `
              + `décompte exact s'obtient en filtrant.`)
}

export function filtresEcartes(
    fournis: Record<string, unknown>, appliques: Set<string>,
    parametres: { cle: string, valeurs?: string[] }[],
): string[] {
    return Object.keys(fournis)
        .filter(c => !appliques.has(c) && enTexte(fournis[c]))
        .map((c) => {
            const p = parametres.find(x => x.cle === c)
            const v = enTexte(fournis[c])
            return p?.valeurs?.length
                ? `\`${c}=${v}\` (valeurs admises : ${p.valeurs.join(', ')})`
                : `\`${c}\` (cette question ne sait pas filtrer là-dessus)`
        })
}

export function construireChemin(chemin: string, params: Record<string, string>, qs: URLSearchParams): string {
    return chemin.replace(/\{(\w+)\}/g, (tout, cle) => {
        const v = params[cle]
        if (!v) return tout
        qs.delete(cle)
        return encodeURIComponent(v)
    })
}

/**
 * TROIS CODES, TROIS CHOSES DIFFÉRENTES.
 *
 * Le contrat de lecture y consacre une section entière (§ 11 bis), et pour une raison
 * précise : les confondre conduit à conclure qu'un domaine est inaccessible alors qu'il est
 * seulement vide, ou l'inverse. On lisait tout ce qui n'est pas 503 comme une même panne.
 */
/**
 * Les valeurs littérales acceptées, quand Elysia les noie dans son schéma d'erreur.
 *
 * Son `summary` rend « should be one of: 'string', 'string', 'string', 'string' » — le TYPE
 * de chaque branche de l'union, pas sa valeur. Les valeurs, elles, sont dans les `const` des
 * sous-schémas. Sans cela, le message dit qu'il existe quatre valeurs sans dire lesquelles,
 * ce qui n'aide personne à reformuler.
 */
export function valeursAdmises(corps: any): string[] {
    const vues = new Set<string>()
    const parcourir = (n: any, profondeur = 0) => {
        if (!n || typeof n !== 'object' || profondeur > 6) return
        if (typeof n.const === 'string') vues.add(n.const)
        if (Array.isArray(n.enum)) for (const v of n.enum) if (typeof v === 'string') vues.add(v)
        for (const v of Object.values(n)) {
            if (Array.isArray(v)) for (const x of v) parcourir(x, profondeur + 1)
            else parcourir(v, profondeur + 1)
        }
    }
    parcourir(corps?.expected)
    for (const e of corps?.errors ?? []) parcourir(e?.schema)
    return [...vues].slice(0, 12)
}

async function diagnostiquer(r: Response, source: string, chemin: string): Promise<string> {
    const texte = await r.text()
    let corps: any = null
    try { corps = JSON.parse(texte) }
    catch { /* le corps n'est pas toujours du JSON, et ce n'est pas grave ici */ }
    const detail = texte.replace(/\s+/g, ' ').slice(0, 300)

    if (r.status === 403) {
        return `403 sur ${source} ${chemin} : cette catégorie est HORS DE LA PORTÉE de la clé de service. `
            + `Ce n'est pas une absence de données — le domaine n'a pas été regardé. `
            + `La clé doit porter le scope « read » ; un scope « cat:… » la restreint même en présence de « read ».`
    }

    if (r.status === 404) {
        const proches: string[] = Array.isArray(corps?.suggestions) ? corps.suggestions : []
        return `404 sur ${source} ${chemin} : l'objet n'existe pas sous ce nom ou cet identifiant. `
            + `Ce n'est PAS un défaut de droits, et ce n'est pas « vide ».`
            + (proches.length ? ` Noms proches proposés par la source : ${proches.slice(0, 8).join(', ')}.` : '')
    }

    if (r.status === 503) {
        // Le champ `consequence` est rédigé pour être répercuté sans traduction : le
        // Catalogue y écrit exactement ce qu'il ne faut pas conclure.
        return corps?.consequence
            ? `503 sur ${source} ${chemin}. ${corps.consequence}`
            : `503 sur ${source} ${chemin} : une source amont est inactive ou injoignable. `
              + `Ce n'est PAS l'absence de données. ${detail}`
    }

    // 422 — LA REQUÊTE EST FAUSSE, PAS LA PORTÉE, ET SURTOUT PAS LA DONNÉE.
    //
    // Elysia nomme la propriété fautive et la valeur reçue. On les extrait, parce que la
    // seule chose utile ici est « quelle valeur, sur quel paramètre ». Le `summary` d'Elysia
    // rend parfois « should be one of: 'string', 'string' » — les valeurs littérales sont
    // alors dans le schéma des erreurs, et c'est là qu'on va les chercher.
    if (r.status === 422) {
        const propriete = String(corps?.property ?? '').replace(/^\//, '') || '(non nommée)'
        const recue = corps?.found?.[propriete]
        const admises = valeursAdmises(corps)
        return `Requête refusée par ${source} (422) : le paramètre « ${propriete} » n'accepte pas la valeur `
            + `« ${recue ?? '?'} ».`
            + (admises.length ? ` Valeurs admises : ${admises.join(', ')}.` : ` ${source} n'énumère pas les valeurs admises dans son message.`)
            + ` CE N'EST PAS UNE ABSENCE DE RÉSULTAT : la question n'a pas été posée, et rien ne permet de `
            + `dire s'il existe des résultats. À reformuler avec une valeur admise.`
    }

    if (r.status === 401) {
        return `401 sur ${source} ${chemin} : la clé de service est refusée. `
            + `Vérifier qu'elle est renseignée et qu'elle n'a pas été révoquée.`
    }

    return `${source} ${chemin} → ${r.status} ${detail}`
}

/**
 * Ramène à du texte ce que le modèle a rendu, ou rien.
 *
 * `params` vient d'un JSON écrit par le modèle : rien ne garantit que ses valeurs soient des
 * chaînes. Un `pageSize: 5` au lieu de `"5"` faisait planter l'appel sur
 * « params[p.cle]?.trim is not a function » — une question qui échoue sur un message de
 * JavaScript, là où la valeur était pourtant utilisable.
 */
export function enTexte(v: unknown): string {
    if (typeof v === 'string') return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    if (typeof v === 'boolean') return String(v)
    return ''
}

/**
 * Exécute une question déclarée.
 *
 * Les paramètres sont FILTRÉS contre la déclaration : un paramètre que le modèle aurait
 * inventé est écarté, il ne part pas dans l'URL. C'est ce qui fait que « le modèle rédige
 * la requête » reste vrai sans que le modèle puisse composer n'importe quoi.
 */
export async function executer(cle: string, params: Record<string, string>): Promise<Appel | null> {
    const q = question(cle)
    if (!q) return null

    const s = await sourceActive(q.source)
    if (!s) {
        return {
            cle, requete: `${q.source} ${q.chemin}`, corps: null, mentions: [],
            erreur: `La source « ${q.source} » n'est pas configurée ou n'est pas active. `
                + `Aucune donnée ne peut être lue : ce n'est pas « rien à signaler ».`,
        }
    }

    const cfg = (s.config ?? {}) as Record<string, unknown>
    const base = String(cfg.base ?? '').replace(/\/+$/, '')
    const jeton = dechiffrer(s.jetonChiffre)
    if (!base || !jeton) {
        return {
            cle, requete: `${q.source} ${q.chemin}`, corps: null, mentions: [],
            erreur: `Adresse ou clé de service manquante pour « ${s.nom} ».`,
        }
    }

    const mentionsFiltres: string[] = []
    const retenus = new URLSearchParams()
    // Les défauts de la question d'abord : le modèle peut les remplacer, pas les perdre.
    const fournis = { ...(q.defauts ?? {}), ...params }
    for (const p of q.parametres) {
        const v = enTexte(fournis[p.cle])
        if (!v) continue
        if (p.valeurs?.length && !p.valeurs.includes(v)) continue
        retenus.set(p.cle, v)
    }

    /**
     * LES FILTRES PUBLIÉS, VALIDÉS CONTRE LE CONTRAT DE LA SOURCE.
     *
     * Ils se combinent en ET, autant qu'on veut, et le `where` sert à la fois la page et le
     * décompte : `total` devient le croisement exact. Un tableau pré-calculé n'aurait donné
     * que les couples choisis d'avance ; ceci répond à la combinaison qu'on a en tête.
     */
    if (q.filtresPublies) {
        const { filtresDe, filtreAdmis } = await import('./lectures')
        const cat = await catalogueFusionne([q.source])
        const publies = filtresDe(cat, retenus.get('catalogue') ?? '')
        const sansLecture: string[] = []
        for (const [cle, brut] of Object.entries(fournis)) {
            if (retenus.has(cle)) continue
            const v = enTexte(brut)
            if (!v || !filtreAdmis(publies, cle, v)) continue
            retenus.set(cle, v)

            /**
             * UNE VALEUR ACCEPTÉE N'EST PAS UNE VALEUR COMPRISE.
             *
             * Le Catalogue le pose comme son vrai reste à faire : 99 filtres à vocabulaire,
             * 36 dont la lecture des valeurs est publiée. `?statut=en_deploiement` marchera
             * partout ; savoir que cette valeur EXPOSE DÉJÀ un service ne se sait que pour
             * un tiers d'entre eux.
             */
            const f = publies.find(x => x.champ === cle)
            if (f?.nature === 'vocabulaire' && !cat.vocabulaires.some(v => v.champ === cle && (v.valeurs ?? []).length)) {
                sansLecture.push(`${cle}=${v}`)
            }
        }
        if (sansLecture.length) {
            mentionsFiltres.push(`Filtre appliqué sur un vocabulaire dont la LECTURE n'est pas publiée : `
                + `${sansLecture.join(', ')}. La sélection est exacte, mais rien ne dit ce que cette valeur `
                + `signifie — ne pas la paraphraser, ne pas en déduire une conséquence, la citer telle quelle.`)
        }
    }

    // AVANT `construireChemin`, qui retire de la chaîne de requête ce qu'il substitue dans
    // le chemin : après lui, un paramètre appliqué ne se distingue plus d'un paramètre écarté.
    const appliques = new Set(retenus.keys())
    const chemin = construireChemin(q.chemin, Object.fromEntries(retenus), retenus)

    const requete = `GET ${chemin}${retenus.size ? `?${retenus}` : ''}`
    const mentions: string[] = [...mentionsFiltres]

    /**
     * UN FILTRE ÉCARTÉ REND UNE RÉPONSE NON FILTRÉE, PRÉSENTÉE COMME FILTRÉE.
     *
     * Deux causes, et le résultat est le même : un paramètre absent de la déclaration, ou
     * une valeur hors du vocabulaire fermé. Dans les deux cas la boucle ci-dessus passe son
     * chemin, la requête part SANS la restriction, et `total` compte le catalogue entier.
     */
    const ecartes = filtresEcartes(fournis, appliques, q.parametres)

    if (q.source === 'sniff') {
        // Les seuils viennent du DESCRIPTEUR quand la source ne les porte pas : une source
        // enregistrée avant l'ajout d'un champ ne le reçoit pas rétroactivement, et son
        // contrôle ne s'appliquerait alors à aucune source existante.
        const v = await verifierSniff(
            base, jeton,
            valeurOuDefaut('sniff', cfg, 'version_minimale'),
            valeurOuDefaut('sniff', cfg, 'date_minimale') || undefined,
        )
        if (v.mention) mentions.push(v.mention)
    }

    // `lacunes_catalogue` interroge déjà ce point d'entrée : l'y confronter en plus
    // ferait dire deux fois la même chose.
    if (q.source === 'catalogue' && q.cle !== 'lacunes_catalogue') {
        const l = await lireLacunes(base, jeton)
        if (l.erreur) {
            mentions.push(`Les angles morts du Catalogue N'ONT PAS PU ÊTRE VÉRIFIÉS (${l.erreur}). `
                + `Cette réponse est donc rendue sans savoir si le référentiel qu'elle interroge est rempli.`)
        }
        else {
            mentions.push(...lacunesApplicables(l.corps, q.domaines ?? []))
        }
    }

    try {
        const r = await fetch(`${base}${chemin}${retenus.size ? `?${retenus}` : ''}`, {
            headers: { 'x-service-key': jeton, Authorization: `Bearer ${jeton}` },
            signal: AbortSignal.timeout(60_000),
        })
        if (!r.ok) return { cle, requete, corps: null, mentions, erreur: await diagnostiquer(r, q.source, chemin) }
        const lu = await lireJson(r, `${q.source} ${chemin}`)
        if (lu.ok && ecartes.length) mentions.push(mentionFiltreEcarte(ecartes, lu.corps))
        if (!lu.ok) return { cle, requete, corps: null, mentions, erreur: lu.erreur }

        // QUATRE COUCHES, ET LA DERNIÈRE VIENT DE CHEZ LA SOURCE.
        //
        //   `mentions`          — état de la source : version, angles morts du domaine.
        //   `mentionsDe`        — post-conditions de CETTE question.
        //   `appliquer`         — les lectures que la SOURCE publie sur /api/lectures.
        //   `champsCalcules`    — ce que la source interdit de FAIRE d'un champ présent.
        //   `mentionsDeValeurs` — nos règles locales, pour ce qu'elle n'a pas déclaré.
        const cat = await catalogueFusionne(await sourcesDonneesActives())
        const complements: string[] = []
        if (cat.erreur) {
            complements.push(`Des lectures publiées par les sources n'ont pas pu être chargées (${cat.erreur}) : `
                + `seules nos mises en garde locales s'appliquent à cette réponse, et elles sont partielles.`)
        }
        // La source déclare elle-même la portée de sa garantie. Sniff dit franchement que
        // ses champs ambigus ne sont pas décrits exhaustivement : le taire ferait passer une
        // couverture partielle pour un filet.
        if (cat.garantie && !exhaustif(cat.garantie.champsAmbigus)) {
            complements.push(prescrire("Ne présente jamais l'absence de mise en garde comme une garantie : les vocabulaires "
                + "fermés des sources sont décrits exhaustivement, leurs CHAMPS AMBIGUS ne le sont pas. Un champ "
                + "sur lequel rien n'est écrit peut tout de même se lire de travers."))
        }

        return {
            cle, requete, corps: lu.corps,
            mentions: [
                ...mentions,
                ...mentionsDe(q as Question, lu.corps, Object.fromEntries(retenus)),
                ...appliquer(cat.lectures, lu.corps),
                // Le contrôle de fraîcheur passe AVANT les règles locales : si le catalogue
                // est périmé, le fait que nos règles aient pris le relais n'est pas une
                // consolation, c'est une seconde raison de se méfier de la réponse.
                ...fraicheur(cat.vocabulaires, lu.corps),
                // Le recensement des champs calculés : ce qu'on n'a pas le droit de FAIRE
                // d'un champ présent — le filtrer, le dénombrer — indépendamment de sa
                // valeur. Publié en charge utile par la source, donc appliqué : un champ
                // déclaré demain protège la réponse sans qu'on écrive une ligne.
                ...mentionsDeChampsCalcules(lu.corps, cat.champsCalcules, q.chemin),
                // La note d'une partition dit ce que comptent ses valeurs — ce que le
                // vocabulaire ne dit pas. Publiée par la source, donc relayée : notre
                // version écrite à la main s'est révélée fausse sur la cause, et périmée
                // par leur correctif suivant.
                ...mentionsDePartitions(lu.corps, cat.partitions, q.chemin),
                ...mentionsDeValeurs(lu.corps, nonCouvertes(cat.lectures, undefined, cat.champsCalcules)),
                ...complements,
            ],
        }
    }
    catch (e) {
        return {
            cle, requete, corps: null, mentions,
            erreur: `${q.source} injoignable : ${e instanceof Error ? e.message : e}. `
                + `Aucune conclusion ne peut être tirée de cette absence de réponse.`,
        }
    }
}

// =====================================================================================
// SONDE DE PORTÉE — ce que la clé de service atteint RÉELLEMENT.
//
// Sans cette page, on découvrait un défaut de portée UNE QUESTION À LA FOIS, en production,
// sous la forme d'une réponse creuse. C'est le pire moment et la pire forme.

/** Un point d'entrée du contrat qui n'est pas une question déclarée, mais qu'on veut sonder. */
type Sonde = {
    cle: string
    intitule: string
    source: string
    chemin: string
    /**
     * Paramètres de sonde. Pour un chemin qui exige un objet précis, on envoie une valeur
     * inoffensive : le but est de savoir si le chemin RÉPOND, pas de trouver l'objet. Un
     * 404 sur une telle sonde est donc un succès de portée, et l'affichage le dit.
     */
    params?: Record<string, string>
    objetInexistantAttendu?: boolean
}

/**
 * Les points d'entrée du contrat qui ne sont pas des questions.
 *
 * `/openapi/json` et `/api/categories` ne servent à répondre à personne : ils servent à
 * savoir si la clé porte bien le scope `read`. Les résumés, eux, valident une portée par
 * domaine sans avoir à choisir un objet.
 */
const SONDES_HORS_QUESTIONS: Sonde[] = [
    // `/api/categories` N'EST PAS ICI, et la sonde de portée en donne la raison :
    // il répond 401 à une clé de service, il est réservé à une session humaine. Le contrat
    // le citait comme moyen de découvrir les catégories ; c'était faux, et l'équipe
    // Catalogue l'a retiré de son document. Le sonder ferait clignoter un refus permanent
    // qu'aucune correction de portée ne pourrait faire disparaître.
    { cle: 'schema', intitule: 'Schéma OpenAPI — atteint par une clé portant `read`', source: 'catalogue', chemin: '/openapi/json' },

    // LES LECTURES PUBLIÉES — sondées parce que TOUTE la couche de mise en garde en dépend.
    { cle: 'lectures_catalogue', intitule: 'Lectures publiées par le Catalogue — les mises en garde viennent de là', source: 'catalogue', chemin: '/api/lectures' },
    { cle: 'lectures_sniff', intitule: 'Lectures publiées par Sniff', source: 'sniff', chemin: '/api/lectures' },
    { cle: 'alertes', intitule: 'Alertes, forme brute', source: 'catalogue', chemin: '/api/alerts' },
    { cle: 'tableau_de_bord', intitule: 'Tableau de bord', source: 'catalogue', chemin: '/api/dashboard' },
    { cle: 'avancement_nis2', intitule: 'Avancement NIS 2', source: 'catalogue', chemin: '/api/nis2/avancement' },
    { cle: 'resume_conformite', intitule: 'Résumé de conformité — trois cadres', source: 'catalogue', chemin: '/api/conformite/resume' },
    { cle: 'resume_listes_blanches', intitule: 'Résumé des listes blanches', source: 'catalogue', chemin: '/api/whitelists/resume' },
    { cle: 'resume_edr', intitule: 'Résumé des règles de détection', source: 'catalogue', chemin: '/api/edr/resume' },
    { cle: 'resume_certificats', intitule: 'Résumé des certificats', source: 'catalogue', chemin: '/api/certificats/resume' },
    { cle: 'echeances_certificats', intitule: 'Certificats arrivant à échéance', source: 'catalogue', chemin: '/api/certificats/echeances', params: { jours: '30' } },
    { cle: 'resume_nis2', intitule: 'Résumé des compteurs réglementaires', source: 'catalogue', chemin: '/api/nis2/echeances/resume' },
    { cle: 'sante_sniff', intitule: 'État de Sniff et version déployée', source: 'sniff', chemin: '/health' },
    { cle: 'incidents_count', intitule: "Décompte d'incidents", source: 'sniff', chemin: '/api/incidents/count' },
]

export type ResultatSonde = {
    cle: string
    intitule: string
    source: string
    requete: string
    code: number | null
    /** `ouvert` · `hors_portee` · `absent` · `source_inactive` · `refuse` · `injoignable` */
    etat: string
    /** Ce que ce code veut dire ICI, et surtout ce qu'il ne veut pas dire. */
    explication: string
}

const ETATS: Record<string, { etat: string, explication: string }> = {
    ouvert: { etat: 'ouvert', explication: 'La clé atteint ce point d\'entrée.' },
    hors_portee: {
        etat: 'hors_portee',
        explication: "403 — HORS DE LA PORTÉE de la clé. C'est le seul code qui le signifie. "
            + "Les réponses qui s'appuient sur ce domaine reposeront sur un trou, sans le savoir. "
            + "Vérifier que la clé porte le scope `read` et AUCUN scope `cat:…`, qui restreint même en présence de `read`.",
    },
    absent: {
        etat: 'absent',
        explication: "404 — ce chemin n'existe pas sur cette instance. Ce n'est PAS un défaut de droits, "
            + 'et ce n\'est pas « vide ». Le Catalogue est peut-être antérieur à ce point du contrat.',
    },
    objet_absent: {
        etat: 'ouvert',
        explication: "404 sur un objet de sonde volontairement inexistant : le chemin répond, donc la portée est bonne.",
    },
    source_inactive: {
        etat: 'source_inactive',
        explication: "503 — une source amont est inactive ou injoignable. La portée n'est pas en cause, "
            + "et ce n'est PAS l'absence de données.",
    },
    refuse: {
        etat: 'refuse',
        explication: "401 — refusé à une clé de service. Soit la clé est absente ou révoquée, soit ce point "
            + "d'entrée est réservé à une session humaine : c'est le cas de /api/me, /api/roles, /api/audit, "
            + "et de la configuration des connecteurs. Aucune portée ne les ouvre, et c'est voulu.",
    },
    parametre_manquant: {
        etat: 'ouvert',
        explication: "422 — il manque un paramètre obligatoire à la sonde. Le chemin répond : la portée est bonne.",
    },
}

/**
 * Interroge tout ce que le contrat décrit, et rend le verdict de chaque point d'entrée.
 *
 * Les appels partent en parallèle par petits paquets : en série, une trentaine de points
 * d'entrée dont certains interrogent une source amont mettrait la page à la minute.
 */
export async function sonderPortee(): Promise<{ resultats: ResultatSonde[], resume: Record<string, number> }> {
    const sondes: Sonde[] = [
        ...QUESTIONS.map(q => ({
            cle: q.cle,
            intitule: q.intitule,
            source: q.source,
            chemin: q.chemin,
            params: Object.fromEntries(q.parametres
                .filter(p => p.obligatoire)
                .map(p => [p.cle, p.valeurs?.[0] ?? '__sonde__'])),
            objetInexistantAttendu: q.parametres.some(p => p.obligatoire && !p.valeurs?.length),
        })),
        ...SONDES_HORS_QUESTIONS,
    ]

    const parSource = new Map<string, { base: string, jeton: string } | null>()
    for (const type of new Set(sondes.map(s => s.source))) {
        const src = await sourceActive(type)
        const cfg = (src?.config ?? {}) as Record<string, unknown>
        const base = String(cfg.base ?? '').replace(/\/+$/, '')
        const jeton = src ? dechiffrer(src.jetonChiffre) : ''
        parSource.set(type, base && jeton ? { base, jeton } : null)
    }

    const resultats: ResultatSonde[] = []
    const paquets = 6
    for (let i = 0; i < sondes.length; i += paquets) {
        resultats.push(...await Promise.all(sondes.slice(i, i + paquets).map(s => sonderUne(s, parSource.get(s.source) ?? null))))
    }

    const resume: Record<string, number> = {}
    for (const r of resultats) resume[r.etat] = (resume[r.etat] ?? 0) + 1
    return { resultats: resultats.sort((a, b) => a.source.localeCompare(b.source) || a.cle.localeCompare(b.cle)), resume }
}

async function sonderUne(s: Sonde, acces: { base: string, jeton: string } | null): Promise<ResultatSonde> {
    const qs = new URLSearchParams(s.params ?? {})
    const chemin = construireChemin(s.chemin, s.params ?? {}, qs)
    const requete = `GET ${chemin}${qs.size ? `?${qs}` : ''}`
    const base = { cle: s.cle, intitule: s.intitule, source: s.source, requete }

    if (!acces) {
        return {
            ...base, code: null, etat: 'non_configure',
            explication: `La source « ${s.source} » n'est pas configurée ou n'est pas active : rien n'a été interrogé.`,
        }
    }

    try {
        const r = await fetch(`${acces.base}${chemin}${qs.size ? `?${qs}` : ''}`, {
            headers: { 'x-service-key': acces.jeton, Authorization: `Bearer ${acces.jeton}` },
            signal: AbortSignal.timeout(20_000),
        })
        const cle = r.ok ? 'ouvert'
            : r.status === 403 ? 'hors_portee'
                : r.status === 404 ? (s.objetInexistantAttendu ? 'objet_absent' : 'absent')
                    : r.status === 503 ? 'source_inactive'
                        : r.status === 401 ? 'refuse'
                            // 422 = paramètre obligatoire manquant, pas un refus. Le chemin
                            // répond, donc la portée est bonne : compter cela comme un échec
                            // ferait accuser les droits d'un défaut de notre requête.
                            : r.status === 422 ? 'parametre_manquant' : null
        if (cle) return { ...base, code: r.status, ...ETATS[cle]! }
        return { ...base, code: r.status, etat: 'autre', explication: `Code ${r.status}, non prévu par le contrat.` }
    }
    catch (e) {
        return {
            ...base, code: null, etat: 'injoignable',
            explication: `Injoignable : ${e instanceof Error ? e.message : e}. Aucune conclusion de portée ne peut en être tirée.`,
        }
    }
}

/** Les types de source « données » actuellement configurés et actifs. */
export async function sourcesDonneesActives(): Promise<string[]> {
    const lignes = await db.select({ type: indexSchema.source.type })
        .from(indexSchema.source).where(eq(indexSchema.source.actif, true))
    return [...new Set(lignes.map(l => l.type))].filter(t => t === 'catalogue' || t === 'sniff')
}
