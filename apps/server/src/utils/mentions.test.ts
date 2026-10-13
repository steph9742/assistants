import { describe, expect, test } from "bun:test";
import { estPrescription, prescrire, texteMention, trierMentions } from "./mentions";

// Le marqueur ne doit JAMAIS atteindre le prompt ni l'écran : une prescription mal
// démarquée arriverait au modèle avec un caractère de contrôle en tête.

describe('deux natures de mise en garde', () => {
    test('marque et démarque sans altérer le texte', () => {
        const t = "Ne renomme aucune de ces entrées."
        expect(estPrescription(prescrire(t))).toBe(true)
        expect(texteMention(prescrire(t))).toBe(t)
        // Idempotent sur un texte nu : un texte non marqué se rend tel quel.
        expect(texteMention(t)).toBe(t)
        expect(estPrescription(t)).toBe(false)
    })

    test('sépare les deux natures et retire tout marqueur', () => {
        const { aDire, aFaire } = trierMentions([
            '610 dépassées est un minorant.',
            prescrire('Recopier sous ces noms.'),
            'La population répartie est de 8862 machines.',
        ])
        expect(aDire).toEqual(['610 dépassées est un minorant.', 'La population répartie est de 8862 machines.'])
        expect(aFaire).toEqual(['Recopier sous ces noms.'])
        // Aucun caractère de contrôle ne survit au tri.
        for (const m of [...aDire, ...aFaire]) expect(m.charCodeAt(0)).toBeGreaterThan(31)
    })

    test('garde l\'ordre d\'origine dans chaque bloc', () => {
        const { aDire } = trierMentions(['a', prescrire('x'), 'b', prescrire('y'), 'c'])
        expect(aDire).toEqual(['a', 'b', 'c'])
    })

    test('ne rend rien quand il n\'y a rien', () => {
        expect(trierMentions([])).toEqual({ aDire: [], aFaire: [] })
    })
})
