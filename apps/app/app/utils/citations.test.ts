import { describe, expect, it } from 'bun:test'
import { citeesDans, cleCitation, normaliser, resoudreMarqueur } from './citations'
import { rendreMarkdown } from './markdown'

const SOURCES = [
    { reference: 'INC-01', titre: 'Compte compromis (non critique)', section: '0. Déclencheurs et classification' },
    { reference: 'INC-01', titre: 'Compte compromis (non critique)', section: '3. Confinement' },
    { reference: 'INC-00', titre: 'Procédure de triage', section: 'Les cinq issues' },
    { reference: 'ANX-J', titre: 'Gestes techniques par système', section: "2. Isoler une machine sans l'éteindre" },
    { reference: null, titre: 'Exploitation & MCO — Catalogue', section: '3. Mise à jour de l\'application' },
]

describe('resoudreMarqueur', () => {
    it('résout la référence ET la section quand les deux sont écrites', () => {
        expect(resoudreMarqueur('INC-01 — 3. Confinement', SOURCES)?.section).toBe('3. Confinement')
    })

    it('résout la référence seule vers la première section de la fiche', () => {
        expect(resoudreMarqueur('INC-01', SOURCES)?.reference).toBe('INC-01')
    })

    it('supporte le § et l\'absence de tiret', () => {
        expect(resoudreMarqueur('INC-00 §Les cinq issues', SOURCES)?.reference).toBe('INC-00')
    })

    it('ignore les accents et l\'apostrophe', () => {
        expect(resoudreMarqueur("ANX-J — 2. Isoler une machine sans l'eteindre", SOURCES)?.reference).toBe('ANX-J')
    })

    it('résout une source sans référence par son titre, entités comprises', () => {
        // Le texte arrive échappé du rendu : `&` y est déjà `&amp;`.
        const c = resoudreMarqueur('Exploitation &amp; MCO — Catalogue — 3. Mise à jour', SOURCES)
        expect(c?.titre).toBe('Exploitation & MCO — Catalogue')
    })

    it('ne résout RIEN sur un crochet de prose — pas d\'ancre morte', () => {
        expect(resoudreMarqueur('comme ceci', SOURCES)).toBeNull()
        expect(resoudreMarqueur('INC-99 — inventée', SOURCES)).toBeNull()
    })
})

describe('citeesDans', () => {
    it('retient toutes les sections de la fiche nommée, pas seulement celle citée', () => {
        // Une réponse qui cite INC-01 §3 s'est fondée sur la fiche : ses autres sections
        // fournies ont porté le raisonnement.
        const cles = citeesDans('voir [INC-01 — 3. Confinement] pour la suite', SOURCES)
        expect(cles.has(cleCitation(SOURCES[0]!))).toBe(true)
        expect(cles.has(cleCitation(SOURCES[1]!))).toBe(true)
        expect(cles.has(cleCitation(SOURCES[3]!))).toBe(false)
    })

    it('rend un ensemble vide quand la réponse ne cite rien', () => {
        expect(citeesDans('aucune référence ici', SOURCES).size).toBe(0)
    })
})

describe('cleCitation', () => {
    it('donne une clé stable, utilisable comme ancre', () => {
        expect(cleCitation(SOURCES[1]!)).toBe('inc-01-3-confinement')
    })

    it('distingue deux sections de la même fiche', () => {
        expect(cleCitation(SOURCES[0]!)).not.toBe(cleCitation(SOURCES[1]!))
    })
})

describe('normaliser', () => {
    it('écarte accents, casse, ponctuation et entités', () => {
        expect(normaliser("L'ÉTEINDRE &amp; après")).toBe('l eteindre apres')
    })
})

describe('rendu des marqueurs', () => {
    it('rend cliquable un marqueur résolu, et lui seul', () => {
        const html = rendreMarkdown('Isoler [ANX-J — 2. Isoler une machine sans l\'éteindre] puis [rien].', SOURCES)
        expect(html).toContain('data-cite="anx-j-2-isoler-une-machine-sans-l-eteindre"')
        expect(html).toContain('[rien]')
        expect(html).not.toContain('data-cite="rien"')
    })

    it('ne fabrique aucune ancre quand aucune source n\'est fournie', () => {
        expect(rendreMarkdown('[INC-01 — 3. Confinement]')).not.toContain('data-cite')
    })

    it('ne touche pas à un lien Markdown complet', () => {
        const html = rendreMarkdown('[INC-01](https://exemple.fr/a.md)', SOURCES)
        expect(html).toContain('href="https://exemple.fr/a.md"')
        expect(html).not.toContain('data-cite')
    })
})
