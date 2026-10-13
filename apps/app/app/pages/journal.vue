<script setup lang="ts">
// JOURNAL DE CONSULTATION — qui a demandé quoi, et quand.
//
// Réservé aux administrateurs, contrairement à la fraîcheur : celle-ci dit l'état de
// l'outil, celui-ci dit ce que les gens ont demandé. Ce n'est pas la même chose et ça ne se
// lit pas par les mêmes personnes.
const api = useApi()
const lignes = ref<any[]>([])
const erreur = ref('')

try { lignes.value = (await api.consultations()).consultations }
catch (e: any) { erreur.value = e.message }

const OUTIL: Record<string, string> = {
    assistant: 'bg-sky-100 text-sky-800',
    journaux: 'bg-violet-100 text-violet-800',
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold tracking-tight">Journal de consultation</h1>
    <p class="mt-1 text-sm text-stone-500">
      Qui a demandé quoi, et quand. Pièce du dossier RGPD, pas outil de supervision.
    </p>

    <!--
      La règle est énoncée dans l'interface et pas seulement dans le code : quelqu'un qui
      lit cet écran doit savoir ce qu'il ne contient pas, sans avoir à lire les sources.
    -->
    <p class="mt-4 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-600">
      <span class="font-medium text-stone-900">Le contenu collé dans l'analyse de journaux n'est jamais consigné</span>
      — ni le texte, ni un extrait, ni un condensat. Seulement sa longueur, le modèle et la
      durée. Un condensat d'adresse IP se retrouve en quelques secondes par force brute.
    </p>

    <p v-if="erreur" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ erreur }}</p>

    <p v-if="!lignes.length && !erreur" class="mt-8 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
      Aucune consultation enregistrée.
    </p>

    <div v-else-if="lignes.length" class="mt-6 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th class="py-2 pr-3 font-medium">Date</th>
            <th class="py-2 pr-3 font-medium">Qui</th>
            <th class="py-2 pr-3 font-medium">Outil</th>
            <th class="py-2 pr-3 font-medium">Demande</th>
            <th class="py-2 pr-3 font-medium">Documents cités</th>
            <th class="py-2 font-medium">Origine</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in lignes" :key="l.id" class="border-b border-stone-100 align-top">
            <td class="py-2 pr-3 whitespace-nowrap text-xs text-stone-500">
              {{ new Date(l.date).toLocaleString('fr-FR') }}
            </td>
            <td class="py-2 pr-3 text-xs">{{ l.utilisateur ?? '—' }}</td>
            <td class="py-2 pr-3">
              <span class="rounded px-1.5 py-0.5 text-xs font-medium" :class="OUTIL[l.outil] ?? 'bg-stone-100'">
                {{ l.outil }}
              </span>
            </td>
            <td class="py-2 pr-3">
              <span v-if="l.question">{{ l.question }}</span>
              <span v-else class="text-xs italic text-stone-400">
                non consigné — {{ l.tailleEntree }} caractères
              </span>
            </td>
            <td class="py-2 pr-3 text-xs text-stone-600">
              <span v-if="l.erreur" class="text-red-700">{{ l.erreur }}</span>
              <span v-else-if="l.trouve === false" class="italic">ce n'est pas écrit</span>
              <span v-else-if="l.citations?.length">
                {{ l.citations.map((c: any) => c.reference ?? c.titre).join(' · ') }}
              </span>
              <span v-else>—</span>
            </td>
            <td class="py-2 font-geistmono text-xs text-stone-400">
              <div v-if="l.modele">{{ l.modele }}</div>
              <div v-if="l.consigne">{{ l.consigne }}</div>
              <div v-if="l.dureeMs">{{ l.dureeMs }} ms</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="mt-8 text-xs text-stone-500">
      Les lignes sont supprimées passé la durée de conservation
      (<span class="font-geistmono">audit.retention_jours</span>), par la purge qui tourne
      avec la synchronisation. Une durée qu'aucune tâche n'applique serait une intention et
      non un fait.
    </p>
  </div>
</template>
