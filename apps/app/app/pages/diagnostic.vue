<script setup lang="ts">
// CE QUE LA RECHERCHE RAPPORTE, SANS LE MODÈLE.
//
// C'est l'écran à ouvrir quand une réponse est « à côté » : il dit si le bon document est
// remonté (le défaut est alors dans la rédaction) ou non (il est dans l'index, les
// mots-clés ou les réglages). Sans lui, cette question demandait une session psql.

const api = useApi()
const question = ref('')
const r = ref<Awaited<ReturnType<typeof api.diagnostic>> | null>(null)
const enCours = ref(false)
const erreur = ref('')

async function lancer() {
    if (!question.value.trim() || enCours.value) return
    enCours.value = true
    erreur.value = ''
    try { r.value = await api.diagnostic(question.value) }
    catch (e: any) { erreur.value = e.message }
    finally { enCours.value = false }
}

const absents = computed(() => (r.value?.termes ?? []).filter(t => t.df === 0))
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold tracking-tight">Diagnostic de la recherche</h1>
    <p class="mt-1 max-w-3xl text-sm text-stone-500">
      La même question que l'assistant, sans le modèle : les termes réellement cherchés et
      les passages retenus, avec leurs scores. La recherche est déterministe — ce que montre
      cet écran est reproductible, contrairement à une réponse rédigée.
    </p>

    <form class="mt-5 flex gap-2" @submit.prevent="lancer">
      <input
        v-model="question" :disabled="enCours"
        placeholder="qu'est-ce qu'il faut faire en cas de malware sur un poste ?"
        class="w-full max-w-2xl rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-900 disabled:opacity-60"
      >
      <button
        type="submit" :disabled="enCours || !question.trim()"
        class="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40"
      >{{ enCours ? '…' : 'Chercher' }}</button>
    </form>

    <p v-if="erreur" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ erreur }}</p>

    <template v-if="r">
      <!-- Les termes : c'est là que « faut » à un tiers du poids se serait vu en une seconde. -->
      <section class="mt-6">
        <h2 class="text-xs font-medium uppercase tracking-wide text-stone-500">Termes cherchés, avec leur rareté</h2>
        <ul class="mt-2 flex flex-wrap gap-1.5">
          <li
            v-for="t in r.termes" :key="t.mot"
            class="rounded border px-2 py-0.5 font-geistmono text-xs"
            :class="t.df === 0 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-stone-200 bg-white text-stone-700'"
            :title="`poids ${t.poids.toFixed(2)}`"
          >{{ t.mot }} <span class="opacity-50">df {{ t.df }}</span></li>
        </ul>
        <p v-if="absents.length" class="mt-2 text-sm text-amber-900">
          <strong>{{ absents.map(t => t.mot).join(', ') }}</strong> ne figure(nt) dans aucun passage :
          si la réponse déçoit, c'est probablement un écart de vocabulaire — un
          <span class="font-geistmono text-xs">mots_cles</span> à déclarer dans la fiche.
        </p>
      </section>

      <section class="mt-6">
        <div class="flex flex-wrap items-baseline gap-3">
          <h2 class="text-xs font-medium uppercase tracking-wide text-stone-500">Passages retenus</h2>
          <span class="text-xs text-stone-400">
            mode {{ r.mode }} · plancher {{ r.plancher }} · meilleur score {{ r.meilleurScore.toFixed(2) }}
            <template v-if="r.sousLePlancher"> — <strong class="text-amber-800">sous le plancher : « ce n'est pas écrit »</strong></template>
          </span>
        </div>

        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th class="py-1.5 pr-3 font-medium">Document</th>
                <th class="py-1.5 pr-3 font-medium">Section</th>
                <th class="py-1.5 pr-3 font-medium">Cat.</th>
                <th class="py-1.5 pr-3 text-right font-medium">Score</th>
                <th class="py-1.5 font-medium">Extrait</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in r.passages" :key="i" class="border-b border-stone-100 align-top">
                <td class="py-1.5 pr-3 whitespace-nowrap">
                  <span class="font-medium">{{ p.reference ?? p.titre }}</span>
                  <span v-if="p.statut && p.statut !== 'valide'" class="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">{{ p.statut }}</span>
                </td>
                <td class="py-1.5 pr-3 text-stone-600">{{ p.section ?? '—' }}</td>
                <td class="py-1.5 pr-3 text-xs text-stone-500">{{ p.categorie }}</td>
                <td class="py-1.5 pr-3 text-right font-geistmono text-xs">
                  <!-- « ramené » : la section n'a pas été trouvée, la cohésion documentaire
                       l'a rapportée avec sa fiche. Son score nul est un fait, pas un défaut. -->
                  <!-- Deux façons d'arriver sans avoir été trouvé, et elles ne disent pas
                       la même chose : la cohésion complète la fiche dominante, le renvoi
                       suit un lien qu'un passage retenu portait. -->
                  <template v-if="p.ramene"><span class="rounded bg-stone-100 px-1 text-stone-500" :title="p.via === 'renvoi' ? 'atteint en suivant un renvoi d\'un passage retenu' : 'ramené par cohésion documentaire'">{{ p.via === 'renvoi' ? 'renvoi' : 'ramené' }}</span></template>
                  <template v-else>{{ p.score.toFixed(3) }}</template>
                </td>
                <td class="py-1.5 text-xs text-stone-500">{{ p.extrait }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
