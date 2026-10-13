// CE QUE LE FIL RETIENT, RENDU VISIBLE ET AMENDABLE.
//
// Le résumé d'état est construit en code côté serveur — des faits étiquetés, jamais du texte
// engendré — et renvoyé tel quel au tour suivant. Jusqu'ici il voyageait sans que personne
// ne le voie : la seule façon de savoir ce que l'assistant croyait retenir était de lire la
// question comprise après coup, c'est-à-dire trop tard.

/** Un groupe du résumé : son étiquette serveur, et les valeurs qu'il porte. */
export type Bout = { label: string | null, valeurs: string[] }

/** Une pastille affichée : son groupe abrégé, sa valeur, et la clé qui l'identifie. */
export type Pastille = { groupe: string, valeur: string, cle: string }

/**
 * Abrégés d'affichage. Les étiquettes du serveur sont écrites pour un modèle — elles
 * insistent, et c'est voulu (« fiches de procédure citées (documents, PAS des incidents) »).
 * À l'écran, la place est comptée et le lecteur humain n'a pas besoin de l'insistance.
 */
const ABREGE: Record<string, string> = {
    'données': 'requête',
    "identifiants d'incident": 'incident',
    'machines': 'machine',
    "types d'incident": 'type',
    'fiches de procédure citées (documents, PAS des incidents)': 'fiche',
}

/** Les groupes dont les valeurs ne se découpent pas sur la virgule. */
const INSECABLES = new Set(['données'])

export function analyserResume(resume: string): Bout[] {
    if (!resume.trim()) return []
    return resume.split(' · ').map((bout) => {
        const coupure = bout.indexOf(' : ')
        // Une phrase sans étiquette — « sans réponse — rien dans les sources » — est un
        // fait du tour, pas une valeur : elle se garde entière et ne se retire pas.
        if (coupure < 0) return { label: null, valeurs: [bout.trim()] }
        const label = bout.slice(0, coupure).trim()
        const reste = bout.slice(coupure + 3).trim()
        return {
            label,
            valeurs: INSECABLES.has(label) ? [reste] : reste.split(',').map(v => v.trim()).filter(Boolean),
        }
    })
}

export const cleBout = (label: string | null, valeur: string) => `${label ?? ''}|${valeur}`

export function pastilles(resume: string): Pastille[] {
    return analyserResume(resume).flatMap(b => b.valeurs.map(valeur => ({
        groupe: b.label ? (ABREGE[b.label] ?? b.label) : '',
        valeur,
        cle: cleBout(b.label, valeur),
    })))
}

/**
 * Le résumé privé des valeurs retirées — reconstruit dans la forme exacte que le serveur
 * produit, parce que c'est cette forme qu'il relira.
 */
export function resumeSans(resume: string, retirees: Set<string>): string {
    return analyserResume(resume)
        .map((b) => {
            const gardees = b.valeurs.filter(v => !retirees.has(cleBout(b.label, v)))
            if (!gardees.length) return null
            return b.label ? `${b.label} : ${gardees.join(', ')}` : gardees.join(', ')
        })
        .filter(Boolean)
        .join(' · ')
}
