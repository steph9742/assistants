// LES CITATIONS, DE LA RÉPONSE VERS SES SOURCES.
//
// Le modèle écrit ses renvois en clair — `[INC-01 — 3. Confinement]` — et la liste des
// sources vit plus bas, séparément. Sur une réponse à vingt sources, le lecteur ne peut pas
// relier une affirmation à la fiche qui la fonde sans chercher à la main. C'est exactement
// ce que la règle 4 demande de rendre facile.

export type SourceReperee = {
    reference: string | null
    titre: string
    section: string | null
}

/**
 * Comparaison tolérante : accents, ponctuation, casse et entités HTML écartés.
 *
 * Le texte arrive ÉCHAPPÉ quand il vient du rendu Markdown — `&` y est déjà `&amp;` — et
 * une comparaison naïve raterait « Exploitation &amp; MCO » contre « Exploitation & MCO ».
 */
export function normaliser(s: string): string {
    return s
        .replace(/&(amp|lt|gt|quot|#39);/g, ' ')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

/** Identifiant stable d'une source dans une réponse : sert d'ancre et de cible de surlignage. */
export function cleCitation(c: SourceReperee): string {
    const base = `${c.reference ?? c.titre}-${c.section ?? ''}`
    return normaliser(base).replace(/ /g, '-').slice(0, 80) || 'source'
}

/**
 * À quelle source un marqueur écrit renvoie-t-il ?
 *
 * Deux passes, de la plus exigeante à la plus tolérante : la référence ET la section, puis
 * la référence seule. Un marqueur qui nomme la bonne fiche sans sa section pointe vers la
 * fiche — c'est plus utile que rien, et jamais faux.
 */
export function resoudreMarqueur(interieur: string, sources: SourceReperee[]): SourceReperee | null {
    const dedans = normaliser(interieur)
    if (!dedans) return null

    const nomme = (c: SourceReperee) => {
        const ref = c.reference ? normaliser(c.reference) : ''
        const titre = normaliser(c.titre)
        return (ref && (dedans === ref || dedans.startsWith(`${ref} `)))
            || (titre.length > 3 && dedans.startsWith(titre))
    }

    const candidats = sources.filter(nomme)
    if (!candidats.length) return null

    const avecSection = candidats.find(c => {
        const s = c.section ? normaliser(c.section) : ''
        return s.length > 2 && dedans.includes(s)
    })
    return avecSection ?? candidats[0]!
}

/**
 * Le motif d'un marqueur : un crochet qui n'ouvre pas un lien Markdown.
 *
 * La borne de longueur écarte les crochets de prose — on ne cherche pas à reconnaître une
 * référence, seulement à ne pas passer à côté d'un candidat plausible. C'est la résolution
 * qui tranche ensuite, contre les sources réelles.
 */
export const MARQUEUR = /\[([^\]\n]{2,160})\](?!\()/g

/**
 * Les sources qui FONDENT la réponse, distinguées de celles qui ont seulement été lues.
 *
 * Une réponse cite trois fiches et en reçoit vingt : les afficher toutes au même niveau
 * fait un mur où la plus utile ne se voit plus. La distinction n'est pas une supposition —
 * elle se lit dans le texte du modèle.
 */
export function citeesDans(texte: string, sources: SourceReperee[]): Set<string> {
    const cles = new Set<string>()
    for (const [, interieur] of texte.matchAll(MARQUEUR)) {
        const c = resoudreMarqueur(interieur!, sources)
        if (!c) continue
        // La référence entière est retenue, pas la seule section citée : quand une réponse
        // nomme INC-01 §3, ses autres sections ont fondé le raisonnement aussi.
        for (const s of sources) {
            const memeDoc = c.reference ? s.reference === c.reference : s.titre === c.titre
            if (memeDoc) cles.add(cleCitation(s))
        }
    }
    return cles
}
