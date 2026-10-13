// DEUX NATURES DE MISE EN GARDE, TRIÉES EN CODE ET NON PAR LE MODÈLE.
//
// Une mise en garde QUALIFIE un fait, et se dit collée à ce fait ; ou elle PRESCRIT la façon
// d'écrire, et s'obéit sans se citer. Demander au modèle de faire ce tri avant d'écrire ne
// marche qu'une fois sur deux : le classement est un travail, et il se fait mal quand il
// s'ajoute au reste. Le marqueur le pose à l'écriture, par qui sait ce qu'il écrit.

/** Marqueur interne. Jamais affiché, jamais envoyé au modèle. */
const MARQUE = String.fromCharCode(1)

/**
 * Marque une mise en garde qui PRESCRIT la façon d'écrire.
 *
 * Le critère : une prescription s'adresse au rédacteur et n'apprend rien au lecteur. « Recopier sous ces noms », « ne pas additionner cette colonne », « ne
 * jamais présenter l'absence de mise en garde comme une garantie » — les imprimer, c'est
 * montrer la consigne au lieu de l'appliquer.
 */
export function prescrire(texte: string): string {
    return MARQUE + texte
}

export function estPrescription(m: string): boolean {
    return m.startsWith(MARQUE)
}

/** Le texte nu, marqueur retiré. À appeler avant tout affichage et tout envoi. */
export function texteMention(m: string): string {
    return m.startsWith(MARQUE) ? m.slice(MARQUE.length) : m
}

/**
 * Sépare les deux natures, marqueurs retirés.
 *
 * `aDire` d'abord dans l'ordre d'origine : ce sont elles qui se collent aux faits, et leur
 * ordre suit celui des faits.
 */
export function trierMentions(mentions: string[]): { aDire: string[], aFaire: string[] } {
    return {
        aDire: mentions.filter(m => !estPrescription(m)).map(texteMention),
        aFaire: mentions.filter(estPrescription).map(texteMention),
    }
}
