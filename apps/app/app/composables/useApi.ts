import { decouperTrames } from '~/utils/flux'

// Accès à l'API. Un seul endroit qui sait où est le serveur et comment il répond.
//
// Les erreurs remontent en français et telles que le serveur les a écrites : elles disent
// quoi faire (« un administrateur doit renseigner le modèle », « votre compte n'appartient
// pas au groupe autorisé »). Les remplacer par « une erreur est survenue » perdrait la
// seule information utile.

export type Citation = {
    reference: string | null
    titre: string
    section: string | null
    url: string | null
    statut: string | null
    version: string | null
    dateRevision: string | null
    source: string
    score: number
}

export type ResultatSonde = {
    cle: string, intitule: string, source: string, requete: string
    code: number | null, etat: string, explication: string
}

/**
 * `etapes` : le modèle de chaque étape qui a tourné avec un AUTRE modèle que la rédaction.
 * Absent quand un seul modèle a tout fait, ce qui reste le cas par défaut.
 */
export type Origine = { modele: string, consigne: string, date: string, etapes?: Record<string, string> }

export type Reponse = {
    trouve: boolean
    issue: 'reponse' | 'rien_ecrit' | 'insuffisant' | 'illisible' | 'echec_source'
    /** Renseigné sur `rien_ecrit` : ce que la recherche a cherché, et ce qui a frôlé. */
    diagnostic?: {
        termes: { mot: string, df: number, poids: number }[]
        frolements: { titre: string, section: string | null, score: number, url: string | null }[]
        plancher: number
    }
    texte: string
    citations: Citation[]
    autoritesEnPresence: string[]
    nonIndexables: Citation[]
    mode: 'lexical' | 'hybride'
    origine: Origine
    /** La question telle que la reformulation l'a comprise, quand un fil la précédait. */
    questionComprise?: string
    /** Résumé d'état construit par le serveur — à renvoyer tel quel dans le fil. */
    resume: string
    /** Renseigné sur le chemin « données » : la requête exécutée, et son résultat ou son échec. */
    donnees?: { requete: string, corps: unknown, mentions: string[], erreur?: string }
}

/**
 * L'étape en cours, telle que le serveur la rapporte pendant qu'il travaille.
 *
 * Ce sont les vraies étapes de la chaîne, émises quand le code y entre — jamais une
 * progression simulée à la minuterie. Un indicateur qui inventerait son avancement serait
 * la faute que tout ce projet combat, appliquée à l'attente.
 */
export type Etape =
    | { etape: 'reformulation' }
    | { etape: 'orientation' }
    | { etape: 'donnees', requete: string }
    | { etape: 'recherche' }
    | { etape: 'redaction', passages?: number, conduite?: number }

export type Explication = { texte: string, origine: Origine }

export type Hypothese = { type: string, certitude: number, pourquoi: string, contre: string }
export type Hypotheses = { hypotheses: Hypothese[], illisible?: string, origine: Origine }

export type Reglage = {
    cle: string, rubrique: string, libelle: string, description: string
    type: string, portee: string, defaut: string, note?: string
    unite?: string, min?: number, max?: number
    valeur: string | null, renseigne: boolean, surcharge: boolean
}

export type SourceFraicheur = {
    nom: string, type: string, actif: boolean
    etat: string | null, dernierSucces: string | null, message: string | null
    documentsVus: number | null, heuresDepuisSucces: number | null, perimee: boolean
}

export function useApi() {
    const config = useRuntimeConfig()

    // DEUX ADRESSES POUR LE MÊME SERVEUR, et ce n'est pas une commodité.
    //
    // Le navigateur passe par le proxy, donc par l'adresse publique. Le rendu côté serveur,
    // lui, tourne DANS le réseau Docker : s'il employait l'adresse publique, il sortirait
    // du réseau pour y revenir — et sur cette machine il n'y reviendrait pas, faute de
    // retour de boucle NAT. Le symptôme serait une page qui se charge à vide au premier
    // affichage puis se remplit au second, ce qui ressemble à une lenteur et n'en est pas.
    const interne = (config as any).serverBaseUrlInternal as string | undefined
    const base = (import.meta.server && interne) ? interne : config.public.serverBaseUrl

    async function appeler<T>(chemin: string, options: Record<string, unknown> = {}): Promise<T> {
        try {
            return await $fetch<T>(`${base}${chemin}`, {
                credentials: 'include',
                ...options,
            })
        }
        catch (e: any) {
            // Une session expirée renvoie à la connexion plutôt que d'afficher un message :
            // il n'y a rien à faire d'autre, et laisser la personne relire l'erreur trois
            // fois avant de comprendre ne sert personne.
            if (e?.status === 401 && import.meta.client) {
                const retour = encodeURIComponent(useRoute().fullPath)
                await navigateTo(`/connexion?retour=${retour}`)
            }
            const message = e?.data?.erreur
                ?? e?.data?.message
                ?? (e?.status === 401 ? 'Session expirée.' : null)
                ?? e?.message
                ?? 'Le serveur est injoignable.'
            throw new Error(message)
        }
    }

    const question = (q: string, fil: { question: string, resume: string }[] = []) =>
        appeler<Reponse>('/api/assistant/question', { method: 'POST', body: { question: q, fil } })

    /**
     * La même question, en écoutant les étapes.
     *
     * L'INDICATEUR NE DOIT JAMAIS COÛTER LA RÉPONSE. Le flux traverse deux proxies que nous
     * ne maîtrisons pas entièrement ; s'il n'aboutit pas — mise en tampon, coupure, corps
     * illisible — on retombe sur l'appel simple, qui rend exactement la même réponse. Seul
     * le confort est perdu.
     */
    async function questionFlux(
        q: string,
        fil: { question: string, resume: string }[] = [],
        surEtape?: (e: Etape) => void,
    ): Promise<Reponse> {
        let messageServeur: string | null = null
        try {
            const r = await fetch(`${base}/api/assistant/question-flux`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: q, fil }),
            })
            if (!r.ok || !r.body) throw new Error('flux indisponible')

            const lecteur = r.body.getReader()
            const decodeur = new TextDecoder()
            let tampon = ''
            let recue: Reponse | null = null

            for (;;) {
                const { done, value } = await lecteur.read()
                if (done) break
                tampon += decodeur.decode(value, { stream: true })
                const { evenements, reste } = decouperTrames(tampon)
                tampon = reste
                for (const e of evenements as Record<string, unknown>[]) {
                    if (e.reponse) recue = e.reponse as Reponse
                    else if (e.erreur) messageServeur = String(e.erreur)
                    else surEtape?.(e as Etape)
                }
            }

            if (messageServeur) throw new Error(messageServeur)
            if (recue) return recue
            throw new Error('flux interrompu')
        }
        catch (e: any) {
            if (messageServeur) throw new Error(messageServeur)
            return await question(q, fil)
        }
    }

    return {
        base,
        question,
        questionFlux,

        expliquerExtrait: (extrait: string) =>
            appeler<Explication>('/api/journaux/expliquer', { method: 'POST', body: { extrait } }),

        hypotheses: (extrait: string) =>
            appeler<Hypotheses>('/api/journaux/hypotheses', { method: 'POST', body: { extrait } }),

        fraicheur: () =>
            appeler<{ seuilHeures: number, sources: SourceFraicheur[], alerte: boolean }>('/api/assistant/fraicheur'),

        signaler: (question: string, citations: string[], ceQuiManquait?: string) =>
            appeler('/api/assistant/signaler', {
                method: 'POST', body: { question, citations, ceQuiManquait },
            }),

        lacunes: () =>
            appeler<{ lacunes: any[] }>('/api/assistant/lacunes'),

        marquerLacune: (id: string, traitee: boolean) =>
            appeler(`/api/assistant/lacunes/${id}`, { method: 'PATCH', body: { traitee } }),

        reglages: () => appeler<{ reglages: Reglage[] }>('/api/reglages'),

        enregistrerReglages: (valeurs: Record<string, string>) =>
            appeler<{ reglages: Reglage[] }>('/api/reglages', { method: 'PUT', body: { valeurs } }),

        modeles: () => appeler<{ modeles: { id: string, nom: string }[] }>('/api/reglages/modeles'),

        testerModele: (usage: string) =>
            appeler<{ ok: boolean, reponse?: string, message?: string }>(
                `/api/reglages/tester?usage=${usage}`, { method: 'POST' }),

        sonderEmbeddings: () =>
            appeler<{ disponible: boolean, route?: string, dimensions?: number, detail: string }>(
                '/api/reglages/embeddings'),

        sources: () => appeler<{ sources: any[], configDefautGitlab: any }>('/api/sources'),

        consultations: (limite = 200) =>
            appeler<{ consultations: any[] }>(`/api/journal?limite=${limite}`),

        /**
         * Le SSO tel que le serveur l'a déclaré — identifiant de fournisseur et libellé.
         * Route publique : la page de connexion l'appelle sans session.
         */
        sso: () => appeler<{ configure: boolean, fournisseur: string, libelle: string }>('/api/sso'),

        session: () => $fetch<{ user?: { email: string } }>(`${base}/api/auth/get-session`, {
            credentials: 'include',
        }).then(r => r?.user ?? null),

        deconnexion: () => $fetch(`${base}/api/auth/sign-out`, {
            method: 'POST', credentials: 'include',
        }).catch(() => { /* déjà déconnecté : le but est atteint */ }),

        projetsGitlab: (corps: Record<string, unknown>) =>
            appeler<{ projets: { chemin: string, nom: string, branche: string, archive: boolean }[] }>(
                '/api/sources/gitlab/projets', { method: 'POST', body: corps }),

        dossiersGitlab: (corps: Record<string, unknown>) =>
            appeler<{ dossiers: { chemin: string, fichiersMd: number, niveau: number }[] }>(
                '/api/sources/gitlab/dossiers', { method: 'POST', body: corps }),

        creerLot: (corps: Record<string, unknown>) =>
            appeler<{ crees: string[], ignores: { nom: string, motif: string }[] }>(
                '/api/sources/lot', { method: 'POST', body: corps }),

        creerSource: (corps: Record<string, unknown>) =>
            appeler('/api/sources', { method: 'POST', body: corps }),

        modifierSource: (id: string, corps: Record<string, unknown>) =>
            appeler(`/api/sources/${id}`, { method: 'PATCH', body: corps }),

        supprimerSource: (id: string) =>
            appeler(`/api/sources/${id}`, { method: 'DELETE' }),

        diagnostic: (question: string) =>
            appeler<{
                mode: string, plancher: number, meilleurScore: number, sousLePlancher: boolean
                termes: { mot: string, df: number, poids: number }[]
                passages: {
                    reference: string | null, titre: string, section: string | null, ordre: number
                    categorie: string, statut: string | null, score: number
                    scoreLexical: number, scoreSemantique: number, ramene: boolean, via: string | null, extrait: string
                }[]
            }>('/api/assistant/recherche', { method: 'POST', body: { question } }),

        portee: () =>
            appeler<{ resultats: ResultatSonde[], resume: Record<string, number> }>('/api/sources/portee'),

        testerSource: (id: string) =>
            appeler<{ ok: boolean, detail?: string, apercu?: string[], message?: string }>(
                `/api/sources/${id}/tester`, { method: 'POST' }),
    }
}
