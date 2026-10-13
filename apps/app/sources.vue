<script setup lang="ts">
const api = useApi()
const fraicheur = ref<any>({ seuilHeures: 24, sources: [], alerte: false })
const sources = ref<any[]>([])
const erreur = ref('')
const test = ref<Record<string, string>>({})

async function charger() {
    try {
        fraicheur.value = await api.fraicheur()
        sources.value = (await api.sources()).sources
        erreur.value = ''
    }
    catch (e: any) { erreur.value = e.message }
}
await charger()

const etatDe = (nom: string) => fraicheur.value.sources.find((s: any) => s.nom === nom)

async function tester(s: any) {
    test.value[s.id] = '…'
    try {
        const r = await api.testerSource(s.id)
        test.value[s.id] = r.ok ? `${r.fichiers} fichiers lisibles` : `échec : ${r.message}`
    }
    catch (e: any) { test.value[s.id] = `échec : ${e.message}` }
}

const COULEUR: Record<string, string> = {
    ok: 'bg-emerald-100 text-emerald-800',
    echec: 'bg-red-100 text-red-800',
    en_cours: 'bg-sky-100 text-sky-800',
    jamais: 'bg-stone-200 text-stone-700',
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold tracking-tight">Sources</h1>
    <p class="mt-1 text-sm text-stone-500">
      Ce qui est indexé, et depuis quand. Une source de plus est une ligne de plus, jamais
      une ligne de code — c'est ce qui permet de déployer une seconde instance sans fork.
    </p>

    <p v-if="erreur" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ erreur }}</p>

    <p v-if="!sources.length && !erreur" class="mt-8 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
      Aucune source configurée. L'assistant répondra « ce n'est pas écrit » à tout, ce qui
      ressemble à une documentation vide alors que c'est un index vide.
    </p>

    <ul class="mt-6 space-y-3">
      <li v-for="s in sources" :key="s.id" class="rounded-lg border border-stone-200 bg-white p-4">
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="font-medium">{{ s.nom }}</span>
          <span class="font-geistmono text-xs text-stone-400">{{ s.type }}</span>
          <span
            class="rounded px-1.5 py-0.5 text-xs font-medium"
            :class="COULEUR[etatDe(s.nom)?.etat ?? 'jamais'] ?? 'bg-stone-200 text-stone-700'"
          >{{ etatDe(s.nom)?.etat ?? 'jamais' }}</span>
          <span v-if="!s.actif" class="rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-700">inactive</span>
          <span v-if="etatDe(s.nom)?.perimee" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">périmée</span>
        </div>

        <p v-if="s.autorite" class="mt-1 text-sm text-stone-600">Fait autorité sur : {{ s.autorite }}</p>

        <p class="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-400">
          <span v-if="etatDe(s.nom)?.dernierSucces">
            dernière synchronisation {{ new Date(etatDe(s.nom).dernierSucces).toLocaleString('fr-FR') }}
            ({{ etatDe(s.nom).heuresDepuisSucces }} h)
          </span>
          <span v-else class="text-amber-700">jamais synchronisée</span>
          <span v-if="etatDe(s.nom)?.documentsVus">{{ etatDe(s.nom).documentsVus }} documents</span>
          <span :class="s.jetonRenseigne ? '' : 'text-amber-700'">
            {{ s.jetonRenseigne ? 'identifiant renseigné' : 'aucun identifiant' }}
          </span>
        </p>

        <p v-if="etatDe(s.nom)?.message" class="mt-2 rounded bg-red-50 p-2 font-geistmono text-xs text-red-800">
          {{ etatDe(s.nom).message }}
        </p>

        <div class="mt-3 flex items-center gap-2">
          <button class="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100" @click="tester(s)">
            Tester l'accès
          </button>
          <span v-if="test[s.id]" class="text-xs text-stone-600">{{ test[s.id] }}</span>
        </div>
      </li>
    </ul>

    <p class="mt-8 text-xs text-stone-500">
      La synchronisation ne tourne pas dans le serveur : c'est un processus court lancé par
      cron (<span class="font-geistmono">bun run --filter @assistants/server synchro</span>).
      Voir <span class="font-geistmono">doc/Exploitation-MCO.md</span> pour la raison.
    </p>
  </div>
</template>
