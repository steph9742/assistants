<script setup lang="ts">
// SOURCES — déclaration et configuration des connecteurs.
//
// Toute cette page se construit depuis `descripteurs` : libellés, types, obligations,
// exemples, mises en garde. Aucun champ n'est décrit en dur ici — sans quoi il faudrait
// modifier un connecteur à deux endroits, et on n'y pense jamais deux fois.

const api = useApi()

const sources = ref<any[]>([])
const descripteurs = ref<any[]>([])
const categories = ref<string[]>([])
const questions = ref<any[]>([])
const fraicheur = ref<any>({ seuilHeures: 24, sources: [] })
const erreur = ref('')
const test = ref<Record<string, { ok?: boolean, texte: string, apercu?: string[] }>>({})

/** Source en cours d'édition. `null` = aucune, `'nouvelle'` = création. */
const edite = ref<string | null>(null)
const brouillon = reactive<any>({ nom: '', type: 'gitlab', categorie: '', autorite: '', config: {}, jeton: '', actif: true })
const enCours = ref(false)

async function charger() {
    try {
        const r = await api.sources()
        sources.value = r.sources
        descripteurs.value = (r as any).descripteurs ?? []
        categories.value = (r as any).categories ?? []
        questions.value = (r as any).questions ?? []
        fraicheur.value = await api.fraicheur()
        erreur.value = ''
    }
    catch (e: any) { erreur.value = e.message }
}
await charger()

const descripteurDe = (type: string) => descripteurs.value.find(d => d.type === type)
const etatDe = (nom: string) => fraicheur.value.sources.find((s: any) => s.nom === nom)

/** La découverte appartient à la source qu'on édite : elle ne doit pas lui survivre. */
function oublierDecouverte() {
    dossiersTrouves.value = []
    erreurDossiers.value = ''
}

function nouvelle() {
    oublierDecouverte()
    Object.assign(brouillon, {
        nom: '', type: 'gitlab', categorie: '', autorite: '', config: {}, jeton: '', actif: true,
    })
    appliquerDefauts('gitlab')
    edite.value = 'nouvelle'
}

function modifier(s: any) {
    oublierDecouverte()
    Object.assign(brouillon, {
        nom: s.nom, type: s.type, categorie: s.categorie, autorite: s.autorite ?? '',
        config: { ...(s.config ?? {}) }, jeton: '', actif: s.actif,
    })
    edite.value = s.id
}

/** Change de type : on repart des défauts du descripteur, sans garder les champs d'un autre. */
function appliquerDefauts(type: string) {
    const d = descripteurDe(type)
    if (!d) return
    brouillon.config = {}
    for (const c of d.champs) {
        if (!c.defaut) continue
        // Une liste est stockée en TABLEAU, y compris quand elle vient d'un défaut — qui,
        // lui, est écrit en chaîne dans le descripteur. Sans cette conversion, une source
        // créée sans toucher au champ portait une chaîne là où le reste attend un tableau.
        brouillon.config[c.cle] = c.type === 'liste'
            ? c.defaut.split(',').map((x: string) => x.trim()).filter(Boolean)
            : c.defaut
    }
    if (!brouillon.categorie) brouillon.categorie = d.categorieDefaut
}

async function enregistrer() {
    enCours.value = true
    erreur.value = ''
    try {
        const corps: any = {
            nom: brouillon.nom, categorie: brouillon.categorie,
            autorite: brouillon.autorite || undefined,
            config: brouillon.config, actif: brouillon.actif,
        }
        if (brouillon.jeton) corps.jeton = brouillon.jeton
        if (edite.value === 'nouvelle') await api.creerSource({ ...corps, type: brouillon.type })
        else await api.modifierSource(edite.value!, corps)
        edite.value = null
        await charger()
    }
    catch (e: any) { erreur.value = e.message }
    finally { enCours.value = false }
}

async function tester(s: any) {
    test.value[s.id] = { texte: 'essai en cours…' }
    try {
        const r: any = await api.testerSource(s.id)
        test.value[s.id] = {
            ok: r.ok,
            texte: r.ok ? r.detail : (r.message ?? 'échec'),
            apercu: r.apercu,
        }
    }
    catch (e: any) { test.value[s.id] = { ok: false, texte: e.message } }
}

async function supprimer(s: any) {
    if (!confirm(`Supprimer « ${s.nom} » ? Ses documents seront retirés de l'index.\n\nPour l'écarter sans perdre sa configuration, désactivez-la plutôt.`)) return
    try { await api.supprimerSource(s.id); await charger() }
    catch (e: any) { erreur.value = e.message }
}

// ─── Découverte GitLab ────────────────────────────────────────────────────────────────
//
// Même discipline que la liste des modèles : ce que GitLab sait dire ne se tape pas à la
// main. Un chemin de projet écrit de mémoire et légèrement faux échoue à la
// synchronisation, plusieurs jours plus tard, sur un message qui ne dit pas qu'il s'agit
// d'une faute de frappe.

const dossiersTrouves = ref<{ chemin: string, fichiersMd: number, niveau: number }[]>([])
const chargeDossiers = ref(false)
const erreurDossiers = ref('')

async function chargerDossiers() {
    chargeDossiers.value = true
    erreurDossiers.value = ''
    try {
        const r = await api.dossiersGitlab({
            base: brouillon.config.base, projet: brouillon.config.projet,
            ref: brouillon.config.ref || 'main',
            jeton: brouillon.jeton || undefined,
            sourceId: edite.value !== 'nouvelle' ? edite.value : undefined,
        })
        dossiersTrouves.value = r.dossiers
        if (!r.dossiers.length) erreurDossiers.value = 'Aucun dossier à la racine de ce dépôt.'
    }
    catch (e: any) { erreurDossiers.value = e.message }
    finally { chargeDossiers.value = false }
}

const dossiersChoisis = computed<string[]>(() =>
    Array.isArray(brouillon.config.dossiers) ? brouillon.config.dossiers
        : String(brouillon.config.dossiers ?? '').split(',').map((x: string) => x.trim()).filter(Boolean))

function basculerDossier(chemin: string) {
    const actuels = [...dossiersChoisis.value]
    const i = actuels.indexOf(chemin)
    if (i >= 0) actuels.splice(i, 1)
    else actuels.push(chemin)
    brouillon.config.dossiers = actuels
}

// ─── Import d'un groupe entier ────────────────────────────────────────────────────────

const importOuvert = ref(false)
const imp = reactive({
    base: 'https://gitlab.example.org',
    groupe: 'ssi',
    jeton: '',
    categorie: 'exploitation',
    autorite: '',
    dossiers: 'doc,docs',
    avecArchives: false,
})
const projetsTrouves = ref<{ chemin: string, nom: string, branche: string, archive: boolean }[]>([])
const projetsChoisis = ref<Set<string>>(new Set())
const chargeProjets = ref(false)
const erreurImport = ref('')
const bilanImport = ref<{ crees: string[], ignores: { nom: string, motif: string }[] } | null>(null)

async function chargerProjets() {
    chargeProjets.value = true
    erreurImport.value = ''
    bilanImport.value = null
    try {
        const r = await api.projetsGitlab({
            base: imp.base, groupe: imp.groupe,
            jeton: imp.jeton || undefined, avecArchives: imp.avecArchives,
        })
        projetsTrouves.value = r.projets
        projetsChoisis.value = new Set(r.projets.map(p => p.chemin))
        if (!r.projets.length) erreurImport.value = 'Aucun projet dans ce groupe.'
    }
    catch (e: any) { erreurImport.value = e.message }
    finally { chargeProjets.value = false }
}

function basculerProjet(chemin: string) {
    const s = new Set(projetsChoisis.value)
    s.has(chemin) ? s.delete(chemin) : s.add(chemin)
    projetsChoisis.value = s
}

/** `ssi/yuno_cert` → `yuno_cert-doc`. Un nom lisible, et unique dans le groupe. */
const nomDeProjet = (chemin: string) => `${chemin.split('/').pop()}-doc`

async function importer() {
    erreurImport.value = ''
    bilanImport.value = null
    const dossiers = imp.dossiers.split(',').map(x => x.trim()).filter(Boolean)
    const entrees = projetsTrouves.value
        .filter(p => projetsChoisis.value.has(p.chemin))
        .map(p => ({
            nom: nomDeProjet(p.chemin),
            config: { base: imp.base, projet: p.chemin, ref: p.branche, dossiers },
        }))
    if (!entrees.length) { erreurImport.value = 'Aucun projet coché.'; return }

    try {
        bilanImport.value = await api.creerLot({
            entrees, categorie: imp.categorie,
            autorite: imp.autorite || undefined,
            jeton: imp.jeton || undefined,
        })
        await charger()
    }
    catch (e: any) { erreurImport.value = e.message }
}

const COULEUR: Record<string, string> = {
    ok: 'bg-emerald-100 text-emerald-800',
    echec: 'bg-red-100 text-red-800',
    en_cours: 'bg-sky-100 text-sky-800',
    jamais: 'bg-stone-200 text-stone-700',
}
const CAT: Record<string, string> = {
    juridique: 'bg-violet-100 text-violet-800',
    procedure: 'bg-emerald-100 text-emerald-800',
    exploitation: 'bg-sky-100 text-sky-800',
    equipe: 'bg-amber-100 text-amber-800',
    produit: 'bg-stone-200 text-stone-700',
    bonne_pratique: 'bg-stone-200 text-stone-700',
    donnees: 'bg-rose-100 text-rose-800',
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Sources</h1>
        <p class="mt-1 text-sm text-stone-500">
          Ce qui est lu, comment, et depuis quand. Une source de plus est une ligne de plus —
          jamais une ligne de code.
        </p>
      </div>
      <div class="flex gap-2">
        <button
          class="rounded-md border border-stone-300 px-4 py-2 text-sm hover:bg-stone-100"
          @click="importOuvert = !importOuvert; edite = null"
        >Importer un groupe GitLab</button>
        <button
          class="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700"
          @click="nouvelle"
        >Ajouter une source</button>
      </div>
    </div>

    <p v-if="erreur" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ erreur }}</p>

    <!-- ─────────────── Import d'un groupe ─────────────── -->
    <section v-if="importOuvert" class="mt-6 rounded-lg border-2 border-stone-900 bg-white p-4">
      <h2 class="text-sm font-semibold">Importer les dépôts d'un groupe GitLab</h2>
      <p class="mt-1 text-sm text-stone-600">
        Déclarer neuf sources une à une, c'est neuf fois la même adresse, le même jeton et la
        même catégorie — et une occasion de se tromper à chaque fois. Ici on choisit une fois
        et on coche.
      </p>

      <div class="mt-4 grid gap-3 sm:grid-cols-3">
        <label class="block">
          <span class="text-sm font-medium">Adresse du GitLab</span>
          <input v-model="imp.base" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900">
        </label>
        <label class="block">
          <span class="text-sm font-medium">Groupe</span>
          <input v-model="imp.groupe" placeholder="ssi" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900">
        </label>
        <div class="block">
          <span class="text-sm font-medium">Jeton de groupe</span>
          <input v-model="imp.jeton" type="password" autocomplete="new-password" placeholder="portée read_api" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900">
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-3">
        <button
          :disabled="chargeProjets || !imp.groupe || !imp.jeton"
          class="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-40"
          @click="chargerProjets"
        >{{ chargeProjets ? 'Lecture…' : 'Lister les dépôts' }}</button>
        <label class="flex items-center gap-2 text-sm text-stone-600">
          <input v-model="imp.avecArchives" type="checkbox" class="size-4 rounded border-stone-300">
          Inclure les dépôts archivés
        </label>
        <span class="text-xs text-stone-500">
          Un dépôt archivé n'a plus de documentation vivante : l'indexer servirait des
          procédures que plus personne ne maintient.
        </span>
      </div>

      <p v-if="erreurImport" class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ erreurImport }}</p>

      <div v-if="projetsTrouves.length" class="mt-4 border-t border-stone-200 pt-4">
        <p class="text-sm text-stone-600">
          {{ projetsChoisis.size }} dépôt(s) coché(s) sur {{ projetsTrouves.length }}.
        </p>
        <ul class="mt-2 max-h-64 space-y-1 overflow-y-auto">
          <li v-for="p in projetsTrouves" :key="p.chemin">
            <label class="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-stone-50">
              <input
                type="checkbox" class="size-4 rounded border-stone-300"
                :checked="projetsChoisis.has(p.chemin)" @change="basculerProjet(p.chemin)"
              >
              <span class="font-geistmono text-xs">{{ p.chemin }}</span>
              <span class="text-stone-500">{{ p.nom }}</span>
              <span class="text-xs text-stone-400">{{ p.branche }}</span>
              <span v-if="p.archive" class="rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-700">archivé</span>
              <span class="ml-auto text-xs text-stone-400">→ {{ nomDeProjet(p.chemin) }}</span>
            </label>
          </li>
        </ul>

        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <label class="block">
            <span class="text-sm font-medium">Dossiers à lire</span>
            <p class="text-xs text-stone-500">Les mêmes pour tous. Ceux qui n'existent pas sont simplement vides.</p>
            <input v-model="imp.dossiers" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 font-geistmono text-xs outline-none focus:border-stone-900">
          </label>
          <div class="block">
            <label for="imp-cat" class="text-sm font-medium">Catégorie</label>
            <p class="text-xs text-stone-500">Commune aux sources créées.</p>
            <select id="imp-cat" v-model="imp.categorie" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900">
              <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <label class="block">
            <span class="text-sm font-medium">Fait autorité sur</span>
            <p class="text-xs text-stone-500">Facultatif.</p>
            <input v-model="imp.autorite" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900">
          </label>
        </div>

        <button
          class="mt-4 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700"
          @click="importer"
        >Créer {{ projetsChoisis.size }} source(s)</button>
      </div>

      <div v-if="bilanImport" class="mt-4 border-t border-stone-200 pt-4 text-sm">
        <p v-if="bilanImport.crees.length" class="text-emerald-800">
          Créées : {{ bilanImport.crees.join(', ') }}
        </p>
        <!--
          Un nom déjà pris est signalé, jamais écrasé : réimporter un groupe ne doit pas
          effacer la configuration affinée d'une source existante.
        -->
        <ul v-if="bilanImport.ignores.length" class="mt-1 space-y-0.5 text-amber-800">
          <li v-for="i in bilanImport.ignores" :key="i.nom">{{ i.nom }} — {{ i.motif }}</li>
        </ul>
      </div>

      <button class="mt-4 rounded-md border border-stone-300 px-4 py-2 text-sm hover:bg-stone-100" @click="importOuvert = false">
        Fermer
      </button>
    </section>

    <!-- ─────────────── Formulaire ─────────────── -->
    <section v-if="edite" class="mt-6 rounded-lg border-2 border-stone-900 bg-white p-4">
      <h2 class="text-sm font-semibold">
        {{ edite === 'nouvelle' ? 'Nouvelle source' : `Modifier « ${brouillon.nom} »` }}
      </h2>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="text-sm font-medium">Nom</span>
          <p class="text-xs text-stone-500">Sert à la retrouver ici et dans les journaux. Doit être unique.</p>
          <input
            v-model="brouillon.nom"
            class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900"
          >
        </label>

        <!--
          Le `<select>` n'est PAS enveloppé dans le `<label>`, contrairement aux champs
          texte au-dessus. Sous Safari, un label qui enveloppe une liste déroulante lui
          renvoie le clic : la liste native s'ouvre et se referme dans la foulée, et le
          champ paraît mort. Un `for`/`id` donne la même association sans l'effet de bord.
        -->
        <div class="block">
          <label for="source-type" class="text-sm font-medium">Type</label>
          <p class="text-xs text-stone-500">Change les champs demandés ci-dessous.</p>
          <select
            id="source-type" :value="brouillon.type" :disabled="edite !== 'nouvelle'"
            class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900 disabled:bg-stone-100"
            @change="brouillon.type = ($event.target as HTMLSelectElement).value; appliquerDefauts(brouillon.type); oublierDecouverte()"
          >
            <option v-for="d in descripteurs" :key="d.type" :value="d.type">{{ d.libelle }}</option>
          </select>
        </div>
      </div>

      <p v-if="descripteurDe(brouillon.type)" class="mt-3 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
        {{ descripteurDe(brouillon.type).description }}
        <span class="mt-1 block text-xs text-stone-500">
          Nature <span class="font-geistmono">{{ descripteurDe(brouillon.type).nature }}</span> —
          <template v-if="descripteurDe(brouillon.type).nature === 'index'">
            les documents sont découpés et rangés dans l'index.
          </template>
          <template v-else>
            la source est interrogée <strong>au moment de la question</strong>, jamais indexée.
            On n'indexe pas une donnée vivante : elle serait fausse dès la minute suivante,
            et elle aurait l'air aussi vraie que les autres.
          </template>
        </span>
      </p>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div class="block">
          <label for="source-categorie" class="text-sm font-medium">Catégorie d'autorité</label>
          <p class="text-xs text-stone-500">
            Décide du plafond de places, et de qui a raison quand deux sources se contredisent.
          </p>
          <select
            id="source-categorie" v-model="brouillon.categorie"
            class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900"
          >
            <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>

        <label class="block">
          <span class="text-sm font-medium">Fait autorité sur</span>
          <p class="text-xs text-stone-500">Affiché avec les citations. Ex. « Conduite à tenir, procédures ».</p>
          <input
            v-model="brouillon.autorite"
            class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900"
          >
        </label>
      </div>

      <!-- Champs propres au type, construits depuis le descripteur -->
      <div v-if="descripteurDe(brouillon.type)" class="mt-6 space-y-5 border-t border-stone-200 pt-5">
        <div v-for="c in descripteurDe(brouillon.type).champs" :key="c.cle">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="text-sm font-medium">{{ c.libelle }}</span>
            <span class="font-geistmono text-xs text-stone-400">{{ c.cle }}</span>
            <span v-if="c.obligatoire" class="rounded bg-stone-900 px-1.5 py-0.5 text-xs text-white">obligatoire</span>
          </div>
          <p class="mt-0.5 text-sm text-stone-600">{{ c.description }}</p>
          <p v-if="c.note" class="mt-1 rounded border-l-2 border-amber-400 bg-amber-50 py-1 pl-2 text-xs text-amber-900">
            {{ c.note }}
          </p>

          <label v-if="c.type === 'booleen'" class="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox" class="size-4 rounded border-stone-300"
              :checked="brouillon.config[c.cle] !== false && brouillon.config[c.cle] !== 'false'"
              @change="brouillon.config[c.cle] = ($event.target as HTMLInputElement).checked"
            >
            <span class="text-stone-600">
              {{ brouillon.config[c.cle] !== false && brouillon.config[c.cle] !== 'false' ? 'activé' : 'désactivé' }}
            </span>
          </label>

          <!-- Dossiers d'un dépôt GitLab : proposés, pas devinés. -->
          <div v-else-if="c.cle === 'dossiers' && brouillon.type === 'gitlab'" class="mt-2">
            <div class="flex flex-wrap items-center gap-2">
              <input
                :value="dossiersChoisis.join(',')"
                class="w-full max-w-md rounded-md border border-stone-300 px-3 py-1.5 font-geistmono text-xs outline-none focus:border-stone-900"
                @input="brouillon.config.dossiers = ($event.target as HTMLInputElement).value.split(',').map(x => x.trim()).filter(Boolean)"
              >
              <button
                :disabled="chargeDossiers || !brouillon.config.base || !brouillon.config.projet"
                class="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-40"
                @click="chargerDossiers"
              >{{ chargeDossiers ? 'Lecture…' : 'Lister les dossiers' }}</button>
            </div>
            <p v-if="erreurDossiers" class="mt-1 text-xs text-red-700">{{ erreurDossiers }}</p>
            <ul v-if="dossiersTrouves.length" class="mt-2 space-y-0.5">
              <li v-for="d in dossiersTrouves" :key="d.chemin" :class="d.niveau > 1 ? 'ml-5' : ''">
                <button
                  class="rounded-md border px-2 py-1 text-xs transition"
                  :class="dossiersChoisis.includes(d.chemin)
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-300 hover:bg-stone-100'"
                  @click="basculerDossier(d.chemin)"
                >
                  <span class="font-geistmono">{{ d.chemin }}</span>
                  <span class="ml-1 opacity-70">{{ d.fichiersMd }} md</span>
                </button>
              </li>
            </ul>
            <p v-if="dossiersTrouves.length" class="mt-2 text-xs text-stone-500">
              Deux niveaux, parce que c'est là que se joue la décision : dans le corpus,
              <span class="font-geistmono">reference</span> porte 212 fichiers, mais ils se
              répartissent entre <span class="font-geistmono">juridique</span>,
              <span class="font-geistmono">bonnes-pratiques</span> et
              <span class="font-geistmono">harfanglab</span>, dont les autorités sont
              <strong>opposées</strong>. Les prendre ensemble reviendrait à leur donner la même.
              Le décompte, lui, distingue un dossier de documentation d'un dossier de code.
            </p>
          </div>

          <textarea
            v-else-if="c.type === 'liste'" rows="2"
            :value="Array.isArray(brouillon.config[c.cle]) ? brouillon.config[c.cle].join(',') : (brouillon.config[c.cle] ?? '')"
            :placeholder="c.exemple ?? c.defaut"
            class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5 font-geistmono text-xs outline-none focus:border-stone-900"
            @input="brouillon.config[c.cle] = ($event.target as HTMLTextAreaElement).value.split(',').map(x => x.trim()).filter(Boolean)"
          />

          <input
            v-else :type="c.type === 'nombre' ? 'number' : 'text'"
            :value="brouillon.config[c.cle] ?? ''" :placeholder="c.exemple ?? c.defaut"
            class="mt-2 w-full max-w-xl rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900"
            @input="brouillon.config[c.cle] = ($event.target as HTMLInputElement).value"
          >
        </div>

        <!-- Secret : jamais réaffiché, laisser vide pour conserver l'existant -->
        <div v-if="descripteurDe(brouillon.type).secret">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="text-sm font-medium">{{ descripteurDe(brouillon.type).secret.libelle }}</span>
            <span class="rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-700">chiffré en base</span>
          </div>
          <p class="mt-0.5 text-sm text-stone-600">{{ descripteurDe(brouillon.type).secret.description }}</p>
          <p v-if="descripteurDe(brouillon.type).secret.note" class="mt-1 rounded border-l-2 border-amber-400 bg-amber-50 py-1 pl-2 text-xs text-amber-900">
            {{ descripteurDe(brouillon.type).secret.note }}
          </p>
          <input
            v-model="brouillon.jeton" type="password" autocomplete="new-password"
            :placeholder="edite === 'nouvelle' ? '' : 'laisser vide pour conserver le secret enregistré'"
            class="mt-2 w-full max-w-xl rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-900"
          >
        </div>
      </div>

      <div class="mt-6 flex items-center gap-3 border-t border-stone-200 pt-4">
        <button
          :disabled="enCours || !brouillon.nom"
          class="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-40"
          @click="enregistrer"
        >{{ enCours ? '…' : 'Enregistrer' }}</button>
        <button class="rounded-md border border-stone-300 px-4 py-2 text-sm hover:bg-stone-100" @click="edite = null">
          Annuler
        </button>
        <label class="ml-auto flex items-center gap-2 text-sm text-stone-600">
          <input v-model="brouillon.actif" type="checkbox" class="size-4 rounded border-stone-300">
          Source active
        </label>
      </div>
    </section>

    <!-- ─────────────── Liste ─────────────── -->
    <p v-if="!sources.length && !erreur" class="mt-8 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
      Aucune source configurée. L'assistant répondra « ce n'est pas écrit » à tout — ce qui
      ressemble à une documentation vide alors que c'est un index vide.
    </p>

    <ul class="mt-6 space-y-3">
      <li v-for="s in sources" :key="s.id" class="rounded-lg border border-stone-200 bg-white p-4">
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="font-medium">{{ s.nom }}</span>
          <span class="font-geistmono text-xs text-stone-400">{{ s.type }}</span>
          <span class="rounded px-1.5 py-0.5 text-xs font-medium" :class="CAT[s.categorie] ?? 'bg-stone-100'">
            {{ s.categorie }}
          </span>
          <span
            v-if="descripteurDe(s.type)?.nature === 'index'"
            class="rounded px-1.5 py-0.5 text-xs font-medium"
            :class="COULEUR[etatDe(s.nom)?.etat ?? 'jamais'] ?? 'bg-stone-200'"
          >{{ etatDe(s.nom)?.etat ?? 'jamais' }}</span>
          <span v-else class="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-800">interrogée à la question</span>
          <span v-if="!s.actif" class="rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-700">inactive</span>
          <span v-if="etatDe(s.nom)?.perimee && descripteurDe(s.type)?.nature === 'index'" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">périmée</span>
        </div>

        <p v-if="s.autorite" class="mt-1 text-sm text-stone-600">Fait autorité sur : {{ s.autorite }}</p>

        <p class="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-400">
          <span v-if="s.config?.projet">{{ s.config.projet }}</span>
          <span v-if="s.config?.dossier">{{ s.config.dossier }}</span>
          <span v-if="s.config?.base">{{ s.config.base }}</span>
          <template v-if="descripteurDe(s.type)?.nature === 'index'">
            <span v-if="etatDe(s.nom)?.dernierSucces">synchronisée il y a {{ etatDe(s.nom).heuresDepuisSucces }} h</span>
            <span v-else class="text-amber-700">jamais synchronisée</span>
            <span v-if="etatDe(s.nom)?.documentsVus">{{ etatDe(s.nom).documentsVus }} documents</span>
          </template>
          <span :class="s.jetonRenseigne ? '' : 'text-amber-700'">
            {{ s.jetonRenseigne ? 'identifiant renseigné' : 'aucun identifiant' }}
          </span>
        </p>

        <p v-if="etatDe(s.nom)?.message" class="mt-2 rounded bg-red-50 p-2 font-geistmono text-xs text-red-800">
          {{ etatDe(s.nom).message }}
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button class="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100" @click="tester(s)">
            Tester l'accès
          </button>
          <button class="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100" @click="modifier(s)">
            Modifier
          </button>
          <button class="rounded-md px-3 py-1.5 text-sm text-red-700 hover:bg-red-50" @click="supprimer(s)">
            Supprimer
          </button>
          <span
            v-if="test[s.id]" class="text-xs"
            :class="test[s.id]?.ok === false ? 'text-red-700' : 'text-stone-600'"
          >{{ test[s.id]?.texte }}</span>
        </div>

        <ul v-if="test[s.id]?.apercu?.length" class="mt-2 space-y-0.5 font-geistmono text-xs text-stone-400">
          <li v-for="a in (test[s.id]?.apercu ?? [])" :key="a">{{ a }}</li>
        </ul>
      </li>
    </ul>

    <!-- Ce que l'assistant sait demander aux sources vivantes -->
    <section v-if="questions.length" class="mt-10 border-t border-stone-200 pt-6">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-stone-500">
        Questions posées aux sources vivantes
      </h2>
      <p class="mt-2 text-sm text-stone-600">
        Le modèle ne compose pas de requêtes : il choisit dans cette liste, et l'application
        exécute. La requête employée est affichée à côté de chaque réponse.
      </p>
      <ul class="mt-3 space-y-1 text-sm">
        <li v-for="q in questions" :key="q.cle" class="flex gap-2">
          <span class="shrink-0 font-geistmono text-xs text-stone-400">{{ q.source }}</span>
          <span class="text-stone-700">{{ q.intitule }}</span>
        </li>
      </ul>
    </section>

    <p class="mt-8 text-xs text-stone-500">
      Le détail de chaque champ est dans <span class="font-geistmono">doc/Connecteurs.md</span>,
      engendré depuis le même registre que cette page. La synchronisation tourne dans un
      processus court lancé par cron, pas dans le serveur — voir
      <span class="font-geistmono">doc/Exploitation-MCO.md</span>.
    </p>
  </div>
</template>
