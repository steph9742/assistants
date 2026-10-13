import { describe, expect, it } from 'bun:test'
import { mentionsDeValeurs, REGLES_VALEURS } from './valeurs'

/**
 * Ces essais portent sur la couche qui ne dépend d'AUCUNE déclaration.
 *
 * Les post-conditions par question ne s'appliquent qu'aux routes qu'on a pensé à qualifier.
 * Celle-ci s'applique à toute réponse — c'est ce qui rend un accès libre en lecture
 * envisageable, et c'est donc elle qui doit tenir.
 */
describe('pièges qui tiennent au champ, pas à la route', () => {
    it('lit `traite: null` comme une question non tranchée', () => {
        const m = mentionsDeValeurs({ donneesPersonnelles: { traite: null } })
        expect(m).toHaveLength(1)
        expect(m[0]).toContain("N'A PAS ÉTÉ TRANCHÉE")
        expect(m[0]).toContain("n'est pas une réponse négative")
    })

    it('lit `agentEdr: "inconnu"` comme un connecteur jamais abouti', () => {
        const m = mentionsDeValeurs({ resultats: [{ agentEdr: 'inconnu' }] })
        expect(m[0]).toContain("n'a jamais abouti")
        expect(m[0]).toContain('PAS « absent »')
    })

    it('distingue `changements: null` de `[]`', () => {
        expect(mentionsDeValeurs({ changements: null })[0]).toContain('premier relevé')
        expect(mentionsDeValeurs({ changements: [] })).toHaveLength(0)
    })

    it('lit `lisible: false` comme un défaut de portée, pas un référentiel vide', () => {
        expect(mentionsDeValeurs({ nis2: { lisible: false } })[0]).toContain('HORS DE LA PORTÉE')
    })

    // Descend dans toute la structure : la trentième ligne compte autant que la première.
    it('trouve la valeur au fond d\'un tableau imbriqué', () => {
        const corps = { resultats: [{ machines: [{ agentEdr: 'present' }, { agentEdr: 'inconnu' }] }] }
        expect(mentionsDeValeurs(corps)).toHaveLength(1)
    })

    /**
     * Une règle ne se déclenche qu'une fois. Répéter trente fois la même phrase noierait la
     * réponse — exactement ce que ce dispositif cherche à éviter.
     */
    it('ne dit la même chose qu\'une fois, en comptant les occurrences', () => {
        const m = mentionsDeValeurs({ r: [{ agentEdr: 'inconnu' }, { agentEdr: 'inconnu' }, { agentEdr: 'inconnu' }] })
        expect(m).toHaveLength(1)
        expect(m[0]).toContain('(3 occurrences)')
    })

    it('ne dit rien d\'une réponse sans piège', () => {
        expect(mentionsDeValeurs({ total: 4, resultats: [{ nom: 'srv-web', agentEdr: 'present' }] })).toHaveLength(0)
    })

    it('répercute un `manques` renseigné, et se tait sur un `manques` vide', () => {
        expect(mentionsDeValeurs({ manques: ['plan', 'responsable'] })[0]).toContain('désigne elle-même')
        expect(mentionsDeValeurs({ manques: [] })).toHaveLength(0)
    })

    it('interdit de classer un `estUnEtat` dans un ordre d\'urgence', () => {
        const m = mentionsDeValeurs({ resultats: [{ estUnEtat: true }] })
        expect(m[0]).toContain("ordre d'urgence")
    })

    // Un diagnostic ne doit jamais pouvoir faire tomber une réponse.
    it('résiste à une structure cyclique', () => {
        const a: any = { agentEdr: 'inconnu' }
        a.soi = a
        expect(() => mentionsDeValeurs(a)).not.toThrow()
        expect(mentionsDeValeurs(a)).toHaveLength(1)
    })

    it('résiste à une valeur nulle ou scalaire au sommet', () => {
        for (const v of [null, undefined, 4, 'texte', true]) {
            expect(() => mentionsDeValeurs(v)).not.toThrow()
            expect(mentionsDeValeurs(v)).toHaveLength(0)
        }
    })

    // Chaque règle dit ce que la valeur signifie ET ce qu'elle ne signifie pas. C'est la
    // seconde moitié qui fait le travail : la lecture naïve est toujours la fausse.
    it('formule chaque règle en disant ce que ce n\'est PAS', () => {
        for (const r of REGLES_VALEURS) {
            if (r.cle === 'manques') continue // la seule qui ajoute au lieu de corriger
            expect(r.dit, r.cle).toMatch(/PAS|pas un|n'est pas|différent de/i)
        }
    })
})

describe('état RGPD d\'une application — trois vides qui ne se comptent pas pareil', () => {
    const dit = (corps: unknown) => mentionsDeValeurs(corps).join(' ')

    it('refuse d\'agréger « non évalué » aux écarts', () => {
        // La distinction que le Catalogue fait dans son calcul se perdrait à la lecture :
        // « personne n'a répondu » et « quelqu'un a répondu non conforme » produisent la
        // même absence de conformité, et une seule est un manquement.
        const m = dit({ resultats: [{ nom: 'Moodle', etatRgpd: 'non_evalue' }] })
        expect(m).toContain("N'A PAS ÉTÉ FAITE")
        expect(m).toContain("Ce n'est PAS un écart")
    })

    it('sort « hors périmètre » des deux décomptes', () => {
        expect(dit({ resultats: [{ etatRgpd: 'hors_perimetre' }] }))
            .toContain("n'entre dans aucun des deux décomptes")
    })

    it('ne dit rien sur un écart ou une conformité — ce sont des états mesurés', () => {
        expect(dit({ resultats: [{ etatRgpd: 'ecart' }, { etatRgpd: 'conforme' }] })).toBe('')
    })
})

describe('les champs posés après la pagination ne se comptent pas', () => {
    const dit = (corps: unknown) => mentionsDeValeurs(corps).join(' ')

    it('ne dit plus rien du statut de fin de vie — le Catalogue l\'a rendu filtrable', () => {
        // La règle a été retirée quand la source a matérialisé le champ : la garder aurait
        // interdit un décompte devenu exact. Ce que la source sait faire, elle le déclare.
        expect(dit({ rows: [{ nom: 'srv-exemple-02', eolStatut: 'depasse' }] })).toBe('')
    })

    it('renvoie « incident ouvert » vers le croisement des incidents', () => {
        const m = dit({ rows: [{ nom: 'srv-bdd', incidentOuvert: true }] })
        expect(m).toContain("depuis l'incident")
        expect(m).toContain('jamais depuis la machine')
    })

    it('se tait sur les autres valeurs de ces champs', () => {
        expect(dit({ rows: [{ eolStatut: 'supporte', incidentOuvert: false }] })).toBe('')
    })
})
