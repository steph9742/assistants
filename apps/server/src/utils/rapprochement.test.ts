import { describe, expect, test } from "bun:test";
import { partitionsDiscordantes, valeursDePartition } from "./rapprochement";
import type { Partition } from "./lectures";

// L'HISTOIRE QUE CES ESSAIS FIGENT.
//
// Tant que les deux notes disaient « MACHINES » en prose, la question n'était pas décidable.
// `population` la décide, et ces essais tiennent les deux moitiés de la règle : ce qui doit
// concorder, et ce qu'il ne faut surtout pas rapprocher.

const GLPI: Partition = {
    route: '/api/eol/etat', chemin: 'resume', vocabulaire: 'technologie.eolStatut',
    population: 'glpi_machine',
    cles: ['machinesDepassees', 'machinesOk'],
    alias: { machinesDepassees: 'depasse', machinesOk: 'ok' },
}
const CATALOGUE: Partition = {
    route: '/api/technologies/parc', chemin: 'comptes.machinesParEolStatut',
    vocabulaire: 'technologie.eolStatut', population: 'serveur+poste_travail',
    cles: ['depasse', 'ok'],
}

describe("l'alias rend deux décomptes comparables", () => {
    test('ramène les compteurs aux valeurs du vocabulaire', () => {
        expect(valeursDePartition({ resume: { machinesDepassees: 612, machinesOk: 5481 } }, GLPI))
            .toEqual({ depasse: 612, ok: 5481 })
    })

    test('rend null quand le bloc est absent, plutôt qu\'un objet vide', () => {
        // Un objet vide se rapprocherait silencieusement de tout : il faut distinguer
        // « rien à comparer » de « toutes les valeurs à zéro ».
        expect(valeursDePartition({}, GLPI)).toBeNull()
        expect(valeursDePartition({ resume: null }, GLPI)).toBeNull()
    })

    test('ignore un compteur non numérique au lieu de le convertir', () => {
        expect(valeursDePartition({ resume: { machinesDepassees: null, machinesOk: 5 } }, GLPI))
            .toEqual({ ok: 5 })
    })
})

describe('rapprochement entre partitions', () => {
    /**
     * LE CAS QUI NOUS A FAIT CRIER À LA RÉGRESSION. 612 contre 581 sur le même vocabulaire :
     * l'écart est ATTENDU, les populations étant différentes. Un contrôle qui le signalerait
     * dépenserait du crédit auprès du fournisseur pour une question mal posée.
     */
    test('ne rapproche pas deux populations différentes', () => {
        expect(partitionsDiscordantes([
            { p: GLPI, valeurs: { depasse: 612, ok: 5481 } },
            { p: CATALOGUE, valeurs: { depasse: 581, ok: 944 } },
        ])).toEqual([])
    })

    test('signale un écart entre deux partitions de la MÊME population', () => {
        const jumelle: Partition = { ...CATALOGUE, chemin: 'comptes.autreVue', population: 'glpi_machine' }
        const r = partitionsDiscordantes([
            { p: GLPI, valeurs: { depasse: 612, ok: 5481 } },
            { p: jumelle, valeurs: { depasse: 581, ok: 5481 } },
        ])
        expect(r).toHaveLength(1)
        expect(r[0]!.valeur).toBe('depasse')
        expect(r[0]!.ecarts.map(e => e.n).sort()).toEqual([581, 612])
        // `ok` concorde : rien à en dire.
        expect(r.map(x => x.valeur)).not.toContain('ok')
    })

    /**
     * SANS POPULATION DÉCLARÉE, AUCUN RAPPROCHEMENT. Rapprocher au jugé recréerait
     * l'ambiguïté qu'on vient de lever, et produirait des régressions imaginaires.
     */
    test('laisse dehors une partition sans population', () => {
        const muette: Partition = { ...GLPI, chemin: 'autre', population: undefined }
        expect(partitionsDiscordantes([
            { p: muette, valeurs: { depasse: 1 } },
            { p: { ...muette, chemin: 'encore' }, valeurs: { depasse: 999 } },
        ])).toEqual([])
    })

    test('ne compare pas une valeur qu\'une seule partition porte', () => {
        const jumelle: Partition = { ...GLPI, chemin: 'autre' }
        expect(partitionsDiscordantes([
            { p: GLPI, valeurs: { depasse: 612, ok: 5481 } },
            { p: jumelle, valeurs: { depasse: 612 } },
        ])).toEqual([])
    })

    test('une partition seule dans sa population ne se compare à rien', () => {
        expect(partitionsDiscordantes([{ p: GLPI, valeurs: { depasse: 612 } }])).toEqual([])
    })
})

/**
 * UN CROISEMENT NE SE RAPPROCHE PAS D'UNE PARTITION SIMPLE. `machinesParFamilleEtStatut`
 * porte des OBJETS. Le Catalogue l'a signalé avec `sousPartition`, et pour une raison à
 * retenir : un contrôle de complétude qui sommerait ces valeurs additionnerait des objets
 * « sans erreur ni signal » — `{} + {}` ne lève rien en JavaScript.
 */
describe('les croisements restent hors du rapprochement', () => {
    const SIMPLE: Partition = {
        route: '/api/eol/etat', chemin: 'resume.machinesParStatut',
        vocabulaire: 'technologie.eolStatut', population: 'glpi_machine', cles: ['depasse'],
    }
    const CROISEMENT: Partition = {
        route: '/api/eol/etat', chemin: 'resume.machinesParFamilleEtStatut',
        vocabulaire: 'technologie.eolStatut', population: 'glpi_machine',
        cles: ['depasse'], sousPartition: 'technologie.famille',
    }

    test("n'oppose pas un objet à un nombre", () => {
        // Sans la garde, chaque valeur du croisement deviendrait une discordance : un rouge
        // de masse sur un bloc parfaitement sain.
        expect(partitionsDiscordantes([
            { p: SIMPLE, valeurs: { depasse: 611 } },
            { p: CROISEMENT, valeurs: { depasse: 0 } },
        ])).toEqual([])
    })

    test('rapproche toujours deux partitions simples de la même population', () => {
        expect(partitionsDiscordantes([
            { p: SIMPLE, valeurs: { depasse: 611 } },
            { p: { ...SIMPLE, chemin: 'autre' }, valeurs: { depasse: 581 } },
        ])).toHaveLength(1)
    })
})
