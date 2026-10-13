import { Elysia, t } from "elysia";
import { db } from "@assistants/database";
import { indexSchema } from "@assistants/database/tables";
import { desc, eq, sql } from "drizzle-orm";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import { lireConfigIA } from "../utils/ia";
import { repondre, type SurEtape } from "../utils/assistant";
import { chercher, sourcesConsultees, termesDe } from "../utils/recherche";
import { calculerVecteur } from "../utils/embeddings";
import { lireNombre, lireListe } from "../utils/reglages";
import { consignerAssistant, journal } from "../utils/audit";

const MODELE_ABSENT = "Le modèle n'est pas configuré. Un administrateur doit renseigner l'adresse de l'Open WebUI, le jeton et le modèle dans les réglages."

/**
 * Le traitement d'une question, partagé par les deux routes.
 *
 * Une seule différence entre elles — le transport — et donc un seul endroit où vit ce qui
 * compte : la réponse et sa consignation au journal. Dupliquer aurait fini par faire deux
 * comportements, dont un non testé.
 */
async function traiter(
    cfg: NonNullable<Awaited<ReturnType<typeof lireConfigIA>>>,
    question: string, utilisateur: string | null,
    fil: { question: string, resume: string }[],
    surEtape?: SurEtape,
) {
    const debut = Date.now()
    const r = await repondre(cfg, question, utilisateur, fil, surEtape)
    await consignerAssistant({
        utilisateur,
        // La question COMPRISE est celle qui a réellement été cherchée : c'est elle
        // que le journal doit porter, avec l'originale entre parenthèses.
        question: r.questionComprise ? `${r.questionComprise} (tapé : ${question})` : question,
        trouve: r.trouve, citations: r.citations,
        origine: r.origine, dureeMs: Date.now() - debut,
    })
    return r
}

const CORPS_QUESTION = t.Object({
    question: t.String(),
    /**
     * Le fil : les tours précédents, tels que le serveur les a résumés. Le client
     * renvoie ce qu'il a reçu — il ne fabrique rien. Tronqué côté serveur par
     * `ia.messages_gardes`, et sans effet quand il est absent : le premier tour
     * garde exactement le comportement d'avant.
     */
    fil: t.Optional(t.Array(t.Object({
        question: t.String({ maxLength: 2000 }),
        resume: t.String({ maxLength: 600 }),
    }), { maxItems: 20 })),
})

export const assistantRouter = new Elysia({ name: 'assistant', prefix: '/api/assistant', tags: ['Assistant'] })
    .use(authMiddleware)

    .post('/question', async ({ body, utilisateur, status }) => {
        const question = body.question.trim()
        if (!question) return status(400, { erreur: 'Question vide.' })

        const cfg = await lireConfigIA('assistant')
        if (!cfg) return status(503, { erreur: MODELE_ABSENT })

        try {
            return await traiter(cfg, question, utilisateur?.email ?? null, body.fil ?? [])
        }
        catch (e) {
            return status(502, { erreur: e instanceof Error ? e.message : String(e) })
        }
    }, {
        body: CORPS_QUESTION,
    })

    /**
     * LA MÊME QUESTION, EN DISANT OÙ ELLE EN EST.
     *
     * Même traitement, même réponse, même consignation : seul le transport change. Les
     * étapes partent au fur et à mesure, la réponse complète en dernier événement.
     */
    .post('/question-flux', async ({ body, utilisateur }) => {
        const question = body.question.trim()
        const cfg = await lireConfigIA('assistant')
        const email = utilisateur?.email ?? null
        const encodeur = new TextEncoder()

        /**
         * LE JOURNAL D'ACCÈS MENT SUR LES FLUX, ET IL FAUT QU'IL LE DISE.
         *
         * `POST /api/assistant/question-flux 200 8ms` : le crochet de fin de réponse court
         * quand les EN-TÊTES partent, pas quand le flux se termine. Huit millisecondes pour
         * une question qui en a pris soixante-deux — et c'est justement sur cette ligne
         * qu'on s'appuie pour diagnostiquer une lenteur. Un journal qui mesure autre chose
         * que ce qu'on croit est pire que pas de journal : il rassure.
         */
        const debut = performance.now()

        const flux = new ReadableStream<Uint8Array>({
            async start(controleur) {
                const envoyer = (o: unknown) => {
                    try { controleur.enqueue(encodeur.encode(`data: ${JSON.stringify(o)}\n\n`)) }
                    // Un client parti en cours de route ne doit pas remonter en erreur
                    // serveur : la question a été traitée, personne n'écoute plus.
                    catch { /* flux fermé */ }
                }
                try {
                    if (!question) envoyer({ erreur: 'Question vide.' })
                    else if (!cfg) envoyer({ erreur: MODELE_ABSENT })
                    else envoyer({ reponse: await traiter(cfg, question, email, body.fil ?? [], envoyer) })
                }
                catch (e) {
                    envoyer({ erreur: e instanceof Error ? e.message : String(e) })
                }
                finally {
                    controleur.close()
                    console.log(`FLUX /api/assistant/question-flux clos ${Math.round(performance.now() - debut)}ms`)
                }
            },
        })

        return new Response(flux, {
            headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no',
            },
        })
    }, {
        body: CORPS_QUESTION,
    })

    /**
     * FRAÎCHEUR DES SOURCES.
     *
     * Consultable par tout le monde, et non réservée aux administrateurs : un index qui
     * cesse de se mettre à jour en silence sert des réponses périmées avec la même
     * assurance qu'une réponse fraîche. Celui qui lit la réponse doit pouvoir voir l'état
     * de l'index sans demander la permission à quiconque.
     */

    /**
     * CE QUE LA RECHERCHE RAPPORTE, SANS LE MODÈLE.
     *
     * Un modèle rend deux réponses différentes à la même question, et c'est sa nature. On a
     * donc passé une soirée à ne pas pouvoir distinguer une régression de la recherche d'une
     * variation de rédaction : la même question a rendu deux sections utiles, puis « ce n'est
     * pas écrit », sur un index identique.
     */
    .post('/recherche', async ({ body }) => {
        const question = body.question.trim()
        if (!question) return { termes: [], passages: [], plancher: 0, meilleurScore: 0, sousLePlancher: true, mode: 'lexical' as const }

        const r = await chercher(question, calculerVecteur)
        return {
            mode: r.mode,
            plancher: await lireNombre('recherche.score_plancher'),
            meilleurScore: r.meilleurScore,
            sousLePlancher: r.sousLePlancher,
            termes: await termesDe(question, await lireListe('recherche.mots_vides')),
            passages: r.passages.map(p => ({
                reference: p.reference,
                titre: p.titre,
                section: p.titreSection,
                ordre: p.ordre,
                categorie: p.categorie,
                statut: p.statut,
                score: p.score,
                scoreLexical: p.scoreLexical,
                scoreSemantique: p.scoreSemantique,
                ramene: p.ramene === true,
                via: p.via ?? null,
                extrait: p.texte.replace(/\s+/g, ' ').slice(0, 220),
            })),
        }
    }, { body: t.Object({ question: t.String() }) })

    .get('/fraicheur', async () => {
        const seuil = await lireNombre('synchro.seuil_peremption_h')
        const lignes = await db.select({
            nom: indexSchema.source.nom,
            type: indexSchema.source.type,
            actif: indexSchema.source.actif,
            etat: indexSchema.synchro.etat,
            dernierSucces: indexSchema.synchro.dernierSucces,
            message: indexSchema.synchro.message,
            documentsVus: indexSchema.synchro.documentsVus,
        })
            .from(indexSchema.source)
            .leftJoin(indexSchema.synchro, eq(indexSchema.synchro.sourceId, indexSchema.source.id))
            .orderBy(indexSchema.source.nom)

        const maintenant = Date.now()
        const sources = lignes.map(l => {
            const heures = l.dernierSucces
                ? (maintenant - l.dernierSucces.getTime()) / 3600_000
                : null
            return {
                ...l,
                heuresDepuisSucces: heures === null ? null : Math.round(heures * 10) / 10,
                // Jamais synchronisée compte comme périmée : c'est le cas le plus trompeur,
                // un index vide qui répond « ce n'est pas écrit » à tout.
                perimee: l.actif && (heures === null || heures > seuil),
            }
        })
        return { seuilHeures: seuil, sources, alerte: sources.some(s => s.perimee) }
    })

    /**
     * SIGNALER UNE RÉPONSE À CÔTÉ — la moitié manquante de la file de rédaction.
     *
     * Le journal des lacunes ne recevait que les questions SANS réponse. Or les pires
     * réponses de la semaine étaient trouvées : « Non, pas de P1 », les sections
     * discursives d'INC-04 servies à la place du confinement. Trouvées, donc sans trace —
     * chaque « c'est à côté » devait être répété de vive voix pour exister.
     */
    .post('/signaler', async ({ body, utilisateur }) => {
        await db.insert(indexSchema.lacune).values({
            question: body.question.slice(0, 2000),
            origine: 'signalement',
            citations: (body.citations ?? []).slice(0, 12),
            // Ce qui manquait, dans les mots du signalant. Facultatif : exiger la phrase
            // ferait renoncer, et un signalement muet vaut mieux qu'un silence.
            ceQuiManquait: body.ceQuiManquait?.trim().slice(0, 1000) || null,
            sourcesConsultees: await sourcesConsultees(),
            meilleurScore: null,
            utilisateur: utilisateur?.email ?? null,
        })
        return { ok: true }
    }, {
        body: t.Object({
            question: t.String(),
            citations: t.Optional(t.Array(t.String())),
            ceQuiManquait: t.Optional(t.String()),
        }),
    })

    /**
     * JOURNAL DES LACUNES — la file de rédaction documentaire.
     *
     * C'est la sortie la plus utile de l'outil : chaque ligne est une question que
     * quelqu'un s'est posée et à laquelle la documentation ne répond pas.
     */
    .get('/lacunes', async ({ query }) => {
        const lignes = await db.select().from(indexSchema.lacune)
            .where(query.traitees === true ? sql`true` : eq(indexSchema.lacune.traitee, false))
            .orderBy(desc(indexSchema.lacune.date))
            .limit(Math.min(Number(query.limite ?? 100), 500))
        return { lacunes: lignes }
    }, {
        query: t.Object({
            traitees: t.Optional(t.Boolean()),
            limite: t.Optional(t.Numeric()),
        }),
    })

export const journalRouter = new Elysia({ name: 'journal', prefix: '/api/journal', tags: ['Journal'] })
    .use(adminMiddleware)
    /**
     * Réservé aux administrateurs, contrairement à la fraîcheur : la fraîcheur dit l'état
     * de l'outil, ce journal dit ce que les gens ont demandé. Ce n'est pas la même chose et
     * ça ne se lit pas par les mêmes personnes.
     */
    .get('/', async ({ query }) => ({ consultations: await journal(Number(query.limite ?? 200)) }), {
        query: t.Object({ limite: t.Optional(t.Numeric()) }),
    })

export const lacunesAdminRouter = new Elysia({ name: 'lacunes-admin', prefix: '/api/assistant/lacunes', tags: ['Assistant'] })
    .use(adminMiddleware)
    .patch('/:id', async ({ params, body }) => {
        await db.update(indexSchema.lacune)
            .set({ traitee: body.traitee })
            .where(eq(indexSchema.lacune.id, params.id))
        return { ok: true }
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({ traitee: t.Boolean() }),
    })
