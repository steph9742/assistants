<script setup lang="ts">
const api = useApi()
const route = useRoute()

// La fraîcheur est chargée ici, pas dans chaque page : elle doit être visible partout.
// Un index qui cesse de se mettre à jour en silence sert des réponses périmées avec la
// même assurance qu'une réponse fraîche. C'est la panne qui ne ressemble pas à une panne.
// `catch` explicite : une erreur ici (non authentifié, serveur arrêté) ne doit pas faire
// écran blanc. L'absence d'information de fraîcheur est moins grave que l'absence de page.
const { data: fraicheur } = await useAsyncData('fraicheur', async () => {
    if (route.path.endsWith('/connexion')) return { seuilHeures: 24, sources: [], alerte: false }
    // Le `catch` reste : une fraîcheur indisponible ne doit pas faire d'écran blanc. Mais
    // il avalait aussi le 401, et c'est ce qui laissait les pages s'afficher sans session.
    // La redirection est désormais faite EN AMONT par le garde de route, avant le rendu.
    try { return await api.fraicheur() }
    catch { return { seuilHeures: 24, sources: [], alerte: false } }
}, { default: () => ({ seuilHeures: 24, sources: [], alerte: false }), watch: [() => route.path] })

const perimees = computed(() => fraicheur.value?.sources.filter(s => s.perimee) ?? [])

/**
 * DEUX USAGES, DEUX RANGS.
 *
 * Huit onglets au même niveau, dont six d'administration : quelqu'un qui vient poser une
 * question affrontait Sources, Portée, Diagnostic, Consultations et Réglages avant de
 * trouver ce qu'il cherchait. Ce qui sert tous les jours reste visible ; le reste vit
 * derrière un menu, sans rien perdre.
 */
const ONGLETS = [
    { to: '/', libelle: 'Assistant' },
    { to: '/journaux', libelle: 'Expliquer un extrait' },
    { to: '/lacunes', libelle: 'Lacunes' },
]

const ADMINISTRATION = [
    { to: '/sources', libelle: 'Sources' },
    { to: '/portee', libelle: 'Portée' },
    { to: '/diagnostic', libelle: 'Diagnostic' },
    { to: '/journal', libelle: 'Consultations' },
    { to: '/reglages', libelle: 'Réglages' },
]

const menuOuvert = ref(false)
const dansAdministration = computed(() => ADMINISTRATION.some(o => o.to === route.path))
// Naviguer ferme le menu : sans cela il reste ouvert par-dessus la page qu'on vient
// d'ouvrir, et il faut cliquer ailleurs pour le voir disparaître.
watch(() => route.path, () => { menuOuvert.value = false })

const moi = ref<{ email?: string } | null>(null)
onMounted(async () => {
    if (route.path === '/connexion') return
    try { moi.value = await api.session() }
    catch { /* la redirection vers la connexion est déjà faite par useApi */ }
})

async function deconnecter() {
    await api.deconnexion()
    // Rechargement complet plutôt que `navigateTo` : c'est la seule façon d'être sûr
    // qu'aucun état chargé pendant la session ne survit à la déconnexion.
    //
    // `useRuntimeConfig().app.baseURL` et non `/connexion` en dur : l'application peut
    // vivre sous un sous-chemin (`exemple.fr/assistant`), et un chemin absolu écrit à la
    // main sortirait du sous-chemin pour atterrir sur une page qui n'existe pas.
    const base = useRuntimeConfig().app.baseURL.replace(/\/+$/, '')
    window.location.href = `${base}/connexion`
}
</script>

<template>
  <!-- La page de connexion n'a ni navigation ni bandeau : rien à naviguer tant qu'on
       n'est pas entré, et l'état de l'index ne regarde pas un visiteur non authentifié. -->
  <NuxtPage v-if="route.path === '/connexion'" />

  <div v-else class="min-h-screen bg-stone-50 text-stone-900 font-geist">
    <header class="border-b border-stone-200 bg-white">
      <div class="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
        <span class="text-sm font-semibold tracking-tight">Assistants</span>
        <nav class="flex flex-wrap items-center gap-1">
          <NuxtLink
            v-for="o in ONGLETS" :key="o.to" :to="o.to"
            class="rounded-md px-3 py-1.5 text-sm transition hover:bg-stone-100"
            :class="route.path === o.to ? 'bg-stone-900 text-white hover:bg-stone-900' : 'text-stone-600'"
          >{{ o.libelle }}</NuxtLink>

          <div class="relative">
            <button
              class="rounded-md px-3 py-1.5 text-sm transition hover:bg-stone-100"
              :class="dansAdministration ? 'bg-stone-900 text-white hover:bg-stone-900' : 'text-stone-600'"
              @click="menuOuvert = !menuOuvert"
            >Administration <span class="text-xs opacity-60">▾</span></button>

            <!-- Un fond transparent ferme le menu au premier clic ailleurs. -->
            <button
              v-if="menuOuvert" class="fixed inset-0 z-10 cursor-default"
              aria-label="Fermer le menu" @click="menuOuvert = false"
            />
            <div
              v-if="menuOuvert"
              class="absolute left-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
            >
              <NuxtLink
                v-for="o in ADMINISTRATION" :key="o.to" :to="o.to"
                class="block px-3 py-1.5 text-sm transition hover:bg-stone-100"
                :class="route.path === o.to ? 'font-medium text-stone-900' : 'text-stone-600'"
              >{{ o.libelle }}</NuxtLink>
            </div>
          </div>
        </nav>

        <div class="ml-auto flex items-center gap-3 text-xs text-stone-500">
          <span v-if="moi?.email">{{ moi.email }}</span>
          <button class="rounded-md px-2 py-1 hover:bg-stone-100 hover:text-stone-900" @click="deconnecter">
            Se déconnecter
          </button>
        </div>
      </div>
    </header>

    <!--
      Bandeau de péremption. Non refermable, et placé au-dessus du contenu plutôt que dans
      un coin : si l'index est périmé, la personne doit le savoir AVANT de lire une réponse,
      pas après.
    -->
    <div v-if="perimees.length" class="border-b border-amber-300 bg-amber-50">
      <div class="mx-auto max-w-5xl px-6 py-3 text-sm text-amber-900">
        <p class="font-medium">
          Index périmé — les réponses peuvent être en retard sur les documents.
        </p>
        <ul class="mt-1 space-y-0.5 text-amber-800">
          <li v-for="s in perimees" :key="s.nom">
            <span class="font-medium">{{ s.nom }}</span> :
            <template v-if="s.heuresDepuisSucces === null">jamais synchronisée</template>
            <template v-else>{{ s.heuresDepuisSucces }} h sans synchronisation réussie</template>
            <template v-if="s.etat === 'echec'"> — dernier essai en échec<span v-if="s.message"> : {{ s.message }}</span></template>
          </li>
        </ul>
      </div>
    </div>

    <main class="mx-auto max-w-5xl px-6 py-8">
      <NuxtPage />
    </main>

    <footer class="mx-auto max-w-5xl px-6 pb-10 text-xs text-stone-400">
      L'assistant lit et répond. Il n'écrit dans aucun système et ne déclenche rien.
    </footer>
  </div>
</template>
