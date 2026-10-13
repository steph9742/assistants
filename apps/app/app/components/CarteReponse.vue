<script setup lang="ts">
// LA CARTE DE RÉPONSE — un tour du fil, complet et autonome.
//
// Chaque tour porte tout ce qu'une réponse portait seule : les quatre issues, le diagnostic,
// le résultat brut, l'origine, le signalement, les citations. Rien n'a été retiré quand la
// page est devenue un fil — un tour ancien reste aussi relisible que le dernier, c'est la
// condition pour qu'un fil soit auditable.
import type { Reponse } from '~/composables/useApi'
import { citeesDans, cleCitation } from '~/utils/citations'

const props = defineProps<{
    /** La question telle que TAPÉE — le signalement la consigne, pas la reformulation. */
    question: string
    reponse: Reponse
}>()

const emit = defineEmits<{ corriger: [question: string] }>()

const api = useApi()
const erreur = ref('')

/** Les termes que l'index ne connaît pas du tout — ceux qui expliquent l'échec. */
const absents = computed(() =>
    (props.reponse.diagnostic?.termes ?? []).filter(t => t.df === 0).map(t => t.mot))

/**
 * CE QUI FONDE LA RÉPONSE, ET CE QUI A SEULEMENT ÉTÉ LU.
 *
 * Vingt sources au même niveau font un mur où la plus utile ne se voit plus. La distinction
 * n'est pas devinée : elle se lit dans les marqueurs que le modèle a écrits.
 */
const cles = computed(() => citeesDans(props.reponse.texte, props.reponse.citations))
const citees = computed(() => props.reponse.citations.filter(c => cles.value.has(cleCitation(c))))
const consultees = computed(() => props.reponse.citations.filter(c => !cles.value.has(cleCitation(c))))

const brouillons = computed(() => props.reponse.citations.filter(c => c.statut === 'brouillon').length)
const sansStatut = computed(() => props.reponse.citations.filter(c => !c.statut).length)

const ouvert = ref(false)
const surligne = ref<string | null>(null)

/** Ouvrir le dossier, puis amener la source sous les yeux — dans cet ordre, sinon on saute dans le vide. */
async function montrerSource(cle: string) {
    ouvert.value = true
    surligne.value = cle
    await nextTick()
    document.getElementById(`src-${cle}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/**
 * Signaler une réponse à côté. La question consignée est la paire tapé + compris quand la
 * reformulation a joué : si elle a déformé, c'est précisément ce que le lecteur du journal
 * doit voir.
 *
 * Et une phrase libre, facultative : « ce qui manquait ». C'est la seule information du
 * journal des lacunes qui ne se déduit de rien — le reste (question, citations, sources
 * consultées) est déjà là. L'exiger ferait renoncer au signalement ; la proposer ne coûte
 * rien à qui n'a rien à ajouter.
 */
const enSignalement = ref(false)
const ceQuiManquait = ref('')
const signale = ref(false)

async function signaler() {
    if (signale.value) return
    const citations = props.reponse.citations.map(c =>
        [c.reference, c.section].filter(Boolean).join(' — ') || c.titre)
    const q = props.reponse.questionComprise
        ? `${props.reponse.questionComprise} (tapé : ${props.question})`
        : props.question
    try {
        await api.signaler(q, citations, ceQuiManquait.value.trim() || undefined)
        signale.value = true
        enSignalement.value = false
    }
    catch (e: any) { erreur.value = e.message }
}
</script>

<template>
  <div>
    <!--
      LA QUESTION COMPRISE, AFFICHÉE ET CORRIGEABLE. La chaîne entière a tourné sur la
      reformulation, pas sur ce qui a été tapé — le taire rendrait la requête affichée
      mensongère, et c'est la règle 7 appliquée au fil. Elle était affichée sans qu'on
      puisse rien en faire : « reformuler » la recopie dans le champ de saisie, où elle
      s'édite avant d'être reposée.
    -->
    <div
      v-if="reponse.questionComprise"
      class="mb-2 flex flex-wrap items-start justify-between gap-2 rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-sm text-stone-600"
    >
      <p class="min-w-0">
        <span class="text-xs font-medium uppercase tracking-wide text-stone-400">Question comprise</span><br>
        {{ reponse.questionComprise }}
      </p>
      <button
        class="shrink-0 rounded border border-stone-300 bg-white px-2 py-1 text-xs text-stone-600 transition hover:bg-stone-50 hover:text-stone-900"
        title="Recopier cette question dans le champ de saisie pour la corriger"
        @click="emit('corriger', reponse.questionComprise!)"
      >Reformuler</button>
    </div>

    <p v-if="erreur" class="mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">{{ erreur }}</p>

    <!--
      TROIS ABSENCES DE RÉPONSE, TROIS TEXTES.
      Elles s'affichaient toutes comme un trou documentaire versé au journal des lacunes. Un
      422 de Sniff sur un paramètre invalide se lisait donc « rien dans les sources ne répond
      à cette question, elle a été versée au journal des lacunes » — alors qu'aucune lacune
      n'était versée et que la panne était chez nous. Une panne déguisée en absence de
      documentation : la faute même que cet outil existe pour empêcher, commise par l'outil
      sur lui-même.

      La distinction reste entière ; c'est l'EXPLICATION qui se replie. Elle s'apprend à la
      première rencontre et devient du bruit à la dixième.
    -->

    <!-- 1. Une source n'a pas répondu. Ce n'est PAS une absence de documentation. -->
    <div
      v-if="reponse.issue === 'echec_source'"
      class="rounded-lg border-2 border-amber-400 bg-amber-50 p-4"
    >
      <p class="font-medium text-amber-900">La source n'a pas répondu.</p>
      <p class="mt-2 text-sm text-amber-900">{{ reponse.texte }}</p>
      <p v-if="reponse.donnees?.requete" class="mt-2 font-geistmono text-xs text-amber-800">
        {{ reponse.donnees.requete }}
      </p>
      <details class="mt-2">
        <summary class="cursor-pointer text-xs text-amber-800 hover:text-amber-950">Pourquoi ce n'est pas « ce n'est pas écrit »</summary>
        <p class="mt-1 text-sm text-amber-900">
          Ce n'est ni « rien à signaler », ni « ce n'est pas écrit ». Aucune lacune n'a été
          versée : une source en panne ne dit rien sur ce que contient la documentation.
        </p>
      </details>
    </div>

    <!-- 2. Trouvé, mais illisible — un PDF scanné. Aucune lacune non plus. -->
    <div
      v-else-if="reponse.issue === 'illisible'"
      class="rounded-lg border border-stone-300 bg-white p-4"
    >
      <p class="font-medium">{{ reponse.texte }}</p>
      <details class="mt-2">
        <summary class="cursor-pointer text-xs text-stone-500 hover:text-stone-900">Pourquoi aucune lacune n'a été versée</summary>
        <p class="mt-1 text-sm text-stone-600">
          Des documents existent sur ce sujet, mais leur contenu n'a pas pu être extrait.
          Ce n'est pas un trou dans la documentation : c'est un défaut d'indexation.
        </p>
      </details>
    </div>

    <!--
      3. Des documents parlent du sujet, mais pas de CETTE question.
      Ce cas s'affichait comme « rien dans les sources ne répond », en jetant ses citations.
      Le lecteur perdait l'information la plus utile : le document existe, il ne traite pas
      de ce point — donc on sait déjà dans quelle fiche écrire.
    -->
    <div
      v-else-if="reponse.issue === 'insuffisant'"
      class="rounded-lg border border-stone-300 bg-white p-4"
    >
      <p class="font-medium">La question précise n'est pas traitée.</p>
      <p class="mt-2 text-sm text-stone-600">
        Des documents parlent bien de ce sujet — ils sont cités ci-dessous — mais aucun n'y
        répond. La question a été versée au
        <NuxtLink to="/lacunes" class="underline">journal des lacunes</NuxtLink>.
      </p>
      <details class="mt-2">
        <summary class="cursor-pointer text-xs text-stone-500 hover:text-stone-900">Pourquoi ce n'est pas une absence totale</summary>
        <p class="mt-1 text-sm text-stone-600">
          Ce n'est pas la même chose qu'une absence totale : on sait dans quelle fiche la
          réponse manque, ce qui en fait le manque le plus facile à combler.
        </p>
      </details>
    </div>

    <!--
      4. Ce n'est pas écrit — rien n'a même atteint le plancher de pertinence. C'est la
      réponse la plus précieuse : elle désigne un trou dans la documentation. Son diagnostic
      ne se replie pas : ici, c'est lui la valeur de la réponse.
    -->
    <div
      v-else-if="!reponse.trouve"
      class="rounded-lg border border-stone-300 bg-white p-4"
    >
      <p class="font-medium">{{ reponse.texte }}</p>
      <p class="mt-2 text-sm text-stone-600">
        Rien dans les sources indexées ne répond à cette question. Elle a été versée au
        <NuxtLink to="/lacunes" class="underline">journal des lacunes</NuxtLink> :
        c'est ce qui alimente la file de rédaction documentaire.
      </p>

      <!--
        CE QUE LA RECHERCHE A CHERCHÉ.
        « Pourtant c'est dans la doc » a deux causes qui n'appellent pas la même suite : le
        document emploie d'autres mots, ou le document n'est pas indexé. Un terme à `df: 0`
        tranche entre les deux, et c'est une mesure, pas une conjecture.
      -->
      <div v-if="reponse.diagnostic" class="mt-4 border-t border-stone-200 pt-3">
        <p class="text-xs font-medium uppercase tracking-wide text-stone-500">
          Ce qui a été cherché
        </p>

        <ul class="mt-2 flex flex-wrap gap-1.5">
          <li
            v-for="t in reponse.diagnostic.termes" :key="t.mot"
            class="rounded border px-1.5 py-0.5 font-geistmono text-xs"
            :class="t.df === 0
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-stone-200 bg-stone-50 text-stone-600'"
            :title="t.df === 0 ? 'Absent de tous les documents indexés' : `${t.df} passage(s) contiennent ce terme`"
          >{{ t.mot }}<span class="ml-1 opacity-60">{{ t.df }}</span></li>
        </ul>

        <p v-if="absents.length" class="mt-2 text-sm text-amber-900">
          <strong>{{ absents.join(', ') }}</strong>
          {{ absents.length > 1 ? 'ne figurent' : 'ne figure' }} dans
          <strong>aucun</strong> document indexé. La recherche est littérale : elle ne
          rapproche pas deux mots pour le même objet. Si la documentation traite du sujet
          avec d'autres termes, relancez avec ceux-là.
        </p>
        <p v-else class="mt-2 text-sm text-stone-600">
          Tous les termes figurent dans l'index, mais aucun passage ne les réunit assez
          pour dépasser le plancher de
          <span class="font-geistmono">{{ reponse.diagnostic.plancher }}</span>.
        </p>

        <!--
          Un passage à 0,18 quand le plancher est à 0,20 n'est pas « rien » : c'est
          probablement le bon document, trouvé par un seul de ses mots.
        -->
        <template v-if="reponse.diagnostic.frolements.length">
          <p class="mt-3 text-xs font-medium uppercase tracking-wide text-stone-500">
            Ce qui est passé le plus près
          </p>
          <ul class="mt-1 space-y-0.5 text-sm">
            <li v-for="(f, i) in reponse.diagnostic.frolements" :key="i" class="flex gap-2">
              <span class="font-geistmono text-xs text-stone-400">{{ f.score.toFixed(2) }}</span>
              <span class="text-stone-600">
                <a v-if="f.url" :href="f.url" target="_blank" rel="noopener noreferrer" class="underline">{{ f.titre }}</a>
                <template v-else>{{ f.titre }}</template>
                <span v-if="f.section" class="text-stone-400"> — {{ f.section }}</span>
              </span>
            </li>
          </ul>
        </template>
      </div>
    </div>

    <!-- La réponse elle-même. -->
    <div v-else class="rounded-lg border border-stone-200 bg-white p-4">
      <div class="flex items-start justify-between gap-4">
        <Markdown
          :texte="reponse.texte" :sources="reponse.citations"
          class="min-w-0 flex-1" @citer="montrerSource"
        />
        <BoutonCopier :texte="pourCopie(reponse)" libelle="Copier" />
      </div>
    </div>

    <!--
      Sources qui font autorité et se contredisent. L'outil SIGNALE, il ne tranche pas :
      repérer qu'une note d'équipe dit autre chose qu'une procédure, c'est repérer soit une
      procédure périmée, soit une pratique qui a divergé. Dans les deux cas quelqu'un doit
      décider, et ce n'est pas un modèle.
    -->
    <p
      v-if="reponse.autoritesEnPresence.length > 1"
      class="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900"
    >
      Plusieurs sources font autorité sur des sujets différents ici
      ({{ reponse.autoritesEnPresence.join(' · ') }}). Si elles se contredisent, la
      contradiction est à trancher par un humain, pas par l'outil.
    </p>

    <!-- RÈGLE 7 — l'origine ne se replie pas. -->
    <Origine :origine="reponse.origine" />

    <!--
      LA BARRE DU DOSSIER. Ce qu'elle dit sans qu'on ouvre : sur quoi la réponse s'appuie,
      combien de sources ont été lues, et combien sont des brouillons — les trois choses qui
      changent la façon de lire ce qui précède.
    -->
    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      <!--
        Pas de pastilles de références ici : la réponse porte déjà ses marqueurs, et ils
        sont cliquables. Les répéter sous le texte doublait la même information et
        rechargeait la barre que ce repli existe pour alléger. Le décompte suffit à décider
        si l'on ouvre.
      -->
      <button
        v-if="reponse.citations.length"
        class="rounded px-1.5 py-0.5 text-stone-500 underline decoration-stone-300 transition hover:bg-stone-100 hover:text-stone-900"
        @click="ouvert = !ouvert"
      >
        {{ ouvert ? 'Masquer' : 'Voir' }} les {{ reponse.citations.length }} sources<template v-if="citees.length"> — {{ citees.length }} citée{{ citees.length > 1 ? 's' : '' }} dans la réponse</template>
      </button>

      <span v-if="brouillons" class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
        {{ brouillons }} brouillon{{ brouillons > 1 ? 's' : '' }}
      </span>
      <span v-if="sansStatut" class="rounded bg-stone-100 px-1.5 py-0.5 text-stone-500">
        {{ sansStatut }} sans statut
      </span>

      <button
        v-if="reponse.donnees && !ouvert"
        class="rounded px-1.5 py-0.5 text-stone-500 underline decoration-stone-300 transition hover:bg-stone-100 hover:text-stone-900"
        @click="ouvert = true"
      >Requête et résultat brut</button>

      <!-- Une réponse trouvée mais à côté ne laissait aucune trace. -->
      <template v-if="reponse.trouve">
        <button
          v-if="!signale && !enSignalement"
          class="ml-auto rounded px-1.5 py-0.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-900"
          @click="enSignalement = true"
        >Cette réponse est à côté</button>
        <span v-else-if="signale" class="ml-auto text-emerald-700">
          Signalé — versé au journal des lacunes.
        </span>
      </template>
    </div>

    <!-- Le signalement, avec sa phrase facultative. -->
    <div v-if="enSignalement" class="mt-2 rounded-lg border border-stone-300 bg-stone-50 p-3">
      <label class="text-xs text-stone-600" :for="`manque-${reponse.origine.consigne}`">
        Ce qui manquait, en une phrase — facultatif, et c'est ce qui sert le plus à la rédaction.
      </label>
      <textarea
        :id="`manque-${reponse.origine.consigne}`" v-model="ceQuiManquait" rows="2"
        placeholder="il manquait la commande · ça ne dit pas quoi faire si rien n'a été saisi"
        class="mt-1 w-full resize-y rounded-md border border-stone-300 bg-white p-2 text-sm outline-none focus:border-stone-900"
      />
      <div class="mt-2 flex gap-2">
        <button
          class="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-700"
          @click="signaler"
        >Signaler</button>
        <button
          class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-600 transition hover:bg-stone-100"
          @click="enSignalement = false"
        >Annuler</button>
      </div>
    </div>

    <!-- LE DOSSIER. Rien de neuf ici : ce qui était affiché en permanence, à la demande. -->
    <div v-if="ouvert" class="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <ListeCitations
        :citations="citees" :surligne="surligne"
        titre="Sources citées dans la réponse"
      />
      <ListeCitations
        :citations="consultees" :surligne="surligne"
        :titre="citees.length ? 'Autres sources consultées' : 'Sources consultées'"
      />

      <ListeCitations
        v-if="reponse.nonIndexables.length"
        :citations="reponse.nonIndexables"
        titre="Documents trouvés mais non lisibles"
      />
      <p v-if="reponse.nonIndexables.length" class="mt-2 text-xs text-stone-500">
        Ces documents existent sur le sujet mais leur contenu n'a pas pu être extrait —
        un PDF scanné, par exemple. Ils ne fondent aucune affirmation ci-dessus.
      </p>

      <!--
        La pièce justificative du chemin « données » : vérifier qu'une réponse ne dit pas
        plus que ce que la donnée porte, et rejouer la requête sans la deviner.
      -->
      <ResultatBrut
        v-if="reponse.donnees"
        :requete="reponse.donnees.requete"
        :corps="reponse.donnees.corps"
        :mentions="reponse.donnees.mentions"
      />

      <p class="mt-4 text-xs text-stone-400">
        Recherche {{ reponse.mode === 'hybride' ? 'lexicale et sémantique' : 'lexicale seule' }}.
      </p>
    </div>
  </div>
</template>
