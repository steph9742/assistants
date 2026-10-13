import { describe, expect, test } from "bun:test";
import { corrigerAdditions } from "./additions";

// LE CAS RÉEL, figé ici. Seize opérandes tous justes, dans le bon ordre, et dix unités
// perdues dans le résultat. Le modèle sait choisir quoi additionner ; il ne sait pas
// additionner.

const REEL = 'Le total de machines avec Microsoft Windows 10 est de '
    + '743 + 272 + 22 + 19 + 8 + 6 + 4 + 4 + 4 + 10 + 6 + 7 + 7 + 4 + 25 + 4 = 1135 machines.'

describe("l'addition appartient au code", () => {
    test('corrige le résultat sans toucher aux termes', () => {
        const { texte, corrections } = corrigerAdditions(REEL)
        expect(texte).toContain('= 1145 machines.')
        expect(texte).toContain('743 + 272 + 22')
        expect(corrections).toHaveLength(1)
        expect(corrections[0]).toMatchObject({ ecrit: 1135, exact: 1145 })
        expect(corrections[0]!.termes).toHaveLength(16)
    })

    test('laisse une addition juste absolument intacte', () => {
        const juste = 'Il y a 610 + 1172 + 27 = 1809 machines.'
        expect(corrigerAdditions(juste).texte).toBe(juste)
        expect(corrigerAdditions(juste).corrections).toEqual([])
    })

    /** On ne fabrique aucun total : sans addition écrite, rien à vérifier. */
    test('ne touche pas aux nombres isolés', () => {
        const t = 'Le parc compte 8862 machines, dont 611 dépassées et 1420 en support étendu.'
        expect(corrigerAdditions(t).texte).toBe(t)
    })

    test("ignore une addition à deux termes, trop courte pour être un décompte", () => {
        // Deux termes relèvent de la prose (« 4 + 4 »), pas d'une ventilation.
        const t = '2 + 3 = 6'
        expect(corrigerAdditions(t).texte).toBe(t)
    })

    test('lit les espaces de milliers et rend un résultat propre', () => {
        const { texte } = corrigerAdditions('1 000 + 100 + 45 = 1 200')
        expect(texte).toContain('= 1145')
    })

    test('corrige plusieurs additions dans le même texte', () => {
        const { corrections } = corrigerAdditions('a: 1 + 2 + 3 = 7 et b: 10 + 20 + 30 = 61')
        expect(corrections.map(c => c.exact)).toEqual([6, 60])
    })

    test('ne modifie rien quand il n\'y a pas d\'addition', () => {
        expect(corrigerAdditions('Aucun chiffre ici.').texte).toBe('Aucun chiffre ici.')
        expect(corrigerAdditions('').texte).toBe('')
    })
})

/**
 * TROIS CHEMINS RENDENT UN TEXTE AU LECTEUR — données, documents, journaux — et la
 * correction avait d'abord été branchée sur le seul où le défaut s'était montré. C'est le
 * réflexe qu'on passe la semaine à corriger chez les autres : une garantie qui s'arrête à
 * la porte où l'on a vu passer le problème.
 */
describe('la correction ne dépend pas du chemin', () => {
    test('corrige une somme quelle que soit la phrase qui la porte', () => {
        for (const phrase of [
            'Le total est de 743 + 272 + 22 = 1000 machines.',
            "La procédure compte 3 + 4 + 5 = 13 étapes.",
            'On relève 10 + 20 + 30 = 55 tentatives dans cet extrait.',
        ]) {
            const { corrections } = corrigerAdditions(phrase)
            expect(corrections).toHaveLength(1)
        }
    })
})
