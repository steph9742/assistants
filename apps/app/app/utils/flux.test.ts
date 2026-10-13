import { describe, expect, it } from 'bun:test'
import { decouperTrames } from './flux'

const trame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`

describe('decouperTrames', () => {
    it('lit plusieurs événements arrivés dans le même paquet', () => {
        const { evenements, reste } = decouperTrames(trame({ etape: 'orientation' }) + trame({ etape: 'recherche' }))
        expect(evenements).toEqual([{ etape: 'orientation' }, { etape: 'recherche' }])
        expect(reste).toBe('')
    })

    it('garde une trame coupée en deux et la rend au paquet suivant', () => {
        // Le cas qui se perd en silence : l'étape n'apparaîtrait jamais, sans erreur.
        const entier = trame({ etape: 'redaction', passages: 12 })
        const coupe = entier.length - 8
        const premier = decouperTrames(entier.slice(0, coupe))
        expect(premier.evenements).toEqual([])

        const second = decouperTrames(premier.reste + entier.slice(coupe))
        expect(second.evenements).toEqual([{ etape: 'redaction', passages: 12 }])
    })

    it('laisse passer une trame illisible sans interrompre le flux', () => {
        const { evenements } = decouperTrames(`data: {ceci n'est pas du json}\n\n${trame({ etape: 'recherche' })}`)
        expect(evenements).toEqual([{ etape: 'recherche' }])
    })

    it('ignore les lignes de service et les blocs sans données', () => {
        const { evenements } = decouperTrames(`: battement\n\n${trame({ etape: 'orientation' })}`)
        expect(evenements).toEqual([{ etape: 'orientation' }])
    })

    it('rend un tampon vide sans rien produire', () => {
        expect(decouperTrames('')).toEqual({ evenements: [], reste: '' })
    })
})
