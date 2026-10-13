// GARDE DE ROUTE — aucune page ne s'affiche sans session valide.
//
// Il n'y en avait pas. Les pages se rendaient, et seuls les appels d'API échouaient : un
// visiteur non authentifié voyait donc l'interface entière, ses libellés, la liste des
// onglets, et le texte des pages. Rien de confidentiel n'en sortait — mais montrer la forme
// de l'outil à qui n'a pas le droit d'y entrer n'a aucune raison d'être, et laissait croire
// à un accès qui n'existait pas.

export default defineNuxtRouteMiddleware(async (to) => {
    // La page de connexion est la seule qui doit rester ouverte, sans quoi on boucle.
    if (to.path.endsWith('/connexion')) return

    const config = useRuntimeConfig()
    const interne = (config as any).serverBaseUrlInternal as string | undefined
    const base = (import.meta.server && interne) ? interne : config.public.serverBaseUrl

    try {
        // Le cookie doit être transmis explicitement au rendu serveur : `$fetch` n'hérite
        // pas des en-têtes de la requête entrante. Sans ça, le serveur ne voit jamais de
        // session, redirige toujours, et la connexion devient impossible.
        const entetes = import.meta.server ? useRequestHeaders(['cookie']) : undefined

        const session = await $fetch<{ user?: unknown }>(`${base}/api/auth/get-session`, {
            credentials: 'include',
            headers: entetes,
        })
        if (session?.user) return
    }
    catch {
        // Serveur injoignable : on renvoie à la connexion plutôt que d'afficher une page
        // qui ne fonctionnera pas. Le message y est plus utile qu'ici.
    }

    const retour = encodeURIComponent(to.fullPath)
    return navigateTo(`/connexion?retour=${retour}`)
})
