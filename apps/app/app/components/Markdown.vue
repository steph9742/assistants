<script setup lang="ts">
// Le rendu lui-même vit dans `~/utils/markdown` : c'est du code pur, et l'affirmation de
// sécurité qu'il porte est vérifiée par `markdown.test.ts`.
import { rendreMarkdown } from '~/utils/markdown'
import type { SourceReperee } from '~/utils/citations'

const props = defineProps<{ texte: string, sources?: SourceReperee[] }>()

// Le clic sur un marqueur de citation remonte au parent, qui sait où vit la carte de
// source. On écoute le conteneur plutôt que chaque ancre : le HTML est posé par `v-html`,
// aucun gestionnaire Vue ne peut y être attaché.
const emit = defineEmits<{ citer: [cle: string] }>()

const html = computed(() => rendreMarkdown(props.texte, props.sources ?? []))

function surClic(e: MouseEvent) {
    const ancre = (e.target as HTMLElement | null)?.closest('[data-cite]')
    const cle = ancre?.getAttribute('data-cite')
    if (!cle) return
    // La navigation par ancre irait plus vite que le dépliage du dossier des sources, et
    // sauterait dans le vide : c'est le parent qui ouvre, puis fait défiler.
    e.preventDefault()
    emit('citer', cle)
}
</script>

<template>
  <!--
    `v-html` sur une chaîne que ce composant est seul à produire, et dont l'entrée a été
    échappée avant toute autre transformation. C'est ce qui rend cet usage défendable ici.
  -->
  <div class="text-sm leading-relaxed [&>*:first-child]:mt-0" @click="surClic" v-html="html" />
</template>
