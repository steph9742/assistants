<script setup lang="ts">
// LE JOURNAL DES LACUNES — la sortie la plus utile de l'outil.
//
// Chaque ligne est une question que quelqu'un s'est posée et à laquelle la documentation ne
// répond pas. Ce n'est pas un journal d'erreurs : c'est la file de rédaction documentaire.
// D'où la présentation en liste de travail, avec une case à cocher, et non en tableau de
// bord de supervision.
const api = useApi()
const lacunes = ref<any[]>([])
const erreur = ref('')

async function charger() {
    try { lacunes.value = (await api.lacunes()).lacunes; erreur.value = '' }
    catch (e: any) { erreur.value = e.message }
}
await charger()

async function traiter(l: any) {
    try { await api.marquerLacune(l.id, true); await charger() }
    catch (e: any) { erreur.value = e.message }
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold tracking-tight">Journal des lacunes</h1>
    <p class="mt-1 text-sm text-stone-500">
      Deux files en une. Les questions restées <strong>sans réponse</strong> — un trou dans
      la documentation. Et les réponses <strong>signalées à côté</strong> par leur lecteur —
      un trou que l'outil ne voit pas lui-même, puisqu'il a répondu.
    </p>

    <p v-if="erreur" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ erreur }}</p>

    <p v-if="!lacunes.length && !erreur" class="mt-8 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
      Aucune lacune en attente. Soit la documentation couvre ce qu'on lui demande, soit
      l'outil est peu utilisé — les deux se ressemblent ici, et seule la fréquentation
      permet de les distinguer.
    </p>

    <ul v-else class="mt-6 space-y-2">
      <li v-for="l in lacunes" :key="l.id" class="rounded-lg border border-stone-200 bg-white p-3">
        <div class="flex items-start justify-between gap-4">
          <p class="text-sm font-medium">
            <!-- Le signalement se distingue au premier regard : ce n'est pas le même
                 travail. Une lacune se comble en écrivant ; un signalement se comprend
                 d'abord — mauvaise fiche citée ou bonne fiche mal lue, et l'écran
                 Diagnostic tranche entre les deux. -->
            <span
              v-if="l.origine === 'signalement'"
              class="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800"
            >réponse à côté</span>
            {{ l.question }}
          </p>
          <button
            class="shrink-0 rounded-md border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100"
            @click="traiter(l)"
          >Documentée</button>
        </div>
        <!--
          CE QUI MANQUAIT, DANS LES MOTS DU SIGNALANT. C'est la seule ligne du journal qui
          ne se déduit de rien — la question, les citations et les sources consultées sont
          déjà là. Affichée en évidence, et pas en note de bas de ligne : c'est elle qui dit
          quoi écrire.
        -->
        <p v-if="l.ceQuiManquait" class="mt-1 border-l-2 border-stone-300 pl-2 text-sm text-stone-700">
          {{ l.ceQuiManquait }}
        </p>
        <p class="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-400">
          <span>{{ new Date(l.date).toLocaleString('fr-FR') }}</span>
          <span v-if="l.utilisateur">{{ l.utilisateur }}</span>
          <span v-if="l.meilleurScore">meilleur score {{ l.meilleurScore }}</span>
          <span v-if="l.citations?.length">citait : {{ l.citations.join(' · ') }}</span>
          <span v-if="l.sourcesConsultees?.length">cherché dans : {{ l.sourcesConsultees.join(', ') }}</span>
          <span v-else class="text-amber-700">aucune source active au moment de la question</span>
        </p>
      </li>
    </ul>

    <p class="mt-8 text-xs text-stone-500">
      Les sources consultées disent si le trou est <strong>documentaire</strong> — rien
      n'est écrit — ou <strong>d'index</strong> : la source qui aurait la réponse n'était pas
      active ce jour-là. Sans cette distinction, on réécrirait une procédure qui existe déjà.
    </p>
  </div>
</template>
