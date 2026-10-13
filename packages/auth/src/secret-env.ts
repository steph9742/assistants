// SECRETS DE DÉMARRAGE — hors des variables d'environnement.
//
// Trois secrets ne peuvent pas vivre chiffrés en base, parce qu'ils sont nécessaires AVANT
// que la base soit lisible : le secret client OIDC, le secret de session, et le mot de
// passe PostgreSQL. Les réglages sensibles, eux — jetons GitLab, Nextcloud, Open WebUI —
// sont bien chiffrés en base par `utils/secrets.ts`.

import { readFileSync } from "node:fs";

/**
 * Lit un secret, du fichier d'abord, de l'environnement ensuite.
 */
export function lireSecret(nom: string): string | undefined {
    const chemin = process.env[`${nom}_FILE`]?.trim()

    if (chemin) {
        try {
            const valeur = readFileSync(chemin, 'utf-8').trim()
            if (valeur) return valeur
            throw new Error('fichier vide')
        }
        catch (e) {
            throw new Error(
                `${nom}_FILE désigne « ${chemin} », qui n'est pas lisible ou est vide. `
                + `Le secret n'est PAS repris de ${nom} : corrigez le fichier, ou retirez ${nom}_FILE. `
                + `(${e instanceof Error ? e.message : e})`,
            )
        }
    }

    return process.env[nom]?.trim() || undefined
}
