import { describe, expect, it } from 'bun:test'
import { bornerCorps, desarmerLiensMorts } from './assistant'

describe('bornerCorps — la troncature qui se nomme', () => {
    it('rend le corps intact quand il tient, sans note', () => {
        const r = bornerCorps({ total: 2, resultats: [{ a: 1 }, { a: 2 }] }, 10_000)
        expect(r.note).toBeNull()
        expect(JSON.parse(r.texte)).toEqual({ total: 2, resultats: [{ a: 1 }, { a: 2 }] })
    })

    it('réduit le plus grand tableau, garde un JSON VALIDE, et le dit', () => {
        // Le cas des 68 listes blanches : total en tête, lignes trop nombreuses. La coupe
        // au couperet rendait un JSON invalide arrêté au milieu d'une ligne — le modèle
        // comptait ce qu'il voyait et répondait « une ».
        const lignes = Array.from({ length: 68 }, (_, i) => ({ id: `regle-${i}`, motif: null, texte: 'x'.repeat(80) }))
        const r = bornerCorps({ total: 68, tri: 'échéance', resultats: lignes }, 2_000)
        const corps = JSON.parse(r.texte) as { total: number, tri: string, resultats: unknown[] }
        expect(corps.total).toBe(68)
        expect(corps.tri).toBe('échéance')
        expect(corps.resultats.length).toBeLessThan(68)
        expect(corps.resultats.length).toBeGreaterThan(0)
        expect(r.note).toContain('BLOC TRONQUÉ')
        expect(r.note).toContain('sur 68 reçues')
        expect(r.note).toContain('ne conclus JAMAIS un décompte')
    })

    it('réduit aussi un corps qui est un tableau nu', () => {
        const r = bornerCorps(Array.from({ length: 40 }, () => ({ t: 'y'.repeat(100) })), 1_000)
        expect(Array.isArray(JSON.parse(r.texte))).toBe(true)
        expect(r.note).toContain('sur 40 reçues')
    })

    it('retombe sur la coupe nommée quand rien n\'est réductible', () => {
        const r = bornerCorps({ texte: 'z'.repeat(5_000) }, 1_000)
        expect(r.texte.length).toBe(1_000)
        expect(r.note).toContain('le JSON est incomplet')
    })
})

describe('desarmerLiensMorts — le contrat des liens tenu par le code', () => {
    it('ramène un lien fabriqué à son texte', () => {
        expect(desarmerLiensMorts('voir [INC-00 §Les cinq issues](INC-00---Les-cinq-issues) pour la suite'))
            .toBe('voir INC-00 §Les cinq issues pour la suite')
    })

    it('laisse les liens https intacts', () => {
        const t = 'la fiche [INC-04](https://gitlab.example.org/doc/inc-04.md) le dit'
        expect(desarmerLiensMorts(t)).toBe(t)
    })

    it('désarme aussi les images relatives, et plusieurs liens dans la même phrase', () => {
        expect(desarmerLiensMorts('![schéma](img.png) puis [a](x.md#un) et [b](y.md)'))
            .toBe('schéma puis a et b')
    })

    it('ne touche pas au texte sans lien', () => {
        expect(desarmerLiensMorts('des crochets [comme ceci] sans parenthèses restent'))
            .toBe('des crochets [comme ceci] sans parenthèses restent')
    })
})
