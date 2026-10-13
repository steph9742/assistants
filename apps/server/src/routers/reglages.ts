// RÉGLAGES — lecture et écriture, réservées aux administrateurs.
//
// L'interface se construit ENTIÈREMENT depuis ce que renvoie `GET /` : libellé,
// description, type, défaut, bornes. Aucun champ n'est décrit en dur côté front, sans quoi
// il faudrait penser à le modifier à deux endroits — et on n'y pense jamais deux fois.

import { Elysia, t } from "elysia";
import { adminMiddleware } from "../middleware/auth";
import { etat, ecrire } from "../utils/reglages";
import { lireConfigIA, listerModeles, sonderEmbeddings, testerIA } from "../utils/ia";

export const reglagesRouter = new Elysia({ name: 'reglages', prefix: '/api/reglages', tags: ['Réglages'] })
    .use(adminMiddleware)

    /** État complet. Les secrets ne ressortent jamais en clair, seulement « renseigné ». */
    .get('/', async () => ({ reglages: await etat() }))

    .put('/', async ({ body, admin, status }) => {
        const echecs = await ecrire(body.valeurs, admin?.email ?? null)
        if (echecs.length) return status(422, { echecs })
        return { reglages: await etat() }
    }, {
        body: t.Object({ valeurs: t.Record(t.String(), t.String()) }),
    })

    /**
     * Liste des modèles proposée par l'API. Le modèle se choisit ici, jamais à la main :
     * un identifiant saisi de mémoire et légèrement faux échoue à l'appel, plusieurs jours
     * après avoir été enregistré.
     */
    .get('/modeles', async ({ status }) => {
        try { return { modeles: await listerModeles() } }
        catch (e) { return status(502, { erreur: e instanceof Error ? e.message : String(e) }) }
    })

    /** Vérifie qu'adresse, jeton et modèle répondent réellement. */
    .post('/tester', async ({ query, status }) => {
        const usage = query.usage === 'journaux' ? 'journaux' : 'assistant'
        const cfg = await lireConfigIA(usage)
        if (!cfg) return status(400, { erreur: 'Adresse, jeton ou modèle non renseignés.' })
        return testerIA(cfg)
    }, {
        query: t.Object({ usage: t.Optional(t.String()) }),
    })

    .get('/embeddings', async ({ query }) => sonderEmbeddings(query.modele), {
        query: t.Object({ modele: t.Optional(t.String()) }),
    })
