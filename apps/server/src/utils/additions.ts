// L'ADDITION EST UNE OPÉRATION EXACTE : ELLE APPARTIENT AU CODE.
//
// D'OÙ CE CORRECTIF, QUI NE DÉCIDE DE RIEN. Il ne choisit pas les termes, ne fabrique pas
// de somme, n'ajoute aucun total là où il n'y en a pas. Il relit une addition que le modèle
// a écrite lui-même, et corrige son résultat. Poser l'addition n'était donc pas un pis-aller
// de consigne : c'est ce qui rend la vérification possible, pour le code comme pour le
// lecteur. Un total nu se croit ; une somme écrite se recompte.

/** Une addition écrite : au moins trois termes, un résultat. */
const NOMBRE = String.raw`\d+(?:[ \u202f\u00a0]\d{3})*`
const ADDITION = new RegExp(`(${NOMBRE}(?:\\s*\\+\\s*${NOMBRE}){2,})\\s*=\\s*(${NOMBRE})`, 'g')

/** « 1 145 », « 1 145 » (espace insécable), « 1145 » — même nombre. */
function nombre(t: string): number {
    return Number(t.replace(/[\s\u202f\u00a0]/g, ''))
}

export type Correction = { termes: number[], ecrit: number, exact: number }

/**
 * Corrige le résultat des additions écrites dans un texte.
 *
 * Ne touche RIEN d'autre : ni les termes, ni les nombres isolés, ni les additions justes.
 * Une addition dont le résultat est exact ressort identique — au caractère près, y compris
 * ses espaces de milliers.
 */
export function corrigerAdditions(texte: string): { texte: string, corrections: Correction[] } {
    const corrections: Correction[] = []
    const corrige = texte.replace(ADDITION, (tout, gauche: string, droite: string) => {
        const termes = gauche.split('+').map(nombre)
        // Un terme illisible rend l'addition non vérifiable : on ne touche pas à ce qu'on
        // ne comprend pas entièrement.
        if (termes.some(n => !Number.isFinite(n))) return tout
        const exact = termes.reduce((a, b) => a + b, 0)
        const ecrit = nombre(droite)
        if (!Number.isFinite(ecrit) || ecrit === exact) return tout
        corrections.push({ termes, ecrit, exact })
        // Le résultat seul est remplacé, à sa place exacte : le reste de la phrase, y
        // compris ce qui suit le nombre, est laissé tel quel.
        return tout.slice(0, tout.lastIndexOf(droite)) + String(exact)
    })
    return { texte: corrige, corrections }
}
