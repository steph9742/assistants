<script setup lang="ts">
// LE FIL — la page est une conversation, chaque tour restant une carte complète.
//
// La continuité passe par la REFORMULATION EXPLICITE, côté serveur : « comment j'isole ? »
// devient une question autonome, affichée sur la carte, et toute la chaîne déterministe
// tourne sur elle. Le client ne fabrique aucun contexte : il renvoie les résumés d'état
// que le serveur a construits — des faits extraits, jamais du texte engendré.
import type { Etape, Reponse } from '~/composables/useApi'
import { pastilles, resumeSans } from '~/utils/contexte'

const api = useApi()
const question = ref('')
const tours = ref<{ question: string, reponse: Reponse }[]>([])
const enCours = ref(false)
const erreur = ref('')
const bas = ref<HTMLElement | null>(null)
const champ = ref<HTMLTextAreaElement | null>(null)

/** Ce que l'utilisateur a retiré du contexte — appliqué à TOUS les tours du fil. */
const retirees = ref(new Set<string>())

/**
 * Ce que le fil retient, tel qu'il partira au prochain tour.
 *
 * Construit depuis les résumés que le serveur a renvoyés, jamais depuis le texte des
 * réponses : c'est la même matière que celle qui voyage, donc ce qui est affiché est
 * exactement ce qui sera envoyé.
 */
const filEnvoye = computed(() => tours.value.map(t => ({
    question: t.reponse.questionComprise ?? t.question,
    resume: resumeSans(t.reponse.resume ?? '', retirees.value),
})))

const contexte = computed(() => {
    const vues = new Set<string>()
    return filEnvoye.value.flatMap(t => pastilles(t.resume)).filter((p) => {
        if (vues.has(p.cle)) return false
        vues.add(p.cle)
        return true
    })
})

function retirer(cle: string) {
    retirees.value = new Set([...retirees.value, cle])
}

/**
 * L'ÉTAPE EN COURS ET LE TEMPS ÉCOULÉ.
 *
 * Une question met plusieurs dizaines de secondes, et devant un « Recherche… » figé on ne
 * peut pas distinguer une chaîne qui avance d'une chaîne bloquée. Les gens relancent, ce
 * qui double la charge sur un serveur déjà lent. Les étapes viennent du serveur ; le
 * compteur, lui, est local — mais il ne prétend rien, il compte.
 */
const etape = ref<Etape | null>(null)
const secondes = ref(0)
let minuterie: ReturnType<typeof setInterval> | null = null

const LIBELLE: Record<Etape['etape'], string> = {
    reformulation: 'Je relis la question à la lumière du fil',
    orientation: 'Je décide : procédure ou données vivantes',
    donnees: "J'interroge la source",
    recherche: 'Je cherche dans les documents indexés',
    redaction: 'Je rédige la réponse',
}

const detailEtape = computed(() => {
    const e = etape.value
    if (!e) return ''
    if (e.etape === 'donnees') return e.requete
    if (e.etape === 'redaction' && e.passages) return `${e.passages} passages retenus`
    if (e.etape === 'redaction' && e.conduite) return `conduite de ${e.conduite} fiche(s) attachée(s)`
    return ''
})

async function demander() {
    if (!question.value.trim() || enCours.value) return
    const q = question.value.trim()
    enCours.value = true
    erreur.value = ''
    etape.value = null
    secondes.value = 0
    minuterie = setInterval(() => { secondes.value++ }, 1000)
    try {
        const r = await api.questionFlux(q, filEnvoye.value, (e) => { etape.value = e })
        tours.value.push({ question: q, reponse: r })
        question.value = ''
        await nextTick()
        bas.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
    catch (e: any) { erreur.value = e.message }
    finally {
        enCours.value = false
        etape.value = null
        if (minuterie) { clearInterval(minuterie); minuterie = null }
    }
}

onUnmounted(() => { if (minuterie) clearInterval(minuterie) })

/** La question comprise, recopiée dans le champ pour être corrigée puis reposée. */
async function corriger(q: string) {
    question.value = q
    await nextTick()
    champ.value?.focus()
    champ.value?.setSelectionRange(q.length, q.length)
}

function nouvelleConversation() {
    tours.value = []
    question.value = ''
    erreur.value = ''
    retirees.value = new Set()
}

/**
 * L'ACCUEIL ENSEIGNE LES DEUX CHEMINS.
 *
 * Une page vide avec un champ de saisie n'apprend rien, et la première question décide
 * souvent de l'idée qu'on se fait de l'outil. Ces exemples sont pris du protocole d'essai —
 * ils marchent, et ils montrent que l'outil a deux voies qui ne se répondent pas
 * pareillement.
 */
const EXEMPLES = [
    {
        titre: 'Les procédures',
        aide: 'répondu depuis les documents indexés, avec citations',
        questions: [
            'Que dit la procédure en cas de compte compromis ?',
            "Comment isoler une machine sans l'éteindre ?",
            'Un utilisateur signale un mail suspect qui demande ses identifiants, que faire ?',
        ],
    },
    {
        titre: 'Les données vivantes',
        aide: 'interrogées au moment de la question, avec la requête exécutée',
        questions: [
            'On a eu un incident P1 ?',
            'Quelles listes blanches ont expiré ?',
            'Quels certificats posent problème ?',
        ],
    },
]

async function poser(q: string) {
    question.value = q
    await demander()
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Assistant cellule</h1>
        <p class="mt-1 max-w-[70ch] text-sm text-stone-500">
          Questions sur les procédures, les outils et les données métier.
          Chaque réponse renvoie aux documents qui la fondent, et les questions
          suivantes peuvent s'appuyer sur les précédentes.
        </p>
      </div>
      <button
        v-if="tours.length"
        class="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
        @click="nouvelleConversation"
      >Nouvelle conversation</button>
    </div>

    <!-- L'accueil : ce que l'outil sait faire, et par quels chemins. -->
    <div v-if="!tours.length && !enCours" class="mt-8 grid gap-4 sm:grid-cols-2">
      <section
        v-for="groupe in EXEMPLES" :key="groupe.titre"
        class="rounded-lg border border-stone-200 bg-white p-4"
      >
        <h2 class="text-sm font-semibold">{{ groupe.titre }}</h2>
        <p class="mt-0.5 text-xs text-stone-500">{{ groupe.aide }}</p>
        <ul class="mt-3 space-y-1.5">
          <li v-for="q in groupe.questions" :key="q">
            <button
              class="w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-left text-sm text-stone-700 transition hover:border-stone-900 hover:bg-stone-50"
              @click="poser(q)"
            >{{ q }}</button>
          </li>
        </ul>
      </section>
    </div>

    <!-- Le fil : chaque tour, question puis carte, dans l'ordre. -->
    <div v-for="(t, i) in tours" :key="i" class="mt-8">
      <p class="mb-2 text-sm font-medium text-stone-900">
        <span class="mr-1.5 rounded bg-stone-900 px-1.5 py-0.5 text-xs font-normal text-white">{{ i + 1 }}</span>
        {{ t.question }}
      </p>
      <CarteReponse :question="t.question" :reponse="t.reponse" @corriger="corriger" />
    </div>

    <p v-if="erreur" class="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {{ erreur }}
    </p>

    <div ref="bas" />

    <!--
      LA SAISIE SUIT LE LECTEUR. Elle vivait après tout le fil : plus la conversation
      avançait, plus il fallait défiler pour poser la question suivante — et le dossier de
      preuves du tour précédent s'interposait à chaque fois.
    -->
    <div class="sticky bottom-0 mt-8 -mx-6 border-t border-stone-200 bg-stone-50/95 px-6 pb-4 pt-3 backdrop-blur">
      <!--
        CE QUE LE FIL RETIENT. Le résumé est construit en code par le serveur — des faits
        étiquetés, jamais du texte engendré — et il partait sans que personne ne le voie.
        L'afficher répond à la question qu'on se pose devant une conversation : « de quoi
        parle-t-il, là ? ». Le retirer d'un clic évite de tout jeter quand le sujet change
        à moitié.
      -->
      <div v-if="contexte.length" class="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-stone-400">Le fil retient</span>
        <span
          v-for="p in contexte" :key="p.cle"
          class="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-1.5 py-0.5 text-stone-600"
        >
          <span v-if="p.groupe" class="text-stone-400">{{ p.groupe }}</span>
          <span class="max-w-[22rem] truncate font-geistmono">{{ p.valeur }}</span>
          <button
            class="text-stone-400 transition hover:text-stone-900"
            :title="`Retirer « ${p.valeur} » du contexte`"
            @click="retirer(p.cle)"
          >×</button>
        </span>
      </div>

      <!-- Où en est la chaîne, et depuis combien de temps. -->
      <p v-if="enCours" class="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span class="inline-block size-1.5 animate-pulse rounded-full bg-stone-900" />
        <span class="font-medium text-stone-700">
          {{ etape ? LIBELLE[etape.etape] : 'Je prépare la question' }}
        </span>
        <span v-if="detailEtape" class="truncate font-geistmono text-stone-400">{{ detailEtape }}</span>
        <span class="ml-auto tabular-nums text-stone-400">{{ secondes }} s</span>
      </p>

      <form @submit.prevent="demander">
        <textarea
          ref="champ"
          v-model="question" :rows="tours.length ? 2 : 3" :disabled="enCours"
          :placeholder="tours.length
            ? 'Question suivante — elle peut renvoyer à ce qui précède'
            : 'Que dit la procédure en cas de compte compromis ?'"
          class="w-full resize-y rounded-lg border border-stone-300 bg-white p-3 text-sm outline-none focus:border-stone-900 disabled:opacity-60"
          @keydown.enter.exact.prevent="demander"
          @keydown.meta.enter="demander" @keydown.ctrl.enter="demander"
        />
        <div class="mt-2 flex items-center gap-3">
          <button
            type="submit" :disabled="enCours || !question.trim()"
            class="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-40"
          >{{ enCours ? 'En cours…' : 'Demander' }}</button>
          <span class="text-xs text-stone-400">Entrée pour envoyer · Maj + Entrée pour aller à la ligne</span>
        </div>
      </form>
    </div>
  </div>
</template>
