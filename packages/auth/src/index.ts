// AUTHENTIFICATION — Better Auth — SSO OIDC via dex.
//
// Le secret client vit dans l'environnement et non chiffré en base : `genericOAuth` lit sa
// configuration à l'initialisation du module, avant que la base soit nécessairement
// joignable. C'est l'une des deux seules exceptions à « aucun secret en clair » — l'autre
// étant la clé maîtresse de `secrets.ts`, qui vit dans `.secrets/`. Les deux sont
// documentées dans doc/Installation.md.

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@assistants/database";
import * as tablesAuth from "@assistants/database/auth-schema";
import { admin, genericOAuth } from "better-auth/plugins";
import { envOidc, lireSecretOidc } from "./env";

/**
 * Ce que dex nous envoie. `email` est facultatif au sens des types de Better Auth : un
 * fournisseur peut ne pas le renvoyer. On refuse la connexion plutôt que d'inventer une
 * adresse — un compte sans identifiant vérifiable n'a rien à faire ici.
 */
type ProfilOIDC = {
    email?: string | null
    groups?: string[] | null
    federated_claims?: { user_id?: string } | null
}

/**
 * L'OIDC n'est déclaré QUE s'il est configuré.
 *
 * Une adresse de dex fausse, un pare-feu, un annuaire en maintenance : autant de raisons de
 * ne pas joindre le fournisseur, dont aucune ne justifie de rendre l'application
 * inutilisable. Sans fournisseur déclaré, elle démarre, le bouton SSO échoue proprement, et
 * le compte de secours reste une porte — ce qui est exactement ce dont on a besoin le jour
 * où le SSO est en panne.
 */
const oidcConfigure = !!(envOidc('OIDC_CLIENT_ID') && envOidc('OIDC_DISCOVERY_URL'))

/**
 * L'IDENTIFIANT DE FOURNISSEUR EST UN MORCEAU D'URL, pas une étiquette.
 *
 * Better Auth en dérive la route de rappel — `/api/auth/oauth2/callback/<identifiant>` — et
 * cette adresse est ENREGISTRÉE chez le fournisseur. Le changer exige de la changer là-bas
 * aussi, faute de quoi le retour de connexion tombe sur un 404.
 *
 * Son défaut est donc historique et ne doit pas bouger : une instance déjà déclarée chez son
 * fournisseur continue de fonctionner sans rien toucher. Une installation neuve le règle
 * librement — `.env.example` propose `oidc`.
 */
const FOURNISSEUR = envOidc('OIDC_PROVIDER_ID') || 'ouate'

/** Ce que le bouton de connexion affiche. À défaut, l'identifiant en capitales. */
const LIBELLE = envOidc('OIDC_LIBELLE') || FOURNISSEUR.toUpperCase()

/**
 * CE QUE L'INTERFACE A BESOIN DE SAVOIR DU SSO, et rien de plus.
 *
 * La page de connexion doit poster le bon identifiant de fournisseur et afficher le bon
 * libellé. Les régler une seconde fois dans l'interface donnerait deux sources de vérité pour
 * une seule valeur, et leur divergence ne se verrait qu'à la connexion — « fournisseur
 * inconnu », sans dire lequel était attendu. Elle les demande donc au serveur.
 *
 * Aucun secret ici : un identifiant de client et un libellé sont publics par construction,
 * puisqu'ils transitent dans l'URL de redirection que le navigateur suit.
 */
export const SSO = { configure: oidcConfigure, fournisseur: FOURNISSEUR, libelle: LIBELLE } as const

// ---------------------------------------------------------------------------------------
// LE RÔLE CALCULÉ DEPUIS LES GROUPES N'ATTEINT PAS LA BASE. Mécanique reprise du Catalogue,
// qui l'a diagnostiqué le premier.
//
// Depuis better-auth 1.6.12, la création d'un compte OAuth ne retient que les champs
// déclarés inscriptibles. Or le greffon `admin` déclare `role` en `input: false`, puis pose
// son propre point d'accroche qui écrit sa valeur par défaut, `user`. Tout le monde arrive
// donc en simple utilisateur, SILENCIEUSEMENT, y compris les membres du groupe `admins`.

const TTL_ROLE_MS = 30_000
const rolesAttendus = new Map<string, { role: string, expire: number }>()

function memoriserRole(email: string | undefined, role: string): void {
    if (!email) return
    const maintenant = Date.now()
    // Purge opportuniste : la table ne contient que des connexions en cours, elle reste
    // minuscule. Un minuteur dédié serait disproportionné.
    for (const [cle, v] of rolesAttendus) if (v.expire < maintenant) rolesAttendus.delete(cle)
    rolesAttendus.set(email.toLowerCase(), { role, expire: maintenant + TTL_ROLE_MS })
}

/** Le rôle est consommé : une entrée ne sert qu'une fois, et expire si elle ne sert pas. */
function consommerRole(email: string | undefined): string | undefined {
    if (!email) return undefined
    const cle = email.toLowerCase()
    const v = rolesAttendus.get(cle)
    rolesAttendus.delete(cle)
    return v && v.expire >= Date.now() ? v.role : undefined
}

/** `admin` si l'annuaire place la personne dans le groupe déclaré, `user` sinon. */
export function roleDesGroupes(groupes: unknown): string {
    const attendu = envOidc('OIDC_GROUPE_ADMIN') || 'admins'
    const liste = Array.isArray(groupes)
        ? groupes.map(String)
        : String(groupes ?? '').split(',').map(g => g.trim()).filter(Boolean)
    return liste.includes(attendu) ? 'admin' : 'user'
}

/**
 * Point d'accroche commun à la création et à la mise à jour.
 *
 * Deux voies, dans cet ordre. Les GROUPES de l'écriture en cours, quand elle en porte —
 * c'est le cas d'une connexion SSO, et c'est la voie sûre. Sinon le rôle MÉMORISÉ, retrouvé
 * par l'adresse — repli pour les versions ou les chemins où le profil ne transite pas
 * entier.
 */
async function appliquerRole(donnees: Record<string, unknown>) {
    if (donnees.groupes !== undefined && donnees.groupes !== null) {
        return { data: { ...donnees, role: roleDesGroupes(donnees.groupes) } }
    }
    const memorise = consommerRole(donnees.email as string | undefined)
    return memorise ? { data: { ...donnees, role: memorise } } : undefined
}

if (!oidcConfigure) {
    console.warn(
        "⚠️  SSO désactivé : OIDC_CLIENT_ID ou OIDC_DISCOVERY_URL n'est pas renseigné "
        + "(anciens noms OUATE_* également acceptés). Seul le compte de secours peut se connecter.",
    )
}

const auth = betterAuth({
    // Le schéma est passé EXPLICITEMENT : `schemas.ts` exporte des espaces de noms
    // (`authSchema.user`), et l'adaptateur cherche `user` à plat. Sans ça il échoue au
    // premier appel avec « model user not found », loin de la cause.
    database: drizzleAdapter(db, { provider: "pg", schema: tablesAuth }),
    emailAndPassword: {
        // Compte de secours uniquement : sans lui, une panne de dex ou un claim `groups`
        // absent ferme l'application à tout le monde, y compris à qui pourrait la réparer.
        enabled: true,
        // `domain` a figuré ici. Il n'existe pas dans le type de cette
        // version, et il ne faisait rien : `process.env.AUTH_DOMAIN || undefined` valait
        // toujours `undefined` puisque la variable n'est jamais renseignée. Retiré plutôt
        // que forcé — une option inerte laisse croire à un réglage.
    },
    advanced: {
        // COOKIE LIÉ À SON SEUL HÔTE. Divergence assumée avec les applications voisines,
        // qui activent `crossSubDomainCookies`.
        //
        // L'assistant tient sur un seul hôte, et son retour OIDC revient sur ce même hôte.
        // Rien ne justifie de diffuser son cookie plus loin.
        cookiePrefix: "assistants",
    },
    user: {
        additionalFields: {
            // Recopiés du jeton à la connexion, relus à chaque requête par le middleware.
            groupes: { type: "string", required: false, defaultValue: "" },
        },
    },
    plugins: [
        // Toujours présent, pour que le typage et les routes restent stables. Sans
        // fournisseur déclaré, aucune connexion réseau n'est tentée au démarrage.
        genericOAuth({
            config: !oidcConfigure ? [] : [{
                providerId: FOURNISSEUR,
                clientId: envOidc('OIDC_CLIENT_ID')!,
                clientSecret: lireSecretOidc('OIDC_CLIENT_SECRET')!,
                discoveryUrl: envOidc('OIDC_DISCOVERY_URL')!,
                ...(envOidc('OIDC_REDIRECT_URI') ? { redirectURI: envOidc('OIDC_REDIRECT_URI')! } : {}),
                scopes: ['openid', 'profile', 'email', 'groups', 'federated:id'],

                // RELIT LE PROFIL À CHAQUE CONNEXION, et c'est indispensable ici.
                //
                // Sans cette option, Better Auth n'écrit la ligne `user` qu'à la CRÉATION
                // du compte : aux connexions suivantes il ne met à jour que le compte OAuth
                // et la session. Le point d'accroche `user.update` ne se déclenchait donc
                // jamais, et un compte créé avant le correctif restait bloqué à `user` —
                // sans aucun moyen pour son titulaire de s'en sortir.
                overrideUserInfo: true,
                mapProfileToUser(brut) {
                    const profile = brut as ProfilOIDC
                    if (!profile.email) {
                        throw new Error("Le jeton OIDC ne porte pas d'adresse de courriel.")
                    }
                    const groupes = profile.groups ?? []
                    // Mémorisé ICI et renvoyé ci-dessous : renvoyé, il sert aux versions qui
                    // l'honorent ; mémorisé, il survit au filtre des versions récentes.
                    memoriserRole(profile.email, roleDesGroupes(groupes))
                    return {
                        email: profile.email,
                        role: roleDesGroupes(groupes),
                        groupes: groupes.join(','),
                        image: envOidc('OIDC_NC_URL')
                            ? `${envOidc('OIDC_NC_URL')}/avatar/${profile.federated_claims?.user_id}/512`
                            : undefined,
                    }
                },
            }],
        }),
        admin(),
    ],
    databaseHooks: {
        user: {
            // LE RÔLE EST DÉDUIT DE `groupes` DANS LA MÊME ÉCRITURE.
            //
            // Le Catalogue mémorise le rôle à la connexion et le retrouve par l'adresse,
            // parce qu'il n'a pas les groupes sous la main au moment de l'accroche. Nous
            // les stockons — c'est un champ supplémentaire du profil — donc nous pouvons
            // faire plus simple ET plus sûr : pas de table temporaire, pas de délai
            // d'expiration, pas de clé qui peut manquer.
            create: { before: appliquerRole as any },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update: { before: appliquerRole as any },
        },
    },
    trustedOrigins: process.env.TRUSTED_ORIGINS?.split(",") || [],
})

export { auth }
