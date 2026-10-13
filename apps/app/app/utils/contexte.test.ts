import { describe, expect, it } from 'bun:test'
import { analyserResume, cleBout, pastilles, resumeSans } from './contexte'

// Le résumé tel que `construireResume` l'écrit côté serveur — c'est ce format-là, et pas un
// autre, que ces essais doivent suivre. S'il change là-bas, ils tombent ici.
const RESUME = "données : GET /api/incidents/liste?severity=P1&sort=knowledgeAt"
    + " · identifiants d'incident : INC-EX01"
    + ' · machines : srv-exemple-01, srv-exemple-02'
    + " · types d'incident : malware"
    + ' · fiches de procédure citées (documents, PAS des incidents) : INC-04, ANX-J'

describe('analyserResume', () => {
    it('sépare les groupes et leurs valeurs', () => {
        const b = analyserResume(RESUME)
        expect(b.find(x => x.label === 'machines')?.valeurs).toEqual(['srv-exemple-01', 'srv-exemple-02'])
    })

    it('garde une requête entière — une URL ne se découpe pas sur ses virgules', () => {
        const b = analyserResume(RESUME)
        expect(b[0]!.valeurs).toEqual(['GET /api/incidents/liste?severity=P1&sort=knowledgeAt'])
    })

    it('garde une phrase sans étiquette telle quelle', () => {
        const b = analyserResume('sans réponse — rien dans les sources')
        expect(b).toEqual([{ label: null, valeurs: ['sans réponse — rien dans les sources'] }])
    })

    it('rend une liste vide sur un résumé vide', () => {
        expect(analyserResume('')).toEqual([])
    })
})

describe('pastilles', () => {
    it('abrège les étiquettes écrites pour le modèle', () => {
        const p = pastilles(RESUME)
        expect(p.find(x => x.valeur === 'INC-EX01')?.groupe).toBe('incident')
        expect(p.find(x => x.valeur === 'INC-04')?.groupe).toBe('fiche')
    })

    it('fait une pastille par valeur, pas par groupe', () => {
        expect(pastilles(RESUME).filter(p => p.groupe === 'machine')).toHaveLength(2)
    })
})

describe('resumeSans', () => {
    it('retire une valeur et garde le reste du groupe', () => {
        const r = resumeSans(RESUME, new Set([cleBout('machines', 'srv-exemple-02')]))
        expect(r).toContain('machines : srv-exemple-01')
        expect(r).not.toContain('srv-exemple-02')
    })

    it('fait disparaître un groupe vidé plutôt que de laisser une étiquette nue', () => {
        // « machines : » sans machine se lirait comme un constat d'absence.
        const r = resumeSans(RESUME, new Set([
            cleBout('machines', 'srv-exemple-01'), cleBout('machines', 'srv-exemple-02'),
        ]))
        expect(r).not.toContain('machines')
        expect(r).toContain("identifiants d'incident : INC-EX01")
    })

    it('reconstruit la forme exacte du serveur quand rien n\'est retiré', () => {
        expect(resumeSans(RESUME, new Set())).toBe(RESUME)
    })

    it('rend une chaîne vide quand tout est retiré', () => {
        const tout = new Set(pastilles(RESUME).map(p => p.cle))
        expect(resumeSans(RESUME, tout)).toBe('')
    })
})
