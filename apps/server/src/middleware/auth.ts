// CONTRÔLE D'ACCÈS.
//
// Deux barrières, dans cet ordre :

import { Elysia } from "elysia";
import { auth } from "@assistants/auth";
import { lire } from "../utils/reglages";

export type Utilisateur = {
    id: string
    email: string
    role: string
    groupes: string[]
}

/**
 * Un groupe non renseigné ferme l'accès SSO au lieu de l'ouvrir à tous.
 *
 * C'est délibéré et c'est le sens du défaut vide dans le registre : une instance déployée
 * mais pas configurée ne doit pas être ouverte, elle doit être inutilisable. Le compte de
 * secours, qui est administrateur, reste la porte de service pour aller la configurer.
 */
async function groupeAutorise(u: Utilisateur): Promise<{ ok: boolean, motif?: string }> {
    if (u.role === 'admin') return { ok: true }

    // INTERRUPTEUR DE DÉPLOIEMENT. En phase d'essai, on ouvre l'application aux seuls
    // administrateurs le temps de vérifier ce qu'elle répond, puis on l'élargit sans
    // redéployer une image différente.
    //
    // En variable d'environnement et non en réglage de base : un réglage qui décide QUI
    // peut se connecter, modifiable depuis l'application, se retourne mal — il suffit d'une
    // fausse manœuvre pour ouvrir l'accès, et personne ne s'en aperçoit. L'environnement
    // demande un redéploiement, ce qui est le bon niveau de friction pour cette décision.
    if (process.env.OIDC_ADMINS_SEULEMENT === 'true') {
        return {
            ok: false,
            motif: "L'application est ouverte aux seuls administrateurs pour le moment.",
        }
    }

    const attendu = (await lire('instance.groupe_sso')).trim()
    if (!attendu) {
        return {
            ok: false,
            motif: "Aucun groupe SSO n'est déclaré pour cette instance : l'accès est fermé tant qu'un administrateur ne l'a pas renseigné.",
        }
    }
    if (!u.groupes.includes(attendu)) {
        return {
            ok: false,
            motif: `Votre compte n'appartient pas au groupe « ${attendu} », seul autorisé sur cette instance.`,
        }
    }
    return { ok: true }
}

/** `null` si pas de session valide, ou si le groupe ne convient pas. */
async function resoudre(headers: Headers): Promise<
    { ok: true, utilisateur: Utilisateur } | { ok: false, code: 401 | 403, message: string }
> {
    const session = await auth.api.getSession({ headers })
    if (!session?.user) return { ok: false, code: 401, message: 'Non authentifié.' }

    const u = session.user as unknown as { id: string, email: string, role?: string, groupes?: string }

    // Le rôle vient de la COLONNE, comme dans le Catalogue. Il y arrive correctement grâce
    // au point d'accroche de `packages/auth`, qui réapplique le rôle calculé depuis les
    // groupes — le greffon `admin` de Better Auth l'écraserait sinon.
    //
    // Une déduction par requête depuis `groupes` avait été essayée : elle a le mérite de
    // relire l'appartenance à chaque appel, donc de retirer les droits dès qu'une personne
    // sort du groupe dans l'annuaire. Elle a été abandonnée pour aligner les trois
    // applications sur une seule mécanique — un mécanisme unique et compris partout vaut
    // mieux qu'un mécanisme meilleur ici et différent ailleurs.
    const utilisateur: Utilisateur = {
        id: u.id,
        email: u.email,
        role: u.role ?? 'user',
        groupes: (u.groupes ?? '').split(',').map(g => g.trim()).filter(Boolean),
    }

    const autorise = await groupeAutorise(utilisateur)
    if (!autorise.ok) {
        // Le motif est rendu tel quel : « accès refusé » n'apprend rien à qui le lit, et
        // « pas dans le bon groupe » et « ouvert aux seuls admins » se corrigent
        // différemment.
        return { ok: false, code: 403, message: autorise.motif ?? 'Accès refusé.' }
    }
    return { ok: true, utilisateur }
}

export const authMiddleware = new Elysia({ name: 'auth' })
    .resolve({ as: 'scoped' }, async ({ request, status }) => {
        const r = await resoudre(request.headers)
        if (!r.ok) return status(r.code, { erreur: r.message })
        return { utilisateur: r.utilisateur }
    })

/** Réservé aux administrateurs : réglages, sources, sondes. */
export const adminMiddleware = new Elysia({ name: 'auth-admin' })
    .resolve({ as: 'scoped' }, async ({ request, status }) => {
        const r = await resoudre(request.headers)
        if (!r.ok) return status(r.code, { erreur: r.message })
        if (r.utilisateur.role !== 'admin') {
            return status(403, { erreur: 'Réservé aux administrateurs.' })
        }
        return { utilisateur: r.utilisateur, admin: r.utilisateur }
    })
