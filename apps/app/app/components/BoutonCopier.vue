<script setup lang="ts">
// Copie le texte SOURCE, pas le rendu.
//
// Ce qui est affiché est du Markdown mis en forme ; ce qu'on colle ailleurs doit rester du
// Markdown. Coller du texte aplati ferait perdre les listes et les références, et coller du
// HTML donnerait des balises dans un ticket ou un courriel.

const props = defineProps<{ texte: string, libelle?: string }>()
const copie = ref(false)
const echec = ref('')

async function copier() {
    echec.value = ''
    try {
        // `navigator.clipboard` n'existe qu'en contexte sécurisé — HTTPS, ou localhost. En
        // HTTP simple il est absent, et l'appel échouerait sur « undefined is not an
        // object », ce qui n'apprendrait rien.
        if (!navigator.clipboard) throw new Error('presse-papiers indisponible hors HTTPS')
        await navigator.clipboard.writeText(props.texte)
        copie.value = true
        setTimeout(() => { copie.value = false }, 2000)
    }
    catch (e: any) {
        echec.value = e?.message ?? 'copie impossible'
    }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      class="rounded-md border border-stone-300 px-2.5 py-1 text-xs transition hover:bg-stone-100"
      :class="copie ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : ''"
      @click="copier"
    >{{ copie ? 'Copié' : (libelle ?? 'Copier en Markdown') }}</button>
    <span v-if="echec" class="text-xs text-red-700">{{ echec }}</span>
  </div>
</template>
