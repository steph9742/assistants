// SOURCES — déclaration et configuration. Administrateurs uniquement.

import { Elysia, t } from "elysia";
import { db } from "@assistants/database";
import { indexSchema } from "@assistants/database/tables";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../middleware/auth";
import { chiffrer } from "../utils/secrets";
import { CONFIG_DEFAUT, lireConfig, listerDetaille, listerProjets, listerDossiers } from "../utils/gitlab";
import * as nc from "../utils/nextcloud";
import { DESCRIPTEURS, validerConfig, descripteur } from "@assistants/database/registre";
import { QUESTIONS } from "../utils/questions";
import { verifierSniff, lireJson, sonderPortee } from "../utils/donnees";
import { dechiffrer } from "../utils/secrets";

/** Le jeton du formulaire, ou celui déjà enregistré sur une source. */
async function jetonPour(body: { jeton?: string, sourceId?: string }): Promise<string | null> {
    if (body.jeton?.trim()) return body.jeton.trim()
    if (!body.sourceId) return null
    const [s] = await db.select().from(indexSchema.source).where(eq(indexSchema.source.id, body.sourceId))
    return s ? dechiffrer(s.jetonChiffre) : null
}

/** Le jeton ne ressort jamais : on dit seulement s'il est posé. */
function sansSecret(s: typeof indexSchema.source.$inferSelect) {
    const { jetonChiffre, ...reste } = s
    return { ...reste, jetonRenseigne: !!jetonChiffre }
}

export const sourcesRouter = new Elysia({ name: 'sources', prefix: '/api/sources', tags: ['Sources'] })
    .use(adminMiddleware)

    /**
     * CE QUE LA CLÉ ATTEINT RÉELLEMENT — tous les points d'entrée du contrat, d'un coup.
     *
     * Sans cette page, un défaut de portée se découvrait UNE QUESTION À LA FOIS, en
     * production, sous la forme d'une réponse creuse et rassurante. C'est le pire moment et
     * la pire forme.
     */
    .get('/portee', async () => sonderPortee())

    /**
     * L'écran de configuration se construit ENTIÈREMENT depuis `descripteurs` : libellés,
     * types, obligations, exemples, mises en garde. Aucun champ n'est décrit en dur côté
     * interface, sans quoi il faudrait modifier un connecteur à deux endroits — et on n'y
     * pense jamais deux fois.
     */
    .get('/', async () => ({
        sources: (await db.select().from(indexSchema.source).orderBy(indexSchema.source.nom)).map(sansSecret),
        descripteurs: DESCRIPTEURS,
        categories: ['juridique', 'procedure', 'exploitation', 'equipe', 'produit', 'bonne_pratique', 'donnees'],
        configDefautGitlab: CONFIG_DEFAUT,
        /** Ce que l'assistant sait demander aux sources de nature « données ». */
        questions: QUESTIONS.map(q => ({ cle: q.cle, intitule: q.intitule, source: q.source })),
    }))

    .post('/', async ({ body, status }) => {
        const manques = validerConfig(body.type, body.config ?? {})
        if (manques.length) return status(422, { erreur: `Champs obligatoires manquants : ${manques.join(', ')}.` })
        const [s] = await db.insert(indexSchema.source).values({
            nom: body.nom,
            type: body.type,
            actif: body.actif ?? true,
            config: body.config ?? {},
            autorite: body.autorite ?? null,
            categorie: body.categorie ?? descripteur(body.type).categorieDefaut,
            jetonChiffre: body.jeton ? chiffrer(body.jeton) : null,
        }).returning()
        return sansSecret(s!)
    }, {
        body: t.Object({
            nom: t.String(),
            type: t.String(),
            actif: t.Optional(t.Boolean()),
            config: t.Optional(t.Record(t.String(), t.Any())),
            autorite: t.Optional(t.String()),
            categorie: t.Optional(t.String()),
            jeton: t.Optional(t.String()),
        }),
    })

    .patch('/:id', async ({ params, body, status }) => {
        const champs: Record<string, unknown> = {}
        if (body.nom !== undefined) champs.nom = body.nom
        if (body.actif !== undefined) champs.actif = body.actif
        if (body.config !== undefined) champs.config = body.config
        if (body.autorite !== undefined) champs.autorite = body.autorite
        if (body.categorie !== undefined) champs.categorie = body.categorie
        // Un jeton vide EFFACE plutôt que d'être ignoré : sans ça, retirer un accès
        // demanderait de supprimer la source entière et de tout réindexer.
        if (body.jeton !== undefined) champs.jetonChiffre = body.jeton ? chiffrer(body.jeton) : null

        if (!Object.keys(champs).length) return status(400, { erreur: 'Rien à modifier.' })

        const [s] = await db.update(indexSchema.source).set(champs)
            .where(eq(indexSchema.source.id, params.id)).returning()
        if (!s) return status(404, { erreur: 'Source inconnue.' })
        return sansSecret(s)
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({
            nom: t.Optional(t.String()),
            actif: t.Optional(t.Boolean()),
            config: t.Optional(t.Record(t.String(), t.Any())),
            autorite: t.Optional(t.String()),
            categorie: t.Optional(t.String()),
            jeton: t.Optional(t.String()),
        }),
    })

    /**
     * Supprimer une source retire ses documents en cascade.
     *
     * Pour retirer une source d'une instance — le cas d'une instance restreinte — il faut la DÉSACTIVER,
     * pas la supprimer : on veut garder la configuration et pouvoir la remettre.
     */
    .delete('/:id', async ({ params }) => {
        await db.delete(indexSchema.source).where(eq(indexSchema.source.id, params.id))
        return { ok: true }
    }, { params: t.Object({ id: t.String() }) })

    /**
     * Le jeton pour une découverte : celui saisi dans le formulaire, ou celui déjà
     * enregistré sur une source. On évite ainsi de le retaper pour explorer un second
     * groupe — et de le faire transiter une fois de plus que nécessaire.
     */
    .post('/gitlab/projets', async ({ body, status }) => {
        const jeton = await jetonPour(body)
        if (!jeton) return status(400, { erreur: "Aucun jeton : saisissez-en un, ou choisissez une source qui en porte déjà un." })
        try {
            const projets = await listerProjets(body.base, jeton, body.groupe, body.avecArchives ?? false)
            return { projets }
        }
        catch (e) { return status(502, { erreur: e instanceof Error ? e.message : String(e) }) }
    }, {
        body: t.Object({
            base: t.String(), groupe: t.String(),
            jeton: t.Optional(t.String()), sourceId: t.Optional(t.String()),
            avecArchives: t.Optional(t.Boolean()),
        }),
    })

    .post('/gitlab/dossiers', async ({ body, status }) => {
        const jeton = await jetonPour(body)
        if (!jeton) return status(400, { erreur: 'Aucun jeton.' })
        try {
            const dossiers = await listerDossiers(body.base, jeton, body.projet, body.ref || 'main')
            return { dossiers }
        }
        catch (e) { return status(502, { erreur: e instanceof Error ? e.message : String(e) }) }
    }, {
        body: t.Object({
            base: t.String(), projet: t.String(), ref: t.Optional(t.String()),
            jeton: t.Optional(t.String()), sourceId: t.Optional(t.String()),
        }),
    })

    /**
     * Création en lot depuis une découverte.
     *
     * Déclarer neuf sources une à une, c'est neuf fois le même jeton, la même adresse et la
     * même catégorie saisis à la main — et une occasion de se tromper à chaque fois. Le lot
     * ne fait rien de plus qu'une boucle sur la création simple, mais il la fait sans
     * ressaisie.
     */
    .post('/lot', async ({ body }) => {
        const crees: string[] = []
        const ignores: { nom: string, motif: string }[] = []

        for (const e of body.entrees) {
            const manques = validerConfig('gitlab', e.config)
            if (manques.length) { ignores.push({ nom: e.nom, motif: `champs manquants : ${manques.join(', ')}` }); continue }
            try {
                await db.insert(indexSchema.source).values({
                    nom: e.nom, type: 'gitlab', actif: body.actif ?? true,
                    config: e.config, categorie: body.categorie ?? 'exploitation',
                    autorite: body.autorite ?? null,
                    jetonChiffre: body.jeton ? chiffrer(body.jeton) : null,
                })
                crees.push(e.nom)
            }
            catch (err) {
                const m = err instanceof Error ? err.message : String(err)
                ignores.push({ nom: e.nom, motif: /unique|duplicate/i.test(m) ? 'une source porte déjà ce nom' : m })
            }
        }
        return { crees, ignores }
    }, {
        body: t.Object({
            entrees: t.Array(t.Object({ nom: t.String(), config: t.Record(t.String(), t.Any()) })),
            categorie: t.Optional(t.String()),
            autorite: t.Optional(t.String()),
            jeton: t.Optional(t.String()),
            actif: t.Optional(t.Boolean()),
        }),
    })

    /** Vérifie l'accès sans rien indexer : combien de fichiers, et sont-ils lisibles ? */
    .post('/:id/tester', async ({ params, status }) => {
        const [s] = await db.select().from(indexSchema.source).where(eq(indexSchema.source.id, params.id))
        if (!s) return status(404, { erreur: 'Source inconnue.' })
        try {
            if (s.type === 'gitlab') {
                const cfg = lireConfig(s.config, s.jetonChiffre)
                if (!cfg) return status(400, { erreur: 'Adresse, projet ou jeton manquant.' })
                const r = await listerDetaille(cfg)
                // On NOMME les dossiers absents plutôt que de les taire : un dépôt qui écrit
                // `docs` là où on a déclaré `doc` doit se voir, sans être une erreur.
                const detail = `${r.entrees.length} fichier(s) dans ${r.presents.join(', ')}`
                    + (r.absents.length ? ` — absent de ce dépôt : ${r.absents.join(', ')}` : '')
                return { ok: true, detail, apercu: r.entrees.slice(0, 10).map(e => e.chemin) }
            }

            if (s.type === 'nextcloud_fichiers') {
                const cfg = nc.lireConfig(s.config, s.jetonChiffre)
                if (!cfg) return status(400, { erreur: 'Adresse, compte ou mot de passe manquant.' })
                const r = await nc.relever(cfg)
                const retenus = r.vivants.filter(e => !nc.exclu(e.chemin, cfg.exclusions))
                return {
                    ok: true,
                    detail: `${retenus.length} fichier(s) retenu(s) sur ${r.vivants.length} vus`
                        + (r.jeton ? ', jeton de synchronisation obtenu' : ", SANS jeton de synchronisation — chaque passage relira tout"),
                    apercu: retenus.slice(0, 10).map(e => e.chemin),
                }
            }

            const cfg = (s.config ?? {}) as Record<string, unknown>
            const base = String(cfg.base ?? '').replace(/\/+$/, '')
            const jeton = dechiffrer(s.jetonChiffre)
            if (!base || !jeton) return status(400, { erreur: 'Adresse ou clé de service manquante.' })

            if (s.type === 'sniff') {
                const v = await verifierSniff(base, jeton, String(cfg.version_minimale ?? '02ba656'))
                return {
                    ok: v.etat !== 'ancienne',
                    detail: `version « ${v.version} » — ${v.etat.replace('_', ' ')}`,
                    apercu: v.mention ? [v.mention] : [],
                }
            }

            // Catalogue et autres sources de données : on vérifie que la clé lit vraiment
            // quelque chose. Une clé sans portée déclarée ne lit RIEN côté Catalogue, et
            // c'est exactement le cas qu'un test doit attraper avant la mise en service.
            const url = `${base}/api/lacunes`
            const r = await fetch(url, {
                headers: { 'x-service-key': jeton, Authorization: `Bearer ${jeton}` },
                signal: AbortSignal.timeout(20_000),
            })
            if (!r.ok) {
                return {
                    ok: false,
                    message: r.status === 401 || r.status === 403
                        ? `${url} → ${r.status} : la clé de service est refusée. Vérifiez sa portée côté Catalogue — une clé sans « read » ni « cat:… » ne lit rien.`
                        : `${url} → ${r.status}`,
                }
            }
            const lu = await lireJson(r, url)
            if (!lu.ok) return { ok: false, message: lu.erreur }
            const domaines = (lu.corps as { domainesExamines?: string[] })?.domainesExamines ?? []
            return {
                ok: domaines.length > 0,
                detail: domaines.length
                    ? `${domaines.length} domaine(s) lisible(s)`
                    : "la clé ne lit AUCUNE catégorie — portée non déclarée côté Catalogue",
                apercu: domaines,
            }
        }
        catch (e) {
            return { ok: false, message: e instanceof Error ? e.message : String(e) }
        }
    }, { params: t.Object({ id: t.String() }) })
