<script setup lang="ts">
// CE QUI A ÉTÉ DEMANDÉ, ET CE QUI A ÉTÉ REÇU.
//
// Trois endroits du code affirmaient que « la requête exécutée et le résultat brut sont
// affichés à côté de la réponse » — dont la consigne envoyée au modèle. C'était faux. Rien
// n'était affiché, et l'affirmation la plus gênante était celle faite au modèle : on lui
// disait de ne pas recopier le résultat puisqu'il était visible ailleurs, alors qu'il ne
// l'était nulle part.

const props = defineProps<{ requete: string, corps: unknown, mentions?: string[] }>()

const json = computed(() => {
    try { return JSON.stringify(props.corps, null, 2) }
    // Un corps qui ne se sérialise pas ne doit pas faire écran blanc : on dit ce qu'il est.
    catch { return `(résultat non sérialisable : ${Object.prototype.toString.call(props.corps)})` }
})

// Au-delà, l'affichage devient illisible et coûteux à rendre. Le bouton copier, lui, emporte
// tout : c'est ce qu'on colle dans un ticket ou qu'on rejoue.
const PLAFOND = 20_000
const tronque = computed(() => json.value.length > PLAFOND)
const apercu = computed(() => tronque.value ? `${json.value.slice(0, PLAFOND)}\n…` : json.value)
</script>

<template>
  <div class="mt-4 border-t border-stone-200 pt-3">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <p class="font-geistmono text-xs text-stone-500">{{ requete }}</p>
      <BoutonCopier :texte="json" libelle="Copier le résultat" />
    </div>

    <!--
      Les mentions obligatoires sont fondues dans la réponse par le modèle. Les montrer ici
      permet de vérifier qu'aucune n'a été perdue en route — c'est le seul endroit où la
      liste brute est consultable.
    -->
    <details v-if="mentions?.length" class="mt-2">
      <summary class="cursor-pointer text-xs text-stone-500 hover:text-stone-900">
        {{ mentions.length }} mise{{ mentions.length > 1 ? 's' : '' }} en garde attachée{{ mentions.length > 1 ? 's' : '' }} à cette réponse
      </summary>
      <ul class="mt-1 space-y-1 pl-4 text-xs text-stone-600">
        <li v-for="(m, i) in mentions" :key="i" class="list-disc">{{ m }}</li>
      </ul>
    </details>

    <details class="mt-2">
      <summary class="cursor-pointer text-xs text-stone-500 hover:text-stone-900">
        Résultat brut
        <span v-if="tronque" class="text-stone-400">— tronqué à l'affichage, le bouton copie tout</span>
      </summary>
      <pre class="mt-1 max-h-96 overflow-auto rounded-lg bg-stone-100 p-3 font-geistmono text-xs">{{ apercu }}</pre>
    </details>
  </div>
</template>
