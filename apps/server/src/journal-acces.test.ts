// UNE TRACE D'ACCÈS QUI RECOPIE LA QUESTION VIDE UNE PROMESSE.
//
// L'outil des journaux ne persiste rien de ce qu'on lui donne, pas même une empreinte. Une
// ligne de journal serveur qui contiendrait l'extrait collé annulerait cette garantie par la
// porte de derrière — et personne ne penserait à la chercher là.

import { describe, expect, test, mock } from "bun:test";
import { Elysia } from "elysia";

/** Le journal d'accès, à l'identique de `index.ts` — même forme, même retenue. */
function journalAcces() {
    const debuts = new WeakMap<Request, number>()
    return new Elysia({ name: 'journal-acces' })
        .onRequest(({ request }) => { debuts.set(request, performance.now()) })
        .onAfterResponse(({ request, set }) => {
            const debut = debuts.get(request)
            const ms = debut === undefined ? '?' : `${Math.round(performance.now() - debut)}ms`
            console.log(`${request.method} ${new URL(request.url).pathname} ${set.status ?? 200} ${ms}`)
        })
        // Les crochets d'un greffon Elysia sont LOCAUX par défaut : sans cette ligne, le
        // journal ne trace que les routes du greffon — c'est-à-dire aucune.
        .as('global')
}

async function lignes(appel: (app: any) => Promise<unknown>): Promise<string[]> {
    const sorties: string[] = []
    const vrai = console.log
    console.log = mock((...a: unknown[]) => { sorties.push(a.join(' ')) })
    try {
        const app = new Elysia()
            .use(journalAcces())
            .get('/api/sante', () => ({ ok: true }))
            .post('/api/assistant/question', () => ({ reponse: 'ok' }))
        await appel(app)
        // `onAfterResponse` court après la réponse : on laisse la boucle tourner une fois.
        await new Promise(r => setTimeout(r, 10))
    }
    finally { console.log = vrai }
    return sorties
}

describe("le journal d'accès", () => {
    test('trace la méthode, le chemin, le code et la durée', async () => {
        const [ligne] = await lignes(app => app.handle(new Request('http://localhost/api/sante')))
        expect(ligne).toMatch(/^GET \/api\/sante 200 \d+ms$/)
    })

    /**
     * LE CŒUR DE L'ESSAI. Une question de l'outil 3 porte un extrait de journal collé —
     * adresses, identifiants, parfois un nom. Rien de tout cela ne doit ressortir ici.
     */
    test("ne recopie ni la question posée ni le corps de la requête", async () => {
        const secret = 'sshd: Failed password for jdupont from 10.42.3.7'
        const [ligne] = await lignes(app => app.handle(new Request('http://localhost/api/assistant/question', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ question: secret }),
        })))
        expect(ligne).toContain('/api/assistant/question')
        expect(ligne).not.toContain('jdupont')
        expect(ligne).not.toContain('10.42.3.7')
        expect(ligne).not.toContain('Failed password')
    })

    /**
     * LE CHRONOMÈTRE EST PAR REQUÊTE. Avec le `store` partagé d'Elysia, deux questions
     * simultanées s'écrasent leur heure de départ et l'une hérite de la durée de l'autre —
     * exactement le chiffre sur lequel on s'appuierait pour diagnostiquer une lenteur.
     */
    test('chronomètre chaque requête pour elle-même', async () => {
        const sorties = await lignes(async (app) => {
            await Promise.all([
                app.handle(new Request('http://localhost/api/sante')),
                app.handle(new Request('http://localhost/api/sante')),
            ])
        })
        expect(sorties).toHaveLength(2)
        for (const l of sorties) expect(l).toMatch(/ \d+ms$/)
    })
})
