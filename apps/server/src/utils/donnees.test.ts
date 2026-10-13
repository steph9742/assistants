import { describe, expect, it } from 'bun:test'
import { construireChemin, enTexte, filtresEcartes, lacunesApplicables, mentionFiltreEcarte, valeursAdmises } from './donnees'

// Ces essais portent sur la distinction que le contrat de lecture existe pour permettre :
// « on a regardé, il n'y a rien » contre « personne n'a regardé ». Aucun champ ne la porte
// à lui seul, et une réponse qui la manque est rassurante et fausse.

describe('confrontation aux angles morts du Catalogue', () => {
    const lacunes = {
        domainesConnus: ['acces', 'certificats', 'conformite', 'connecteurs', 'edr',
            'listes-blanches', 'parc', 'rgpd', 'risques'],
        domainesExamines: ['conformite', 'edr', 'listes-blanches', 'parc', 'certificats'],
        domainesAvecLacune: ['edr', 'parc'],
        resultats: [
            { domaine: 'edr', gravite: 'aveugle', combien: 214, sur: 214, pourquoi: "Le connecteur EDR n'a jamais abouti ; l'écart n'est pas calculable." },
            { domaine: 'parc', gravite: 'partiel', combien: 12, sur: 480, pourquoi: 'Douze fiches GLPI sont des doublons.' },
        ],
    }

    it('répercute le « pourquoi » d\'un domaine aveugle, tel qu\'il est rédigé', () => {
        const m = lacunesApplicables(lacunes, ['edr'])
        expect(m).toHaveLength(1)
        expect(m[0]).toContain('ANGLE MORT')
        expect(m[0]).toContain("Le connecteur EDR n'a jamais abouti")
    })

    it('distingue une information incomplète d\'un angle mort', () => {
        expect(lacunesApplicables(lacunes, ['parc'])[0]).toContain('Information incomplète')
        expect(lacunesApplicables(lacunes, ['parc'])[0]).toContain('12 sur 480')
    })

    // « Information incomplète sur « connecteurs » (3 sur null) », vu en production. Le
    // Catalogue rend `sur: null` quand la lacune n'a pas de population de référence — ici
    // `combien` vaut 3 parce que la donnée date de trois JOURS, ce que le `pourquoi` dit
    // déjà. La parenthèse affichait « null » et, pire, faisait passer une ancienneté pour
    // une proportion.
    it('n\'affiche pas de fraction sans dénominateur', () => {
        const sansSur = {
            ...lacunes,
            domainesAvecLacune: ['connecteurs'],
            resultats: [{
                domaine: 'connecteurs', gravite: 'partiel', combien: 3, sur: null,
                pourquoi: "Les données HarfangLab décrivent l'état d'il y a 3 jours.",
            }],
        }
        const m = lacunesApplicables(sansSur, ['connecteurs'])
        expect(m).toHaveLength(1)
        expect(m[0]).not.toContain('null')
        // Le numérateur seul ne se montre pas non plus : il ne veut rien dire sans population.
        expect(m[0]).not.toContain('3 sur')
        expect(m[0]).toContain("l'état d'il y a 3 jours")
    })

    /**
     * LES TROIS UNITÉS, relevées par le Catalogue après notre signalement. Le troisième
     * sens est celui qu'aucun de nous n'avait vu : sur un connecteur jamais lancé,
     * `combien: 1` veut dire « oui », pas « un » — une lacune n'est empilée chez eux que
     * si `combien > 0`. C'est le seul des trois qui ressemble à un décompte plausible, et
     * notre garde précédente ne le masquait que par chance.
     */
    const avecUnite = (l: any) => lacunesApplicables(
        { ...lacunes, domainesAvecLacune: [l.domaine], resultats: [l] }, [l.domaine])[0] ?? ''

    it('affiche la fraction des seules lacunes qui en ont une', () => {
        const m = avecUnite({ domaine: 'parc', gravite: 'partiel', unite: 'fiches', combien: 31, sur: 8903, depuis: null, pourquoi: 'Doublons GLPI.' })
        expect(m).toContain('(31 sur 8903)')
    })

    it('rend une date plutôt qu\'un délai quand l\'unité est en jours', () => {
        const m = avecUnite({ domaine: 'connecteurs', gravite: 'partiel', unite: 'jours', combien: 3, sur: null, depuis: '2026-08-27', pourquoi: "État d'il y a 3 jours." })
        expect(m).toContain('dernière collecte : 2026-08-27')
        // Le délai ne doit apparaître sous AUCUNE forme numérique isolée.
        expect(m).not.toContain('3 sur')
        expect(m).not.toContain('(3)')
    })

    it('ne montre aucun nombre quand « combien » est un booléen déguisé', () => {
        const m = avecUnite({ domaine: 'edr', gravite: 'aveugle', unite: 'presence', combien: 1, sur: null, depuis: null, pourquoi: "Le connecteur n'a jamais abouti." })
        expect(m).toContain('ANGLE MORT')
        expect(m).toContain("n'a jamais abouti")
        // « (1 sur …) », « (1) » : un « oui » ne se compte pas.
        expect(m).not.toMatch(/\(\s*1\b/)
    })

    it('se tait devant une unité qu\'il ne connaît pas', () => {
        // Un quatrième sens ajouté demain doit nous rendre muets, pas inventifs.
        const m = avecUnite({ domaine: 'parc', gravite: 'partiel', unite: 'octets', combien: 4096, sur: 8903, depuis: null, pourquoi: 'Volume non collecté.' })
        expect(m).toContain('Volume non collecté')
        expect(m).not.toContain('4096')
    })

    it('refuse un dénominateur sur une unité qui n\'en admet pas', () => {
        // « 34 jours sur 8800 » n'a pas de référent. Le Catalogue l'interdit chez lui ; on
        // ne s'en remet pas à ça pour l'afficher.
        const m = avecUnite({ domaine: 'connecteurs', gravite: 'partiel', unite: 'jours', combien: 34, sur: 8800, depuis: null, pourquoi: 'Collecte interrompue.' })
        expect(m).not.toContain('8800')
        expect(m).not.toContain('34 sur')
    })

    it('reste juste devant un Catalogue qui ne déclare pas encore d\'unité', () => {
        // Compatibilité descendante : un dénominateur utilisable est alors la seule chose
        // qui distingue encore un vrai décompte.
        expect(avecUnite({ domaine: 'parc', gravite: 'partiel', combien: 12, sur: 480, pourquoi: 'Doublons.' })).toContain('(12 sur 480)')
        expect(avecUnite({ domaine: 'edr', gravite: 'aveugle', combien: 1, sur: null, pourquoi: 'Jamais abouti.' })).not.toMatch(/\(\s*1\b/)
    })

    it('ne dit rien d\'un domaine examiné et sain', () => {
        expect(lacunesApplicables(lacunes, ['conformite'])).toHaveLength(0)
    })

    // Le cas qu'on ne voyait pas : quatre domaines remontés sur sept demandés se lisait
    // « les trois autres vont bien », alors qu'ils pouvaient n'avoir jamais été regardés.
    // `domainesConnus` permet enfin de trancher : connu mais non examiné = hors portée.
    it('dit HORS PORTÉE d\'un domaine connu mais non examiné', () => {
        const m = lacunesApplicables(lacunes, ['risques'])
        expect(m).toHaveLength(1)
        expect(m[0]).toContain('HORS DE LA PORTÉE')
        expect(m[0]).toContain('scope « read »')
    })

    // L'erreur qui nous a coûté six étiquettes sur onze. Sans cette branche, une question
    // rattachée à `tiers` n'aurait JAMAIS été confrontée à un angle mort, en silence.
    it('dénonce comme un défaut de l\'assistant une étiquette qui n\'existe pas', () => {
        const m = lacunesApplicables(lacunes, ['tiers'])
        expect(m).toHaveLength(1)
        expect(m[0]).toContain("DÉFAUT DE L'ASSISTANT")
        expect(m[0]).toContain('questions.ts')
        // Et surtout : ne PAS accuser la portée de la clé, qui n'y est pour rien.
        expect(m[0]).not.toContain('PORTÉE de la clé')
    })

    it('traite chaque domaine d\'une question à part', () => {
        const m = lacunesApplicables(lacunes, ['edr', 'conformite', 'risques'])
        expect(m).toHaveLength(2)
        expect(m.some(x => x.includes('ANGLE MORT'))).toBe(true)
        expect(m.some(x => x.includes('HORS DE LA PORTÉE'))).toBe(true)
    })

    it('signale un Catalogue antérieur au correctif plutôt que de conclure', () => {
        const m = lacunesApplicables({ resultats: [] }, ['edr'])
        expect(m.some(x => x.includes('27 août 2026'))).toBe(true)
    })

    it('ne dit rien pour une question rattachée à aucun domaine', () => {
        expect(lacunesApplicables(lacunes, [])).toHaveLength(0)
    })
})

// -------------------------------------------------------------------------------------

/**
 * Le 422 n'est pas un refus, et il doit dire quelle valeur a été refusée.
 */
describe('valeursAdmises — extraire les littéraux du corps de validation', () => {
    it("va chercher les `const` là où Elysia les noie", () => {
        const corps = {
            property: '/severity',
            summary: "Property 'severity' should be one of: 'string', 'string'",
            found: { severity: 'P1' },
            errors: [{ schema: { anyOf: [{ const: 'low' }, { const: 'high' }] } }],
        }
        expect(valeursAdmises(corps)).toEqual(['low', 'high'])
    })

    it('lit aussi un `enum`', () => {
        expect(valeursAdmises({ expected: { enum: ['ouvert', 'clos'] } })).toEqual(['ouvert', 'clos'])
    })

    // Quand la source n'énumère rien, on ne doit pas inventer : le message dira qu'elle
    // n'énumère pas, ce qui est une information exacte.
    it('rend une liste vide plutôt que de deviner', () => {
        expect(valeursAdmises({ property: '/severity', found: { severity: 'P1' } })).toEqual([])
    })

    it('ne boucle pas sur un schéma qui se référence lui-même', () => {
        const boucle: any = { const: 'a' }
        boucle.self = boucle
        expect(() => valeursAdmises({ expected: boucle })).not.toThrow()
    })
})

// -------------------------------------------------------------------------------------

describe('construireChemin — les trous du chemin déclaré', () => {
    const bati = (chemin: string, params: Record<string, string>) => {
        const qs = new URLSearchParams(params)
        const c = construireChemin(chemin, params, qs)
        return { chemin: c, reste: qs.toString() }
    }

    it('substitue et retire le paramètre de la requête', () => {
        expect(bati('/api/incidents/{id}/conduite', { id: '42' }))
            .toEqual({ chemin: '/api/incidents/42/conduite', reste: '' })
    })

    it('laisse les autres paramètres dans la requête', () => {
        const r = bati('/api/edr/regles/{moteur}', { moteur: 'sigma', q: 'mimikatz' })
        expect(r.chemin).toBe('/api/edr/regles/sigma')
        expect(r.reste).toBe('q=mimikatz')
    })

    it('encode une valeur qui contient une barre oblique', () => {
        expect(bati('/api/dossier/application/{nom}', { nom: 'Moodle/Test' }).chemin)
            .toBe('/api/dossier/application/Moodle%2FTest')
    })

    /**
     * Un trou non renseigné reste visible. Substituer une chaîne vide produirait
     * `/api/incidents//conduite` — une URL plausible qui répondrait autre chose, et dont
     * l'erreur ne se lirait nulle part.
     */
    it('laisse le trou tel quel plutôt que de bâtir une URL plausible', () => {
        expect(bati('/api/incidents/{id}/conduite', {}).chemin).toBe('/api/incidents/{id}/conduite')
        expect(bati('/api/incidents/{id}/conduite', { id: '' }).chemin).toBe('/api/incidents/{id}/conduite')
    })

    it('ne touche pas un chemin sans trou', () => {
        expect(bati('/api/lacunes', { jours: '30' }))
            .toEqual({ chemin: '/api/lacunes', reste: 'jours=30' })
    })
})

// -------------------------------------------------------------------------------------

/**
 * `params` vient d'un JSON écrit par le modèle : rien ne garantit le type de ses valeurs.
 * Un `pageSize: 5` au lieu de `"5"` faisait planter l'appel sur
 * « params[p.cle]?.trim is not a function » — une question perdue sur un message de
 * JavaScript, là où la valeur était utilisable.
 */
describe('enTexte — ce que le modèle rend n\'est pas toujours une chaîne', () => {
    it('accepte une chaîne, un nombre, un booléen', () => {
        expect(enTexte('  sigma ')).toBe('sigma')
        expect(enTexte(5)).toBe('5')
        expect(enTexte(true)).toBe('true')
    })

    it('écarte le vide sans le confondre avec une valeur', () => {
        expect(enTexte('')).toBe('')
        expect(enTexte('   ')).toBe('')
        expect(enTexte(null)).toBe('')
        expect(enTexte(undefined)).toBe('')
    })

    /**
     * `String(['a','b'])` donnerait « a,b » : une chaîne plausible qui partirait dans l'URL
     * sans que personne ait décidé qu'elle a un sens. On préfère écarter le paramètre.
     */
    it('écarte un tableau ou un objet plutôt que d\'en deviner la forme', () => {
        expect(enTexte(['a', 'b'])).toBe('')
        expect(enTexte({ q: 'x' })).toBe('')
    })

    it('écarte NaN et l\'infini, qui ne sont pas des valeurs de requête', () => {
        expect(enTexte(Number.NaN)).toBe('')
        expect(enTexte(Number.POSITIVE_INFINITY)).toBe('')
    })
})

/**
 * LE FAUX POSITIF QUI A COÛTÉ UNE RÉPONSE.
 *
 * « FILTRE NON APPLIQUÉ : catalogue=serveurs » sur une requête où il l'était parfaitement.
 * `construireChemin` retire de la chaîne de requête les paramètres substitués dans le
 * CHEMIN — `/api/{catalogue}` consomme `catalogue` — et la comparaison se faisait après.
 */
describe('les filtres demandés qui ne sont pas partis', () => {
    const PARAMS = [
        { cle: 'catalogue', valeurs: ['serveurs', 'postes-travail'] },
        { cle: 'criticite', valeurs: ['vitale', 'critique'] },
    ]

    it('ne signale pas un paramètre de chemin, qui est appliqué', () => {
        // `appliques` est photographié AVANT la substitution : c'est tout le correctif.
        expect(filtresEcartes({ catalogue: 'serveurs' }, new Set(['catalogue']), PARAMS)).toEqual([])
    })

    it('signale une valeur hors du vocabulaire, avec les valeurs admises', () => {
        const r = filtresEcartes({ criticite: 'urgente' }, new Set(), PARAMS)
        expect(r).toHaveLength(1)
        expect(r[0]).toContain('criticite=urgente')
        expect(r[0]).toContain('vitale, critique')
    })

    it('signale un champ que la question ne connaît pas', () => {
        const r = filtresEcartes({ q: 'ST' }, new Set(), PARAMS)
        expect(r[0]).toContain('ne sait pas filtrer')
    })

    it('ignore une valeur vide, qui n\'est pas une demande', () => {
        expect(filtresEcartes({ criticite: '' }, new Set(), PARAMS)).toEqual([])
    })
})

/**
 * UN REFUS EST AUSSI UNE RÉPONSE FAUSSE — simplement une qui a l'air prudente.
 */
describe('un filtre non appliqué ne rend pas la réponse impossible', () => {
    const ec = ['`q` (cette question ne sait pas filtrer là-dessus)']

    it('renvoie vers la répartition quand la réponse en porte une', () => {
        const m = mentionFiltreEcarte(ec, { ventilations: { composanteId: { lignes: [] } }, total: 912 })
        expect(m).toContain('RÉPARTITION')
        expect(m).toContain('composanteId')
        expect(m).toContain('avant de conclure à l\'absence')
    })

    it('dit ce que le total ne prouve pas, dans tous les cas', () => {
        for (const corps of [{ total: 912 }, { ventilations: { composanteId: {} } }]) {
            expect(mentionFiltreEcarte(ec, corps)).toContain("l'ENSEMBLE")
        }
    })

    it('renvoie vers le filtre quand rien ne porte la valeur séparément', () => {
        const m = mentionFiltreEcarte(ec, { total: 912, rows: [] })
        expect(m).not.toContain('RÉPARTITION')
        expect(m).toContain("s'obtient en filtrant")
    })
})
