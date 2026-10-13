<script setup lang="ts">
import type { Reglage } from '~/composables/useApi'

// TOUTE cette page est construite depuis ce que renvoie l'API : libellé, description,
// type, bornes, note. Rien n'est décrit en dur ici — sans quoi il faudrait modifier un
// réglage à deux endroits, et on n'y pense jamais deux fois.
//
// Le registre est donc la source unique : le code le lit, cette page s'en construit, et
// doc/Reglages.md en est engendré.

const api = useApi()
const reglages = ref<Reglage[]>([])
const brouillon = reactive<Record<string, string>>({})
const echecs = ref<{ cle: string, motif: string }[]>([])
const message = ref('')
const erreur = ref('')
const enCours = ref(false)

const modeles = ref<{ id: string, nom: string }[]>([])
const chargementModeles = ref(false)
const erreurModeles = ref('')

const rubriques = computed(() => [...new Set(reglages.value.map(r => r.rubrique))])

/**
 * Modifications en attente, PAR RUBRIQUE.
 *
 * Un seul bouton en haut de page obligeait à remonter après chaque saisie, et ne disait pas
 * ce qu'on s'apprêtait à enregistrer — sur vingt-huit réglages répartis en huit rubriques,
 * « 3 modifications » n'apprend rien. Chaque rubrique enregistre désormais les siennes,
 * là où on vient de les saisir.
 */
function clesDe(rubrique: string): string[] {
    return reglages.value.filter(r => r.rubrique === rubrique).map(r => r.cle)
}

const modifiesDe = (rubrique: string) =>
    clesDe(rubrique).filter(c => brouillon[c] !== undefined)

const modifies = computed(() => Object.keys(brouillon).filter(c => brouillon[c] !== undefined))
const enregistrement = ref<string | null>(null)

async function charger() {
    try {
        reglages.value = (await api.reglages()).reglages
        erreur.value = ''
    }
    catch (e: any) { erreur.value = e.message }
}
await charger()

async function chargerModeles() {
    chargementModeles.value = true
    erreurModeles.value = ''
    try { modeles.value = (await api.modeles()).modeles }
    catch (e: any) { erreurModeles.value = e.message }
    finally { chargementModeles.value = false }
}

async function enregistrer(rubrique?: string) {
    // Sans rubrique, on enregistre tout — le bouton du bas de page.
    const cles = rubrique ? modifiesDe(rubrique) : Object.keys(brouillon)
    if (!cles.length) return

    enregistrement.value = rubrique ?? '(tout)'
    enCours.value = true
    echecs.value = []
    message.value = ''
    erreur.value = ''
    try {
        const lot = Object.fromEntries(cles.map(c => [c, brouillon[c]!]))
        const r = await api.enregistrerReglages(lot)
        reglages.value = r.reglages
        // On n'efface QUE ce qui vient d'être envoyé : les saisies en cours dans les autres
        // rubriques ne doivent pas disparaître sous les doigts.
        for (const c of cles) delete brouillon[c]
        message.value = rubrique ? `${rubrique} — enregistré.` : 'Enregistré.'
    }
    catch (e: any) {
        // Le serveur valide TOUT avant d'écrire quoi que ce soit : un lot refusé n'a rien
        // appliqué. On peut donc afficher les motifs sans avoir à dire ce qui est passé.
        if (e.message?.includes('echecs')) echecs.value = []
        erreur.value = e.message
    }
    finally { enCours.value = false; enregistrement.value = null }
}

const valeurAffichee = (r: Reglage) => brouillon[r.cle] ?? r.valeur ?? ''

const embeddings = ref<{ disponible: boolean, detail: string, route?: string, dimensions?: number } | null>(null)
/**
 * Un bouton qui travaille doit le dire.
 *
 * Celui-ci n'avait aucun état d'attente, contrairement à « Charger la liste » juste à côté.
 * La sonde essaie quatre routes en série : sur une adresse injoignable, on cliquait et il ne
 * se passait rien pendant plus d'une minute. Le bouton passait pour cassé alors qu'il
 * faisait exactement son travail.
 */
const sondage = ref(false)
async function sonder() {
    if (sondage.value) return
    sondage.value = true
    embeddings.value = null
    try { embeddings.value = await api.sonderEmbeddings() }
    catch (e: any) { embeddings.value = { disponible: false, detail: e.message } }
    finally { sondage.value = false }
}

const test = ref<Record<string, string>>({})
async function tester(usage: string) {
    test.value[usage] = '…'
    try {
        const r = await api.testerModele(usage)
        test.value[usage] = r.ok ? `répond : ${r.reponse}` : `échec : ${r.message}`
    }
    catch (e: any) { test.value[usage] = `échec : ${e.message}` }
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Réglages</h1>
        <p class="mt-1 text-sm text-stone-500">
          Un champ vide rétablit la valeur par défaut. Le détail de chaque réglage est dans
          <span class="font-geistmono text-xs">doc/Reglages.md</span>, engendré depuis le même registre que cette page.
        </p>
      </div>
      <p v-if="modifies.length" class="text-sm text-amber-800">
        {{ modifies.length }} modification{{ modifies.length > 1 ? 's' : '' }} non enregistrée{{ modifies.length > 1 ? 's' : '' }}
      </p>
    </div>

    <p v-if="erreur" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ erreur }}</p>
    <p v-if="message" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{{ message }}</p>

    <section v-for="rub in rubriques" :key="rub" class="mt-8">
      <h2 class="border-b border-stone-200 pb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
        {{ rub }}
      </h2>

      <div class="mt-4 space-y-6">
        <div v-for="r in reglages.filter(x => x.rubrique === rub)" :key="r.cle">
          <div class="flex flex-wrap items-baseline gap-2">
            <label :for="r.cle" class="text-sm font-medium">{{ r.libelle }}</label>
            <span class="font-geistmono text-xs text-stone-400">{{ r.cle }}</span>
            <span v-if="r.portee === 'instance'" class="rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">
              propre à l'instance
            </span>
            <span v-if="r.surcharge" class="rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-700">modifié</span>
          </div>

          <p class="mt-1 text-sm text-stone-600">{{ r.description }}</p>
          <p v-if="r.note" class="mt-1 rounded border-l-2 border-amber-400 bg-amber-50 py-1 pl-2 text-xs text-amber-900">
            {{ r.note }}
          </p>

          <!-- Secret : jamais renvoyé en clair par l'API, donc jamais réaffiché. -->
          <div v-if="r.type === 'secret'" class="mt-2 flex items-center gap-3">
            <input
              :id="r.cle" v-model="brouillon[r.cle]" type="password" autocomplete="new-password"
              :placeholder="r.renseigne ? '•••••••• (renseigné)' : 'non renseigné'"
              class="w-full max-w-md rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900"
            >
          </div>

          <!-- Le modèle se CHOISIT dans la liste de l'API, jamais à la main. -->
          <div v-else-if="r.type === 'modele'" class="mt-2">
            <div class="flex flex-wrap items-center gap-2">
              <select
                :id="r.cle" :value="valeurAffichee(r)"
                class="w-full max-w-md rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900"
                @change="brouillon[r.cle] = ($event.target as HTMLSelectElement).value"
              >
                <option value="">— aucun —</option>
                <option v-if="valeurAffichee(r) && !modeles.some(m => m.id === valeurAffichee(r))" :value="valeurAffichee(r)">
                  {{ valeurAffichee(r) }} (enregistré, liste non chargée)
                </option>
                <option v-for="m in modeles" :key="m.id" :value="m.id">{{ m.nom }}</option>
              </select>
              <button
                class="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100"
                :disabled="chargementModeles" @click="chargerModeles"
              >{{ chargementModeles ? '…' : 'Charger la liste' }}</button>
              <button
                class="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100"
                @click="tester(r.cle.includes('journaux') ? 'journaux' : 'assistant')"
              >Tester</button>
            </div>
            <p v-if="erreurModeles" class="mt-1 text-xs text-red-700">{{ erreurModeles }}</p>
            <p v-if="test[r.cle.includes('journaux') ? 'journaux' : 'assistant']" class="mt-1 text-xs text-stone-600">
              {{ test[r.cle.includes('journaux') ? 'journaux' : 'assistant'] }}
            </p>
          </div>

          <textarea
            v-else-if="r.type === 'texte_long'" :id="r.cle" rows="4"
            :value="valeurAffichee(r)" :placeholder="r.defaut || 'consigne par défaut du code'"
            class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5 font-geistmono text-xs outline-none focus:border-stone-900"
            @input="brouillon[r.cle] = ($event.target as HTMLTextAreaElement).value"
          />

          <div v-else-if="r.type === 'booleen'" class="mt-2">
            <label class="flex items-center gap-2 text-sm">
              <input
                :id="r.cle" type="checkbox" :checked="valeurAffichee(r) === 'true'"
                class="size-4 rounded border-stone-300"
                @change="brouillon[r.cle] = ($event.target as HTMLInputElement).checked ? 'true' : 'false'"
              >
              <span class="text-stone-600">{{ valeurAffichee(r) === 'true' ? 'activé' : 'désactivé' }}</span>
            </label>
          </div>

          <div v-else class="mt-2 flex items-center gap-2">
            <input
              :id="r.cle" :type="r.type === 'nombre' ? 'number' : 'text'"
              :value="valeurAffichee(r)" :min="r.min" :max="r.max" :step="r.type === 'nombre' ? 'any' : undefined"
              :placeholder="r.defaut"
              class="w-full max-w-md rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900"
              @input="brouillon[r.cle] = ($event.target as HTMLInputElement).value"
            >
            <span v-if="r.unite" class="text-sm text-stone-500">{{ r.unite }}</span>
          </div>

          <p class="mt-1 text-xs text-stone-400">
            défaut <span class="font-geistmono">{{ r.defaut || '(vide)' }}</span>
            <template v-if="r.min !== undefined || r.max !== undefined">
              · entre {{ r.min ?? '—' }} et {{ r.max ?? '—' }}
            </template>
          </p>

          <!-- La sonde d'embeddings est rattachée au réglage qu'elle éclaire. -->
          <div v-if="r.cle === 'embeddings.actif'" class="mt-2">
            <button
              class="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-50"
              :disabled="sondage" @click="sonder"
            >{{ sondage ? 'Sondage en cours…' : "Sonder le point d'entrée" }}</button>
            <span v-if="sondage" class="ml-2 text-xs text-stone-500">
              quatre routes essayées l'une après l'autre, jusqu'à huit secondes chacune
            </span>
            <p v-if="embeddings" class="mt-1 text-xs" :class="embeddings.disponible ? 'text-emerald-700' : 'text-amber-800'">
              <template v-if="embeddings.disponible">
                Disponible sur <span class="font-geistmono">{{ embeddings.route }}</span>, {{ embeddings.dimensions }} dimensions.
              </template>
              <template v-else>
                Indisponible — {{ embeddings.detail }}. La recherche reste lexicale, ce qui
                sur ce corpus n'est pas un pis-aller.
              </template>
            </p>
          </div>
        </div>
      </div>

      <div class="mt-5 flex items-center gap-3 border-t border-stone-200 pt-4">
        <button
          :disabled="enCours || !modifiesDe(rub).length"
          class="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-30"
          @click="enregistrer(rub)"
        >
          {{ enregistrement === rub ? 'Enregistrement…' : 'Enregistrer' }}
          <template v-if="modifiesDe(rub).length"> ({{ modifiesDe(rub).length }})</template>
        </button>
        <span v-if="modifiesDe(rub).length" class="text-xs text-amber-800">
          {{ modifiesDe(rub).join(' · ') }}
        </span>
        <span v-else class="text-xs text-stone-400">aucune modification dans cette rubrique</span>
      </div>
    </section>
  </div>
</template>
