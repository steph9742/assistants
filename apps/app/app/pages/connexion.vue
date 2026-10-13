<script setup lang="ts">
definePageMeta({ layout: false, public: true })

const api = useApi()
const route = useRoute()
const email = ref('')
const motDePasse = ref('')
const erreur = ref('')
const enCours = ref(false)

// Le SSO d'abord, en gros, parce que c'est la voie normale. Le compte de secours est en
// dessous et replié : il existe pour le jour où dex ne répond plus, pas pour l'usage
// quotidien — et un formulaire de mot de passe bien visible invite à s'en servir.
const secoursOuvert = ref(false)

/**
 * LE FOURNISSEUR VIENT DU SERVEUR, et il n'y a pas de second endroit où le régler.
 *
 * L'identifiant posté ci-dessous doit être exactement celui que le serveur a déclaré à Better
 * Auth. L'écrire ici en dur marchait tant qu'un seul déploiement existait ; réglable des deux
 * côtés, il diverge un jour, et la panne se lit « fournisseur inconnu » sans dire lequel était
 * attendu.
 *
 * Chargé au rendu et non au clic : le bouton porte le libellé.
 */
const { data: sso } = await useAsyncData('sso', () => api.sso(), {
    default: () => ({ configure: false, fournisseur: '', libelle: 'SSO' }),
})

/**
 * Entrée par le SSO.
 */
async function connecterSso() {
    // Deux empêchements, deux corrections différentes : un SSO non configuré se règle dans le
    // `.env` du serveur, un serveur muet se règle ailleurs. Les confondre coûte une heure.
    if (!sso.value.configure) {
        erreur.value = sso.value.fournisseur
            ? "Le SSO n'est pas configuré sur ce serveur : seul le compte de secours peut se connecter."
            : "Le serveur n'a pas répondu : impossible de savoir si le SSO est disponible."
        return
    }
    enCours.value = true
    erreur.value = ''
    try {
        // DEUX ESPACES DE CHEMINS, et les confondre coûte cher.
        //
        // `retour` vient du garde de route : c'est un chemin NUXT, sans le sous-chemin —
        // `/sources`, pas `/assistant/sources`. C'est ce qu'attend `navigateTo`, qui
        // rajoute la base lui-même.
        const base = useRuntimeConfig().app.baseURL.replace(/\/+$/, '')
        const chemin = route.query.retour?.toString() || '/'
        const retour = `${base}${chemin.startsWith('/') ? chemin : `/${chemin}`}`

        const r = await $fetch<{ url?: string }>(`${api.base}/api/auth/sign-in/oauth2`, {
            method: 'POST', credentials: 'include',
            body: { providerId: sso.value.fournisseur, callbackURL: retour },
        })
        if (!r?.url) throw new Error("Le serveur n'a pas rendu d'adresse de redirection.")
        window.location.href = r.url
    }
    catch (e: any) {
        // Le message du serveur est rendu tel quel : « fournisseur inconnu » et
        // « dex injoignable » se corrigent différemment.
        erreur.value = e?.data?.message
            ?? e?.data?.erreur
            ?? (e?.status === 404 ? "Le SSO n'est pas configuré sur ce serveur." : null)
            ?? e?.message
            ?? 'Connexion au SSO impossible.'
        enCours.value = false
    }
}

async function connecter() {
    enCours.value = true
    erreur.value = ''
    try {
        await $fetch(`${api.base}/api/auth/sign-in/email`, {
            method: 'POST', credentials: 'include',
            body: { email: email.value, password: motDePasse.value },
        })
        // Ici PAS de préfixe : `navigateTo` raisonne en chemins Nuxt et ajoute la base.
        await navigateTo(route.query.retour?.toString() || '/')
    }
    catch (e: any) {
        erreur.value = e?.data?.message === 'Invalid email or password'
            ? 'Identifiant ou mot de passe incorrect.'
            : (e?.data?.message ?? 'Connexion impossible.')
    }
    finally { enCours.value = false }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-stone-50 p-6 font-geist">
    <div class="w-full max-w-sm">
      <h1 class="text-lg font-semibold tracking-tight">Assistants</h1>
      <p class="mt-1 text-sm text-stone-500">Cellule cyber</p>

      <button
        :disabled="enCours"
        class="mt-6 w-full rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
        @click="connecterSso"
      >{{ enCours ? 'Redirection…' : `Se connecter avec ${sso.libelle}` }}</button>

      <p class="mt-6 text-center text-xs text-stone-400">
        <button class="underline hover:text-stone-600" @click="secoursOuvert = !secoursOuvert">
          Compte de secours
        </button>
      </p>

      <form v-if="secoursOuvert" class="mt-3 space-y-2" @submit.prevent="connecter">
        <p class="rounded border-l-2 border-amber-400 bg-amber-50 py-1.5 pl-2 text-xs text-amber-900">
          Réservé aux pannes du SSO. Ses identifiants sont dans
          <span class="font-geistmono">.secrets/admin-password</span> sur le serveur.
        </p>
        <input
          v-model="email" type="email" autocomplete="username" placeholder="identifiant"
          class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
        >
        <input
          v-model="motDePasse" type="password" autocomplete="current-password" placeholder="mot de passe"
          class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
        >
        <button
          type="submit" :disabled="enCours"
          class="w-full rounded-md border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-100 disabled:opacity-40"
        >{{ enCours ? '…' : 'Entrer' }}</button>
      </form>

      <p v-if="erreur" class="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
        {{ erreur }}
      </p>
    </div>
  </div>
</template>
