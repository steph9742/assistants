// OUTIL 3 — COMPRÉHENSION DE JOURNAUX.
//
// On colle un extrait, l'outil explique ce que c'est. Il ne qualifie pas : la
// qualification appartient au triage, et une qualification produite hors du registre ne
// serait tracée nulle part.

import { Elysia, t } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { lireConfigIA, expliquerExtrait, hypothesesIncident } from "../utils/ia";
import { lireNombre, lireBooleen } from "../utils/reglages";
import { consignerJournaux } from "../utils/audit";

export const journauxRouter = new Elysia({ name: 'journaux', prefix: '/api/journaux', tags: ['Journaux'] })
    .use(authMiddleware)

    .post('/expliquer', async ({ body, utilisateur, status }) => {
        const extrait = body.extrait.trim()
        if (!extrait) return status(400, { erreur: 'Extrait vide.' })

        const max = await lireNombre('journaux.taille_max')
        if (extrait.length > max) {
            return status(413, {
                erreur: `Extrait trop long : ${extrait.length} caractères pour un maximum de ${max}. Collez la partie qui vous intéresse.`,
            })
        }

        const cfg = await lireConfigIA('journaux')
        if (!cfg) {
            return status(503, {
                erreur: "Le modèle n'est pas configuré. Un administrateur doit renseigner l'adresse, le jeton et le modèle dans les réglages.",
            })
        }

        const debut = Date.now()
        try {
            const r = await expliquerExtrait(cfg, extrait)
            // Longueur, modèle, durée. Jamais l'extrait — `consignerJournaux` ne sait
            // même pas le recevoir.
            await consignerJournaux({
                utilisateur: utilisateur?.email ?? null,
                tailleEntree: extrait.length,
                origine: r.origine,
                dureeMs: Date.now() - debut,
            })
            return r
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            await consignerJournaux({
                utilisateur: utilisateur?.email ?? null,
                tailleEntree: extrait.length,
                dureeMs: Date.now() - debut,
                erreur: message,
            })
            return status(502, { erreur: message })
        }
    }, {
        body: t.Object({
            extrait: t.String({ description: "Ligne de journal, règle de détection, identifiant d'événement, extrait de configuration." }),
        }),
    })

    /**
     * HYPOTHÈSES — un second appel, délibérément séparé.
     *
     * L'explication doit s'afficher même si celui-ci échoue : un JSON mal formé ne doit pas
     * coûter la réponse utile. L'interface les demande donc en parallèle.
     */
    .post('/hypotheses', async ({ body, utilisateur, status }) => {
        if (!await lireBooleen('journaux.hypotheses')) {
            return status(404, { erreur: 'Les hypothèses sont désactivées dans les réglages.' })
        }

        const extrait = body.extrait.trim()
        if (!extrait) return status(400, { erreur: 'Extrait vide.' })

        const max = await lireNombre('journaux.taille_max')
        if (extrait.length > max) return status(413, { erreur: `Extrait trop long : ${extrait.length} pour un maximum de ${max}.` })

        const cfg = await lireConfigIA('journaux')
        if (!cfg) return status(503, { erreur: "Le modèle n'est pas configuré." })

        const debut = Date.now()
        try {
            const r = await hypothesesIncident(cfg, extrait)
            await consignerJournaux({
                utilisateur: utilisateur?.email ?? null,
                tailleEntree: extrait.length,
                origine: r.origine,
                dureeMs: Date.now() - debut,
            })
            return r
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            await consignerJournaux({
                utilisateur: utilisateur?.email ?? null,
                tailleEntree: extrait.length, dureeMs: Date.now() - debut, erreur: message,
            })
            return status(502, { erreur: message })
        }
    }, {
        body: t.Object({ extrait: t.String() }),
    })
