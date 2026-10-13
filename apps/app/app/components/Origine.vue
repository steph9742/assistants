<script setup lang="ts">
// RÈGLE 7 — toute sortie porte son origine.
//
// Affiché à côté de CHAQUE réponse, jamais replié derrière un bouton : un texte engendré
// doit rester distinguable d'un constat, y compris quand quelqu'un le recopie ailleurs.
// Un incident finit parfois en pièce d'un dossier.
defineProps<{ origine: { modele: string, consigne: string, date: string, etapes?: Record<string, string> } }>()
</script>

<template>
  <p class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-stone-200 pt-3 text-xs text-stone-500">
    <span class="rounded bg-stone-100 px-1.5 py-0.5 font-geistmono">texte engendré</span>
    <span>modèle <span class="font-geistmono text-stone-700">{{ origine.modele }}</span></span>
    <span v-for="(m, etape) in origine.etapes ?? {}" :key="etape">
      {{ etape }} <span class="font-geistmono text-stone-700">{{ m }}</span>
    </span>
    <span>consigne <span class="font-geistmono text-stone-700">{{ origine.consigne }}</span></span>
    <span>{{ new Date(origine.date).toLocaleString('fr-FR') }}</span>
  </p>
</template>
