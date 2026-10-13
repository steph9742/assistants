<script setup lang="ts">
import type { Explication, Hypotheses } from '~/composables/useApi'

const api = useApi()
const extrait = ref('')
const resultat = ref<Explication | null>(null)
const pistes = ref<Hypotheses | null>(null)
const enCours = ref(false)
const erreur = ref('')
const erreurPistes = ref('')

async function expliquer() {
    if (!extrait.value.trim() || enCours.value) return
    enCours.value = true
    erreur.value = ''
    erreurPistes.value = ''
    resultat.value = null
    pistes.value = null

    // DEUX APPELS INDÉPENDANTS, et c'est voulu.
    //
    // L'explication est ce qui a de la valeur ; les pistes sont un complément. Un JSON mal
    // formé, un réglage coupé ou un modèle qui bute sur la seconde consigne ne doivent pas
    // coûter la première réponse. `allSettled` plutôt que `all` : on prend ce qui arrive.
    const [exp, hyp] = await Promise.allSettled([
        api.expliquerExtrait(extrait.value),
        api.hypotheses(extrait.value),
    ])

    if (exp.status === 'fulfilled') resultat.value = exp.value
    else erreur.value = exp.reason?.message ?? String(exp.reason)

    if (hyp.status === 'fulfilled') pistes.value = hyp.value
    else erreurPistes.value = hyp.reason?.message ?? String(hyp.reason)

    enCours.value = false
}

/**
 * La confiance est affichée en TROIS PALIERS, et le chiffre exact à côté.
 *
 * Un modèle qui rend 71 et un autre qui rend 68 ne disent pas deux choses différentes :
 * rien ne calibre ces nombres, et les afficher seuls invite à une précision qu'ils n'ont
 * pas. Les paliers portent la lecture, le chiffre reste visible pour qui veut ordonner.
 */
/**
 * Ce qui part au presse-papiers emporte L'AVERTISSEMENT, pas seulement les pistes.
 *
 * C'est le seul bloc de l'application qui s'approche d'une qualification, et il ne tient
 * que par ce qui l'encadre. Copier trois lignes « type — 80 % » dans un ticket produirait
 * exactement l'objet que la règle 1 interdit : une qualification d'apparence mesurée, hors
 * du registre, que plus rien ne rattache à un modèle.
 */
const pistesEnMarkdown = computed(() => {
    const p = pistes.value
    if (!p?.hypotheses.length) return ''
    return pourCopie({
        texte: [
            '## Pistes possibles — NI QUALIFICATION, NI MESURE',
            '',
            "Les pourcentages ci-dessous sont avancés par un modèle de langage. Rien ne les",
            "calibre. La qualification d'un incident appartient au triage et s'inscrit au",
            "registre ; ceci n'en tient pas lieu.",
            '',
            ...p.hypotheses.flatMap(h => [
                `### ${h.type} — ${h.certitude} % (${palier(h.certitude).libelle})`,
                '',
                `- **Ce qui soutient** : ${h.pourquoi || '—'}`,
                `- **Ce qui contredit** : ${h.contre}`,
                '',
            ]),
        ].join('\n'),
        origine: p.origine,
    })
})

function palier(n: number): { libelle: string, classe: string } {
    if (n >= 70) return { libelle: 'confiance déclarée élevée', classe: 'bg-stone-700' }
    if (n >= 40) return { libelle: 'confiance déclarée moyenne', classe: 'bg-stone-500' }
    return { libelle: 'confiance déclarée faible', classe: 'bg-stone-400' }
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold tracking-tight">Compréhension de journaux</h1>
    <p class="mt-1 text-sm text-stone-500">
      Collez une ligne de journal, une règle de détection, un identifiant d'événement ou un
      extrait de configuration. L'outil explique ce que c'est.
    </p>

    <!--
      Les deux limites sont annoncées AVANT la saisie, pas après la réponse.
      La non-qualification, parce que c'est ce que les gens vont attendre de l'outil et
      qu'il ne le fera pas. La non-conservation, parce qu'un extrait de journal porte des
      adresses IP et des identifiants, et que la personne qui colle a le droit de savoir
      ce qu'il en advient avant de coller.
    -->
    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      <p class="rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-600">
        <span class="font-medium text-stone-900">L'outil ne qualifie pas.</span>
        Il explique un format, et propose des pistes assorties de ce qui les contredit.
        Jamais « incident de type X, gravité Y » : la qualification appartient au triage, et
        une qualification produite hors du registre ne serait tracée nulle part.
      </p>
      <p class="rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-600">
        <span class="font-medium text-stone-900">Rien n'est conservé.</span>
        L'extrait n'est écrit ni en base, ni dans un fichier, ni dans les journaux
        applicatifs — pas même sous forme de condensat.
      </p>
    </div>

    <form class="mt-6" @submit.prevent="expliquer">
      <textarea
        v-model="extrait" rows="8" :disabled="enCours"
        placeholder="Oct 12 03:14:22 srv-web sshd[4127]: Failed password for invalid user admin from 203.0.113.9"
        class="w-full resize-y rounded-lg border border-stone-300 bg-white p-3 font-geistmono text-xs outline-none focus:border-stone-900 disabled:opacity-60"
        @keydown.meta.enter="expliquer" @keydown.ctrl.enter="expliquer"
      />
      <div class="mt-2 flex items-center gap-3">
        <button
          type="submit" :disabled="enCours || !extrait.trim()"
          class="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-40"
        >{{ enCours ? 'Lecture…' : 'Expliquer' }}</button>
        <span class="text-xs text-stone-400">{{ extrait.length }} caractères · Ctrl + Entrée</span>
      </div>
    </form>

    <p v-if="erreur" class="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {{ erreur }}
    </p>

    <Transition name="fondu">
      <section v-if="resultat" class="mt-8 rounded-lg border border-stone-200 bg-white p-4">
        <div class="flex items-start justify-between gap-4">
          <Markdown :texte="resultat.texte" class="min-w-0 flex-1" />
          <BoutonCopier :texte="pourCopie(resultat)" libelle="Copier" />
        </div>
        <Origine :origine="resultat.origine" />
      </section>
    </Transition>

    <p v-if="resultat" class="mt-4 text-xs text-stone-500">
      Cette explication vient de la connaissance générale du modèle sur les formats, pas de
      la documentation de l'établissement. Pour la conduite à tenir, voir
      <NuxtLink to="/" class="underline">l'assistant</NuxtLink>.
    </p>

    <!--
      PISTES — sous l'explication, et jamais à sa place.
      Voir la mise en garde qui les accompagne : ce bloc est le seul de l'application à
      s'approcher d'une qualification, et il ne tient que par ce qui l'encadre.
    -->
    <Transition name="fondu">
      <section v-if="pistes && pistes.hypotheses.length" class="mt-8">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Pistes possibles
        </h2>

        <!--
          L'avertissement est AU-DESSUS des pistes, pas en dessous et pas replié. Un lecteur
          pressé lit le premier chiffre et s'arrête ; s'il ne doit lire qu'une chose, il faut
          que ce soit celle-ci.
        -->
        <div class="mt-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
          <p class="text-sm font-semibold text-amber-900">
            Ce ne sont pas des qualifications, et ces pourcentages ne sont pas des mesures.
          </p>
          <ul class="mt-2 space-y-1 text-sm text-amber-900">
            <li>
              Le chiffre est <strong>avancé par le modèle</strong> : rien ne le calibre, rien
              ne le vérifie. Un modèle sûr de lui se trompe avec le même aplomb.
            </li>
            <li>
              Une ligne de journal isolée admet presque toujours plusieurs lectures. Lisez la
              colonne <em>ce qui contredit</em> avant le pourcentage.
            </li>
            <li>
              La qualification d'un incident appartient au triage et s'inscrit dans le
              registre. Rien de ce bloc n'y est versé, et rien n'en tient lieu.
            </li>
          </ul>
        </div>

        <div class="mt-4 space-y-3">
          <article
            v-for="(h, i) in pistes.hypotheses" :key="i"
            class="rounded-lg border border-stone-200 bg-white p-4"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-3">
              <h3 class="text-sm font-medium">{{ h.type }}</h3>
              <span class="text-xs text-stone-500">
                {{ palier(h.certitude).libelle }} — {{ h.certitude }} %
              </span>
            </div>

            <!-- Une barre, mais grise : une couleur d'alerte donnerait à un chiffre non
                 calibré l'apparence d'un seuil décidé. -->
            <div class="mt-2 h-1 w-full overflow-hidden rounded bg-stone-100">
              <div class="h-full" :class="palier(h.certitude).classe" :style="{ width: `${h.certitude}%` }" />
            </div>

            <dl class="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt class="text-xs font-medium uppercase tracking-wide text-stone-500">Ce qui soutient</dt>
                <dd class="mt-1 text-sm text-stone-700">{{ h.pourquoi || '—' }}</dd>
              </div>
              <div>
                <dt class="text-xs font-medium uppercase tracking-wide text-stone-500">Ce qui contredit</dt>
                <dd class="mt-1 text-sm text-stone-700">{{ h.contre }}</dd>
              </div>
            </dl>
          </article>
        </div>

        <div class="mt-3 flex items-start justify-between gap-4">
          <Origine :origine="pistes.origine" />
          <BoutonCopier :texte="pistesEnMarkdown" libelle="Copier" />
        </div>
      </section>
    </Transition>

    <!--
      Trois issues sans piste, qui ne veulent pas dire la même chose. Les taire toutes
      laisserait croire que le modèle n'a rien trouvé, y compris quand il n'a pas été
      interrogé.
    -->
    <p
      v-if="pistes && !pistes.hypotheses.length && !pistes.illisible"
      class="mt-6 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-600"
    >
      Le modèle n'avance aucune piste sur cet extrait. C'est une réponse à part entière :
      une ligne isolée ne porte souvent pas de quoi en formuler une.
    </p>
    <p
      v-if="pistes?.illisible"
      class="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
    >
      Le modèle n'a pas rendu de pistes exploitables — il a répondu autre chose que la forme
      attendue. Aucune piste n'est affichée plutôt qu'une piste devinée dans sa réponse.
    </p>
    <p v-if="erreurPistes" class="mt-6 text-xs text-stone-500">
      Les pistes n'ont pas pu être obtenues ({{ erreurPistes }}). L'explication ci-dessus
      n'est pas affectée.
    </p>
  </div>
</template>
