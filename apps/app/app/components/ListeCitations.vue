<script setup lang="ts">
import type { Citation } from '~/composables/useApi'
import { cleCitation } from '~/utils/citations'

const props = defineProps<{
    citations: Citation[]
    titre?: string
    /** Clé de la source à mettre en évidence — celle qu'on vient de cliquer dans la réponse. */
    surligne?: string | null
}>()

// Le statut est affiché AUSSI VISIBLEMENT que la référence, et non relégué en gris.
// 35 des 53 fiches du corpus sont en brouillon : sans cette mention, l'assistant
// présenterait majoritairement des brouillons comme des procédures arrêtées.
const COULEUR: Record<string, string> = {
    valide: 'bg-emerald-100 text-emerald-800',
    brouillon: 'bg-amber-100 text-amber-800',
    obsolete: 'bg-red-100 text-red-800',
}

const avecCle = computed(() => props.citations.map(c => ({ c, cle: cleCitation(c) })))
</script>

<template>
  <section v-if="citations.length" class="mt-4">
    <h2 v-if="titre !== ''" class="text-xs font-semibold uppercase tracking-wide text-stone-500">
      {{ titre ?? 'Sources' }}
    </h2>
    <ul class="mt-2 space-y-2">
      <li
        v-for="({ c, cle }, i) in avecCle" :id="`src-${cle}`" :key="`${cle}-${i}`"
        class="scroll-mt-24 rounded-lg border bg-white p-3 text-sm transition"
        :class="surligne === cle
          ? 'border-stone-900 ring-2 ring-stone-900/15'
          : 'border-stone-200'"
      >
        <div class="flex flex-wrap items-baseline gap-2">
          <component
            :is="c.url ? 'a' : 'span'" :href="c.url ?? undefined"
            target="_blank" rel="noopener"
            class="font-medium" :class="c.url ? 'text-stone-900 underline decoration-stone-300 hover:decoration-stone-900' : ''"
          >
            <span v-if="c.reference" class="font-geistmono">{{ c.reference }}</span>
            <span v-if="c.reference"> — </span>{{ c.titre }}
          </component>

          <span
            v-if="c.statut"
            class="rounded px-1.5 py-0.5 text-xs font-medium"
            :class="COULEUR[c.statut] ?? 'bg-stone-100 text-stone-700'"
          >{{ c.statut }}</span>

          <!--
            Un document sans statut n'est pas un document valide : c'est un document dont on
            ne sait rien. Les fichiers Nextcloud n'ont pas d'en-tête, donc pas de statut, et
            le filtre « obsolète » ne peut pas s'y appliquer. Le dire plutôt qu'afficher un
            vide qui se lirait comme « rien à signaler ».
          -->
          <span v-else class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
            statut inconnu
          </span>
        </div>

        <p class="mt-1 text-stone-600">
          <span v-if="c.section">{{ c.section }}</span>
          <span v-else class="italic">en-tête du document</span>
        </p>

        <p class="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-400">
          <span>{{ c.source }}</span>
          <span v-if="c.version">version {{ c.version }}</span>
          <span v-if="c.dateRevision">révision {{ c.dateRevision }}</span>
          <span v-else class="italic">date de révision inconnue</span>
        </p>
      </li>
    </ul>
  </section>
</template>
