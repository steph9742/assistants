<script setup lang="ts">
import type { ResultatSonde } from '~/composables/useApi'

// CE QUE LA CLÉ ATTEINT RÉELLEMENT.
//
// Sans cet écran, un défaut de portée se découvrait une question à la fois, en production,
// sous la forme d'une réponse creuse. La liste est donc COMPLÈTE et rendue d'un bloc :
// savoir qu'on a accès à trente et un points d'entrée sur trente-neuf ne se déduit pas
// d'un essai réussi.

const api = useApi()
const resultats = ref<ResultatSonde[]>([])
const resume = ref<Record<string, number>>({})
const enCours = ref(false)
const erreur = ref('')
const fait = ref(false)

async function sonder() {
    enCours.value = true
    erreur.value = ''
    try {
        const r = await api.portee()
        resultats.value = r.resultats
        resume.value = r.resume
        fait.value = true
    }
    catch (e: any) { erreur.value = e.message }
    finally { enCours.value = false }
}

// L'ordre d'affichage n'est pas alphabétique : ce qui bloque passe devant. Une liste triée
// par nom oblige à lire trente-neuf lignes pour trouver les trois qui comptent.
const RANG: Record<string, number> = {
    hors_portee: 0, refuse: 1, absent: 2, non_configure: 3,
    injoignable: 4, source_inactive: 5, autre: 6, ouvert: 7,
}

const APPARENCE: Record<string, { libelle: string, classe: string }> = {
    ouvert: { libelle: 'ouvert', classe: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
    hors_portee: { libelle: 'hors portée', classe: 'border-red-300 bg-red-50 text-red-800' },
    refuse: { libelle: 'clé refusée', classe: 'border-red-300 bg-red-50 text-red-800' },
    absent: { libelle: 'chemin absent', classe: 'border-amber-300 bg-amber-50 text-amber-900' },
    source_inactive: { libelle: 'source amont inactive', classe: 'border-amber-300 bg-amber-50 text-amber-900' },
    non_configure: { libelle: 'non configuré', classe: 'border-stone-300 bg-stone-100 text-stone-600' },
    injoignable: { libelle: 'injoignable', classe: 'border-stone-300 bg-stone-100 text-stone-600' },
    autre: { libelle: 'code imprévu', classe: 'border-amber-300 bg-amber-50 text-amber-900' },
}

const ordonnes = computed(() => [...resultats.value].sort((a, b) =>
    (RANG[a.etat] ?? 9) - (RANG[b.etat] ?? 9)
    || a.source.localeCompare(b.source)
    || a.cle.localeCompare(b.cle)))

const ouverts = computed(() => resume.value.ouvert ?? 0)
const bloquants = computed(() => (resume.value.hors_portee ?? 0) + (resume.value.refuse ?? 0))
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold tracking-tight">Portée de la clé de service</h1>
    <p class="mt-1 max-w-3xl text-sm text-stone-500">
      Interroge <strong>tous</strong> les points d'entrée déclarés au contrat de lecture et
      rend le verdict de chacun. La portée réelle ne se déduit pas du schéma : celui-ci
      décrit tout ce que le serveur expose, y compris ce que la clé ne peut pas lire.
    </p>

    <!--
      Cette page appelle une trentaine de points d'entrée d'un coup. Le dire avant, plutôt
      que de laisser un bouton silencieux tourner vingt secondes.
    -->
    <p class="mt-3 max-w-3xl rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-600">
      <span class="font-medium text-stone-900">Uniquement des lectures.</span>
      Aucune sonde n'écrit, ne déclenche de synchronisation, ne pose ni ne lève de liste
      blanche. C'est la règle 1, et elle vaut aussi pour un outil de diagnostic.
    </p>

    <div class="mt-5 flex flex-wrap items-center gap-3">
      <button
        :disabled="enCours"
        class="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-40"
        @click="sonder"
      >{{ enCours ? 'Interrogation…' : (fait ? 'Refaire le relevé' : 'Relever la portée') }}</button>
      <span v-if="enCours" class="text-xs text-stone-500">une trentaine d'appels, quelques secondes</span>
    </div>

    <p v-if="erreur" class="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ erreur }}</p>

    <template v-if="fait">
      <div
        class="mt-6 rounded-lg border p-4"
        :class="bloquants ? 'border-red-300 bg-red-50' : 'border-emerald-200 bg-emerald-50'"
      >
        <p class="text-sm font-medium" :class="bloquants ? 'text-red-900' : 'text-emerald-900'">
          {{ ouverts }} point{{ ouverts > 1 ? 's' : '' }} d'entrée sur {{ resultats.length }} atteint{{ ouverts > 1 ? 's' : '' }}.
        </p>
        <p v-if="bloquants" class="mt-1 text-sm text-red-800">
          {{ bloquants }} refusé{{ bloquants > 1 ? 's' : '' }} par la portée de la clé. Les réponses qui
          s'appuient sur ces domaines reposeront sur un trou. La clé doit porter le scope
          <span class="font-geistmono">read</span> et <strong>aucun</strong> scope
          <span class="font-geistmono">cat:…</span>, qui restreint même en présence de
          <span class="font-geistmono">read</span>.
        </p>
        <p v-else class="mt-1 text-sm text-emerald-800">
          Aucun refus de portée. Les états restants, s'il y en a, tiennent à une source amont
          ou à un chemin absent de cette instance — pas aux droits.
        </p>
      </div>

      <table class="mt-6 w-full text-left text-sm">
        <thead>
          <tr class="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            <th class="py-2 pr-3 font-medium">État</th>
            <th class="py-2 pr-3 font-medium">Point d'entrée</th>
            <th class="py-2 font-medium">Ce que ça veut dire</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in ordonnes" :key="`${r.source}-${r.cle}`" class="border-b border-stone-100 align-top">
            <td class="py-2 pr-3 whitespace-nowrap">
              <span
                class="rounded border px-1.5 py-0.5 text-xs"
                :class="(APPARENCE[r.etat] ?? APPARENCE.autre)!.classe"
              >{{ (APPARENCE[r.etat] ?? APPARENCE.autre)!.libelle }}</span>
              <span v-if="r.code" class="ml-1.5 font-geistmono text-xs text-stone-400">{{ r.code }}</span>
            </td>
            <td class="py-2 pr-3">
              <div>{{ r.intitule }}</div>
              <!-- La requête exacte est affichée : c'est ce qui rend le relevé relisible
                   par quelqu'un qui n'a pas confiance, et rejouable au curl. -->
              <div class="mt-0.5 font-geistmono text-xs text-stone-400">{{ r.source }} · {{ r.requete }}</div>
            </td>
            <td class="py-2 text-stone-600">{{ r.explication }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
