// CONNECTEUR NEXTCLOUD — WebDAV pour les fichiers, CalDAV pour les tâches.
//
// Deux différences de fond avec GitLab, et elles commandent tout le reste.

import { XMLParser } from "fast-xml-parser";
import { dechiffrer } from "./secrets";

export type ConfigNextcloud = {
    base: string
    compte: string
    dossier: string
    exclusions: string[]
    mentions: string[]
    refuserFederes: boolean
    tailleMax: number
    motDePasse: string
}

export function lireConfig(config: unknown, jetonChiffre: string | null): ConfigNextcloud | null {
    const c = (config ?? {}) as Record<string, unknown>
    const motDePasse = dechiffrer(jetonChiffre)
    const base = String(c.base ?? '').replace(/\/+$/, '')
    const compte = String(c.compte ?? '')
    if (!base || !compte || !motDePasse) return null

    const liste = (v: unknown) => Array.isArray(v) ? v.map(String)
        : String(v ?? '').split(',').map(x => x.trim()).filter(Boolean)

    return {
        base, compte, motDePasse,
        dossier: String(c.dossier ?? '').replace(/^\/+|\/+$/g, ''),
        exclusions: liste(c.exclusions).length ? liste(c.exclusions) : ['_archive/'],
        mentions: liste(c.mentions),
        refuserFederes: c.refuser_federes !== false && c.refuser_federes !== 'false',
        tailleMax: Number(c.taille_max) || 20_000_000,
    }
}

const parseur = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,   // d:response, oc:fileid… → response, fileid
    parseTagValue: false,
})

function entete(cfg: ConfigNextcloud): Record<string, string> {
    return {
        Authorization: `Basic ${Buffer.from(`${cfg.compte}:${cfg.motDePasse}`).toString('base64')}`,
        'Content-Type': 'application/xml; charset=utf-8',
    }
}

/** Racine WebDAV du dossier suivi. */
export function racine(cfg: ConfigNextcloud): string {
    const suffixe = cfg.dossier ? `/${cfg.dossier.split('/').map(encodeURIComponent).join('/')}` : ''
    return `${cfg.base}/remote.php/dav/files/${encodeURIComponent(cfg.compte)}${suffixe}`
}

export type EntreeNc = {
    chemin: string
    empreinte: string
    /** `oc:fileid`, stable même si le fichier est renommé. */
    fileid: string | null
    taille: number
    modifieLe: string | null
    federe: boolean
}

/** Les propriétés qu'on demande, et rien de plus. */
const PROPS = `<d:prop>
  <d:getetag/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/>
  <oc:fileid/><oc:permissions/>
</d:prop>`

function chemins(reponses: any[], base: string, cfg: ConfigNextcloud): { vivants: EntreeNc[], disparus: string[] } {
    const vivants: EntreeNc[] = []
    const disparus: string[] = []
    const prefixe = new URL(base).pathname.replace(/\/+$/, '')

    for (const r of reponses) {
        const href = decodeURIComponent(String(r.href ?? ''))
        const chemin = href.replace(/\/+$/, '').slice(prefixe.length).replace(/^\/+/, '')
        if (!chemin) continue

        // `sync-collection` marque les suppressions par un statut 404 sur la réponse.
        const statutReponse = String(r.status ?? '')
        if (statutReponse.includes('404')) { disparus.push(chemin); continue }

        const bloc = Array.isArray(r.propstat) ? r.propstat[0] : r.propstat
        const prop = bloc?.prop ?? {}
        if (prop.resourcetype && 'collection' in (prop.resourcetype ?? {})) continue   // dossier

        // `S` dans les permissions = partagé AVEC nous par quelqu'un d'autre ; le drapeau
        // fédéré apparaît en plus. On écarte le fédéré parce qu'il élargit hors de
        // l'établissement le « quiconque écrit ici peut y déposer un document empoisonné ».
        const permissions = String(prop.permissions ?? '')
        const federe = permissions.includes('S') && permissions.includes('M')
        if (federe && cfg.refuserFederes) continue

        vivants.push({
            chemin,
            empreinte: String(prop.getetag ?? '').replace(/"/g, ''),
            fileid: prop.fileid ? String(prop.fileid) : null,
            taille: Number(prop.getcontentlength ?? 0),
            modifieLe: prop.getlastmodified ? String(prop.getlastmodified) : null,
            federe,
        })
    }
    return { vivants, disparus }
}

/** Le jeton rendu par le serveur est devenu invalide : il faut relire tout le dossier. */
export class JetonPerime extends Error {
    constructor(detail: string) {
        super(`Jeton de synchronisation refusé par Nextcloud (${detail}). Lecture complète nécessaire.`)
    }
}

export type Releve = { vivants: EntreeNc[], disparus: string[], jeton: string | null, complet: boolean }

/** Lecture complète. Employée au premier passage, et quand le jeton a été refusé. */
export async function relever(cfg: ConfigNextcloud): Promise<Releve> {
    const url = racine(cfg)
    const r = await fetch(url, {
        method: 'PROPFIND',
        headers: { ...entete(cfg), Depth: 'infinity' },
        body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">${PROPS}</d:propfind>`,
        signal: AbortSignal.timeout(120_000),
    })
    if (!r.ok) throw new Error(`Nextcloud PROPFIND → ${r.status} ${(await r.text()).slice(0, 200)}`)

    const j = parseur.parse(await r.text())
    const reponses = [].concat(j.multistatus?.response ?? [])
    const { vivants } = chemins(reponses, url, cfg)

    // Le jeton s'obtient par un sync-collection vide : PROPFIND ne le rend pas.
    return { vivants, disparus: [], jeton: await jetonCourant(cfg), complet: true }
}

async function jetonCourant(cfg: ConfigNextcloud): Promise<string | null> {
    const r = await fetch(racine(cfg), {
        method: 'REPORT',
        headers: { ...entete(cfg), Depth: '0' },
        body: `<?xml version="1.0"?><d:sync-collection xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:sync-token/><d:sync-level>infinite</d:sync-level>${PROPS}</d:sync-collection>`,
        signal: AbortSignal.timeout(120_000),
    })
    if (!r.ok) return null
    const j = parseur.parse(await r.text())
    return j.multistatus?.['sync-token'] ? String(j.multistatus['sync-token']) : null
}

/**
 * Delta depuis un jeton.
 *
 * Lève `JetonPerime` si le serveur refuse le jeton — c'est le cas à traiter, pas une erreur
 * générique : l'appelant doit repartir sur `relever()`, sinon la source cesse de se mettre
 * à jour sans que rien ne le dise.
 */
export async function depuis(cfg: ConfigNextcloud, jeton: string): Promise<Releve> {
    const url = racine(cfg)
    const r = await fetch(url, {
        method: 'REPORT',
        headers: { ...entete(cfg), Depth: '0' },
        body: `<?xml version="1.0"?><d:sync-collection xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:sync-token>${jeton}</d:sync-token><d:sync-level>infinite</d:sync-level>${PROPS}</d:sync-collection>`,
        signal: AbortSignal.timeout(120_000),
    })

    // 507 et 409 sont les réponses de Nextcloud à un jeton trop ancien ou inconnu.
    if (r.status === 507 || r.status === 409) throw new JetonPerime(String(r.status))
    if (!r.ok) throw new Error(`Nextcloud REPORT → ${r.status} ${(await r.text()).slice(0, 200)}`)

    const texte = await r.text()
    if (/valid-sync-token/.test(texte)) throw new JetonPerime('valid-sync-token')

    const j = parseur.parse(texte)
    const reponses = [].concat(j.multistatus?.response ?? [])
    const { vivants, disparus } = chemins(reponses, url, cfg)
    const nouveau = j.multistatus?.['sync-token'] ? String(j.multistatus['sync-token']) : jeton
    return { vivants, disparus, jeton: nouveau, complet: false }
}

export async function lireFichier(cfg: ConfigNextcloud, chemin: string): Promise<ArrayBuffer> {
    const url = `${racine(cfg)}/${chemin.split('/').map(encodeURIComponent).join('/')}`
    const r = await fetch(url, { headers: entete(cfg), signal: AbortSignal.timeout(120_000) })
    if (!r.ok) throw new Error(`Nextcloud GET ${chemin} → ${r.status}`)
    return r.arrayBuffer()
}

/** Lien vers le fichier dans l'interface Nextcloud, pour la citation. */
export function urlDocument(cfg: ConfigNextcloud, fileid: string | null, chemin: string): string {
    // `/f/<fileid>` survit à un renommage ; le chemin, non.
    if (fileid) return `${cfg.base}/f/${fileid}`
    const dossier = cfg.dossier ? `${cfg.dossier}/` : ''
    return `${cfg.base}/apps/files/?dir=/${encodeURIComponent(`${dossier}${chemin}`.split('/').slice(0, -1).join('/'))}`
}

export function exclu(chemin: string, exclusions: string[]): boolean {
    const normalise = chemin.replace(/^\/+/, '')
    return exclusions.some(e => {
        const motif = e.replace(/^\/+|\/+$/g, '')
        return normalise === motif
            || normalise.startsWith(`${motif}/`)
            || normalise.includes(`/${motif}/`)
    })
}
