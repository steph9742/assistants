// CONNECTEUR GITLAB — lecture d'un dépôt de documentation.
//
// Connecteur GitLab : API v4, détection d'inchangé par empreinte de commit,
// même principe — le dépôt est la source, nous n'en sommes que lecteurs. Une seule
// différence de fond : `playbooks.ts` rapatrie des fiches entières pour les afficher, ici
// on les découpe pour les chercher.

import { dechiffrer } from "./secrets";

export type ConfigGitLab = {
    base: string
    projet: string
    ref: string
    dossiers: string[]
    /** Chemins jamais lus. `_archive/` et `sortie/` par défaut. */
    exclusions: string[]
}

export const CONFIG_DEFAUT: Omit<ConfigGitLab, 'base' | 'projet'> = {
    ref: 'main',
    dossiers: ['incidents', 'outils', 'quotidien', 'annexes', 'validation'],
    // `product/` : les notes de version de la documentation éditeur. Soixante fichiers qui
    // énumèrent chacun toutes les fonctionnalités touchées par une version — donc qui
    // mentionnent tout, sans rien expliquer. sans cette exclusion, « Notes de mise
    // à jour » sortait en tête sur « Comment écrire une règle Sigma ? », devant la page qui
    // décrit le moteur Sigma.
    exclusions: ['_archive/', 'sortie/', '_gabarits/', '_outils/', 'product/'],
}

/**
 * Une liste peut arriver en TABLEAU ou en CHAÎNE, et il faut accepter les deux.
 *
 * Les valeurs par défaut du descripteur sont des chaînes — `'_archive/,sortie/,…'` — tandis
 * qu'un champ saisi dans l'interface produit un tableau. Une source créée sans toucher au
 * champ portait donc une chaîne, que `lireConfig` laissait passer telle quelle : `.length`
 * vaut vrai sur une chaîne, la garde ne voyait rien, et le filtre échouait plus loin sur
 * « exclusions.some is not a function ».
 */
function liste(v: unknown, defaut: string[]): string[] {
    const sortie = Array.isArray(v)
        ? v.map(String).map(x => x.trim()).filter(Boolean)
        : String(v ?? '').split(',').map(x => x.trim()).filter(Boolean)
    return sortie.length ? sortie : defaut
}

export function lireConfig(config: unknown, jetonChiffre: string | null): (ConfigGitLab & { jeton: string }) | null {
    const c = (config ?? {}) as Record<string, unknown>
    const jeton = dechiffrer(jetonChiffre)
    const base = String(c.base ?? '').replace(/\/+$/, '')
    const projet = String(c.projet ?? '')
    if (!base || !projet || !jeton) return null
    return {
        base, projet, jeton,
        ref: String(c.ref || CONFIG_DEFAUT.ref),
        dossiers: liste(c.dossiers, CONFIG_DEFAUT.dossiers),
        exclusions: liste(c.exclusions, CONFIG_DEFAUT.exclusions),
    }
}

class Absent extends Error {}

async function appeler(cfg: ConfigGitLab & { jeton: string }, chemin: string, brut = false): Promise<any> {
    const projet = encodeURIComponent(cfg.projet)
    const r = await fetch(`${cfg.base}/api/v4/projects/${projet}/${chemin}`, {
        headers: { 'PRIVATE-TOKEN': cfg.jeton },
        signal: AbortSignal.timeout(60_000),
    })
    // GitLab répond « 404 invalid revision or path » aussi bien pour une branche inconnue
    // que pour un dossier absent. On distingue au niveau au-dessus, où l'on sait lequel des
    // deux on cherchait.
    if (r.status === 404) throw new Absent(await r.text())
    if (!r.ok) throw new Error(`GitLab ${chemin} → ${r.status} ${(await r.text()).slice(0, 200)}`)
    return brut ? r.text() : r.json()
}

/** La branche existe-t-elle ? Sert à distinguer « mauvaise branche » de « dossier absent ». */
async function brancheExiste(cfg: ConfigGitLab & { jeton: string }): Promise<boolean> {
    try {
        await appeler(cfg, `repository/branches/${encodeURIComponent(cfg.ref)}`)
        return true
    }
    catch (e) { if (e instanceof Absent) return false; throw e }
}

export type Entree = { chemin: string, empreinte: string }

/**
 * Liste les fichiers Markdown des dossiers retenus, avec le sha de leur blob.
 */
export async function lister(cfg: ConfigGitLab & { jeton: string }): Promise<Entree[]> {
    return (await listerDetaille(cfg)).entrees
}

export type Releve = { entrees: Entree[], absents: string[], presents: string[] }

/**
 * Liste, en tolérant les dossiers absents.
 *
 * UN DOSSIER QUI N'EXISTE PAS N'EST PAS UNE ERREUR. C'est même le cas courant : les dépôts
 * de la maison écrivent tantôt `doc`, tantôt `docs`, et déclarer les deux sur une source
 * commune est la façon simple de couvrir les deux. Une source qui échouerait au premier
 * dossier manquant rendrait l'import en lot inutilisable — et c'est précisément ce qu'elle
 * faisait.
 */
export async function listerDetaille(cfg: ConfigGitLab & { jeton: string }): Promise<Releve> {
    const entrees: Entree[] = []
    const absents: string[] = []
    const presents: string[] = []

    for (const dossier of cfg.dossiers) {
        const avant = entrees.length
        let vu = false
        let page = 1
        for (;;) {
            let lot: { type: string, path: string, id: string }[]
            try {
                lot = await appeler(cfg,
                    `repository/tree?path=${encodeURIComponent(dossier)}&ref=${encodeURIComponent(cfg.ref)}`
                    + `&recursive=true&per_page=100&page=${page}`) as { type: string, path: string, id: string }[]
            }
            catch (e) {
                if (!(e instanceof Absent)) throw e
                break
            }

            if (!Array.isArray(lot) || !lot.length) break
            vu = true
            for (const e of lot) {
                if (e.type !== 'blob' || !e.path.endsWith('.md')) continue
                if (exclu(e.path, cfg.exclusions)) continue
                entrees.push({ chemin: e.path, empreinte: e.id })
            }
            if (lot.length < 100) break
            page++
        }
        if (vu || entrees.length > avant) presents.push(dossier)
        else absents.push(dossier)
    }

    if (!presents.length) {
        const branche = await brancheExiste(cfg)
        throw new Error(branche
            ? `Aucun des dossiers déclarés n'existe dans ${cfg.projet} sur la branche « ${cfg.ref} » : ${absents.join(', ')}.`
            : `La branche « ${cfg.ref} » n'existe pas dans ${cfg.projet}. C'est elle qu'il faut corriger, pas les dossiers.`)
    }

    return { entrees, absents, presents }
}

/**
 * Un chemin est exclu s'il traverse un dossier exclu, ou s'il porte le suffixe `.local.md`.
 *
 * Les `.local.md` portent les valeurs réelles — secrets, configuration d'IdP — et sont déjà
 * ignorés par Git. Ils ne devraient donc jamais apparaître dans un arbre GitLab ; le filtre
 * est là pour le jour où l'un d'eux serait commité par accident, ce qui est exactement le
 * jour où il ne faut pas qu'un assistant le recopie dans une réponse.
 */
export function exclu(chemin: string, exclusions: string[]): boolean {
    if (chemin.endsWith('.local.md')) return true
    const normalise = chemin.startsWith('/') ? chemin.slice(1) : chemin
    return exclusions.some(e => {
        const motif = e.replace(/^\/+|\/+$/g, '')
        return normalise === motif
            || normalise.startsWith(`${motif}/`)
            || normalise.includes(`/${motif}/`)
    })
}

export async function lireFichier(cfg: ConfigGitLab & { jeton: string }, chemin: string): Promise<string> {
    return appeler(cfg,
        `repository/files/${encodeURIComponent(chemin)}/raw?ref=${encodeURIComponent(cfg.ref)}`,
        true) as Promise<string>
}

/** Lien vers le document dans GitLab, pour la citation. */
export function urlDocument(cfg: ConfigGitLab, chemin: string, ancre?: string | null): string {
    const base = `${cfg.base}/${cfg.projet}/-/blob/${cfg.ref}/${chemin}`
    return ancre ? `${base}#${ancre}` : base
}

// ---------------------------------------------------------------------------------------
// DÉCOUVERTE — pour ne pas saisir à la main ce que GitLab sait dire.
//
// Même discipline que la liste des modèles : un chemin de projet tapé de mémoire et
// légèrement faux échoue à la synchronisation, plusieurs jours après avoir été enregistré,
// et le message ne dit pas qu'il s'agit d'une faute de frappe.
// ---------------------------------------------------------------------------------------

export type Projet = { chemin: string, nom: string, branche: string, archive: boolean }

/**
 * Projets d'un groupe, sous-groupes compris.
 *
 * `archived=false` par défaut : un dépôt archivé n'a plus de documentation vivante, et
 * l'indexer servirait des procédures que plus personne ne maintient.
 */
export async function listerProjets(
    base: string, jeton: string, groupe: string, avecArchives = false,
): Promise<Projet[]> {
    const projets: Projet[] = []
    let page = 1
    for (;;) {
        const url = `${base.replace(/\/+$/, '')}/api/v4/groups/${encodeURIComponent(groupe)}/projects`
            + `?include_subgroups=true&per_page=100&order_by=path&sort=asc&page=${page}`
            + (avecArchives ? '' : '&archived=false')

        const r = await fetch(url, { headers: { 'PRIVATE-TOKEN': jeton }, signal: AbortSignal.timeout(30_000) })
        if (!r.ok) throw new Error(`GitLab groupes/${groupe} → ${r.status} ${(await r.text()).slice(0, 200)}`)

        const lot = await r.json() as { path_with_namespace: string, name: string, default_branch: string | null, archived: boolean }[]
        if (!Array.isArray(lot) || !lot.length) break
        for (const p of lot) {
            projets.push({
                chemin: p.path_with_namespace,
                nom: p.name,
                branche: p.default_branch || 'main',
                archive: !!p.archived,
            })
        }
        if (lot.length < 100) break
        page++
    }
    return projets
}

export type Dossier = { chemin: string, fichiersMd: number, niveau: number }

/**
 * Dossiers d'un dépôt, sur DEUX niveaux, avec le nombre de fichiers Markdown de chacun.
 *
 * Deux niveaux et pas un, parce que c'est là que se joue la décision. Dans le corpus,
 * `reference` porte 212 fichiers — ce qui ne dit rien : ils se répartissent entre
 * `reference/juridique`, `reference/bonnes-pratiques` et `reference/harfanglab`, dont les
 * AUTORITÉS SONT OPPOSÉES. Un texte de loi prime sur nos procédures, un guide ANSSI non.
 * Proposer le seul dossier parent conduirait à les mélanger dans une source unique, donc à
 * leur donner la même autorité, donc à se tromper.
 */
export async function listerDossiers(
    base: string, jeton: string, projet: string, ref = 'main',
): Promise<Dossier[]> {
    const racine = `${base.replace(/\/+$/, '')}/api/v4/projects/${encodeURIComponent(projet)}`
    const compte = new Map<string, number>()
    const connus = new Set<string>()

    let page = 1
    for (;;) {
        const r = await fetch(
            `${racine}/repository/tree?ref=${encodeURIComponent(ref)}&recursive=true&per_page=100&page=${page}`,
            { headers: { 'PRIVATE-TOKEN': jeton }, signal: AbortSignal.timeout(60_000) },
        )
        if (!r.ok) throw new Error(`GitLab ${projet} → ${r.status} ${(await r.text()).slice(0, 200)}`)

        const lot = await r.json() as { type: string, path: string }[]
        if (!Array.isArray(lot) || !lot.length) break

        for (const e of lot) {
            const morceaux = e.path.split('/')

            if (e.type === 'tree') {
                if (morceaux.length <= 2) connus.add(e.path)
                continue
            }
            if (!e.path.endsWith('.md')) continue

            for (let n = 1; n <= Math.min(2, morceaux.length - 1); n++) {
                const prefixe = morceaux.slice(0, n).join('/')
                compte.set(prefixe, (compte.get(prefixe) ?? 0) + 1)
                connus.add(prefixe)
            }
        }
        if (lot.length < 100) break
        page++
    }

    return [...connus]
        .map(chemin => ({
            chemin,
            fichiersMd: compte.get(chemin) ?? 0,
            niveau: chemin.split('/').length,
        }))
        .sort((a, b) => a.chemin.localeCompare(b.chemin))
}
