import { describe, expect, it } from 'bun:test'
import { construireResume } from './fil'

/**
 * Le résumé d'état — la seule mémoire du fil, construite en code.
 *
 * Un résumé rédigé par le modèle pourrait embellir ou inventer ; celui-ci ne contient que
 * des faits extraits. C'est lui que la reformulation lira au tour suivant : s'il perd les
 * identifiants, « comment j'isole ? » perd sa machine.
 */
describe('construireResume', () => {
    it('porte la requête, les identifiants et les types d\'une réponse de données', () => {
        const r = construireResume({
            issue: 'reponse',
            citations: [],
            donnees: {
                requete: 'GET /api/incidents/liste?severity=P1',
                corps: { resultats: [{ id: 'INC-EX01', type: 'malware', machines: [{ nom: 'srv-exemple-01' }] }] },
                mentions: [],
            },
        })
        expect(r).toContain('GET /api/incidents/liste?severity=P1')
        // L'ÉTIQUETAGE EST LA MÉMOIRE : chaque valeur porte sa nature. Le premier essai
        // réel a produit « isoler les machines INC-EX01 et srv-exemple-01 » — un identifiant
        // d'incident promu machine — parce que le résumé les mettait dans le même sac.
        expect(r).toContain("identifiants d'incident : INC-EX01")
        expect(r).toContain('machines : srv-exemple-01')
        expect(r).toContain("types d'incident : malware")
    })

    it('ne laisse pas un type hors vocabulaire se faire passer pour un type d\'incident', () => {
        // Le `type: "QEMU"` de la machine était entré tel quel — « de type malware et
        // QEMU » dans la reformulation.
        const r = construireResume({
            issue: 'reponse', citations: [],
            donnees: { requete: 'GET /x', corps: { resultats: [{ type: 'malware', machines: [{ type: 'QEMU' }] }] }, mentions: [] },
        })
        expect(r).toContain('malware')
        expect(r).not.toContain('QEMU')
    })

    it('étiquette les fiches citées comme des documents, jamais comme des incidents', () => {
        // « l'incident INC-04 » : la reformulation avait pris une référence de fiche pour
        // un identifiant, et l'orientation a appelé /api/incidents/INC-04/machines.
        const r = construireResume({
            issue: 'reponse',
            citations: [{ reference: 'INC-04' }] as any,
            donnees: undefined,
        })
        expect(r).toContain('PAS des incidents')
    })

    it('porte les références citées d\'une réponse documentaire', () => {
        const r = construireResume({
            issue: 'reponse',
            citations: [
                { reference: 'INC-04' }, { reference: 'ANX-J' }, { reference: 'INC-04' },
            ] as any,
            donnees: undefined,
        })
        expect(r).toContain('INC-04')
        expect(r).toContain('ANX-J')
        // Dédoublonné : une fiche citée dix fois est une fiche.
        expect(r.match(/INC-04/g)?.length).toBe(1)
    })

    it('dit les issues qui changent la lecture du tour suivant', () => {
        expect(construireResume({ issue: 'rien_ecrit', citations: [], donnees: undefined }))
            .toContain('sans réponse')
        expect(construireResume({ issue: 'echec_source', citations: [], donnees: undefined }))
            .toContain("n'a pas répondu")
    })

    it('reste court par construction — il repart dans chaque requête', () => {
        const corps = { resultats: Array.from({ length: 200 }, (_, i) => ({ id: `INC-${i}`, type: 'malware' })) }
        const r = construireResume({
            issue: 'reponse', citations: [],
            donnees: { requete: 'GET /x', corps, mentions: [] },
        })
        expect(r.length).toBeLessThanOrEqual(500)
    })

    it('résiste à un corps nul ou cyclique', () => {
        const a: any = { id: 'X' }
        a.soi = a
        expect(() => construireResume({ issue: 'reponse', citations: [], donnees: { requete: 'r', corps: a, mentions: [] } })).not.toThrow()
        expect(construireResume({ issue: 'reponse', citations: [], donnees: undefined })).toBe('')
    })
})

describe('le système des machines traverse le fil', () => {
    const REPONSE = {
        issue: 'reponse' as const, citations: [],
        donnees: {
            requete: 'GET /api/incidents/liste?severity=P1&avecMachines=true',
            mentions: [],
            corps: {
                resultats: [{
                    id: 'INC-EX01', type: 'malware', severity: 'critical',
                    machines: [{ nom: 'srv-exemple-01', type: 'QEMU', os: 'Debian GNU/Linux 10 (buster)' }],
                }],
            },
        },
    }

    it('porte le système, étiqueté comme tel', () => {
        // Sans lui, « comment je confine dans ce cas ? » rendait les trois systèmes sans
        // dire lequel s'applique : le fil ne savait pas que la machine était Debian.
        // « valeurs brutes de l'inventaire » : le tour suivant a pris l'une de ces chaînes
        // — « Microsoft Windows 10 Professionnel 22H2 » — pour la définition de
        // « Windows 10 », et a rétréci un décompte sans que ça se voie.
        const r = construireResume(REPONSE)
        expect(r).toContain("systèmes des machines citées (valeurs brutes de l'inventaire) : Debian GNU/Linux 10 (buster)")
    })

    it('ne le confond ni avec la machine ni avec le type d\'incident', () => {
        const r = construireResume(REPONSE)
        expect(r).toContain('machines : srv-exemple-01')
        expect(r).toContain("types d'incident : malware")
        // `type: QEMU` reste dehors — c'est le type d'une VM, pas d'un incident.
        expect(r).not.toContain('QEMU')
    })

    it('se tait quand aucune machine ne porte de système', () => {
        expect(construireResume({
            issue: 'reponse', citations: [],
            donnees: { requete: 'GET /api/x', mentions: [], corps: { resultats: [{ id: 'A' }] } },
        })).not.toContain('systèmes')
    })
})

/**
 * UN `id` N'EST PAS TOUJOURS UN IDENTIFIANT D'INCIDENT.
 *
 * L'extraction étiquetait tout champ `id` ainsi — vrai chez Sniff, où le fil est né, faux
 * partout ailleurs. Depuis que le Catalogue rend des ventilations, une réponse porte des
 * identifiants de composante, de service, de département. Les faire traverser sous
 * l'étiquette « incident » reproduirait le défaut qui a produit
 * `/api/incidents/INC-04/machines` : une valeur juste, sous une nature fausse.
 */
describe("l'identifiant porte la nature de l'endroit où il a été trouvé", () => {
    const resume = (requete: string, corps: unknown) =>
        construireResume({ issue: 'reponse', citations: [], donnees: { requete, corps, mentions: [] } })

    it('nomme un identifiant de ventilation par son axe, avec son libellé', () => {
        const r = resume('GET /api/serveurs/resume', {
            ventilations: { composanteId: { total: 912, lignes: [{ id: 'cmp7x', libelle: 'UFR ST', nombre: 213 }] } },
        })
        expect(r).toContain('identifiants composanteId')
        // LE COUPLE, pas l'identifiant seul : le libellé est ce que l'utilisateur écrit,
        // l'identifiant ce que le filtre exige. Sans les deux, le croisement est impossible.
        expect(r).toContain('UFR ST = cmp7x')
        expect(r).not.toContain("identifiants d'incident")
    })

    it("garde l'étiquette « incident » sur une route d'incidents", () => {
        const r = resume('GET /api/incidents?severity=P1', { resultats: [{ id: 'INC-EX01', type: 'malware' }] })
        expect(r).toContain("identifiants d'incident : INC-EX01")
    })

    it("nomme par la route quand rien ne l'entoure, plutôt que de perdre l'identifiant", () => {
        const r = resume('GET /api/serveurs?pageSize=50', { rows: [{ id: 'srv1', nom: 'srv-exemple-01' }] })
        expect(r).toContain('identifiants serveurs')
        expect(r).toContain('srv-exemple-01 = srv1')
    })
})
