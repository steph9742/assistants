// NOMS DE VARIABLES DU SSO — l'actuel d'abord, l'ancien ensuite.
//
// Ces variables s'appelaient `OUATE_*`, du nom de l'annuaire qui les a vues naître. Un outil
// publié ne peut pas demander à ses lecteurs de deviner ce qu'est « ouate », donc elles
// s'appellent `OIDC_*` — et les anciens noms restent lus, sans date de péremption.
//
// Le repli n'est pas une transition qu'on refermera. Un `.env` de production s'édite
// rarement, et une variable renommée sans repli ne casse pas au déploiement : elle casse à la
// PREMIÈRE CONNEXION qui suit, quand le SSO s'éteint sans bruit et que le compte de secours
// est seul à passer. Le coût du repli est trois lignes ; le coût de son absence est une
// authentification muette un vendredi soir.
//
// LA VALEUR VIDE NE DOIT PAS MASQUER L'ANCIENNE, et c'est toute la raison de ce module.
// `docker-compose.yml` passe chaque variable sous la forme `${OIDC_CLIENT_ID:-}`, donc le
// nouveau nom est TOUJOURS défini dans le processus — à vide quand le `.env` ne le porte pas.
// Un repli écrit sur la présence (`nom in process.env`) marcherait en essai, où seules les
// variables posées existent, et ne se déclencherait JAMAIS en production. Il se lit donc sur
// la valeur, et c'est ce que vérifie l'essai correspondant.

import { lireSecret } from "./secret-env";

const ancien = (nom: string) => nom.replace(/^OIDC_/, 'OUATE_')

/** Lit une variable du SSO sous son nom actuel, puis sous son ancien nom. */
export function envOidc(nom: `OIDC_${string}`): string | undefined {
    return process.env[nom]?.trim() || process.env[ancien(nom)]?.trim() || undefined
}

/**
 * Comme `envOidc`, pour un secret — donc en honorant la variante `_FILE`.
 *
 * Le nom est choisi AVANT la lecture, et sur les deux formes du nouveau : poser
 * `OIDC_CLIENT_SECRET_FILE` suffit à basculer, sans toucher à `OIDC_CLIENT_SECRET`. Le nom
 * choisi, `lireSecret` garde ses règles — le fichier prime, et un fichier illisible lève au
 * lieu de retomber en silence sur la variable.
 */
export function lireSecretOidc(nom: `OIDC_${string}`): string | undefined {
    const poseNeuf = process.env[`${nom}_FILE`]?.trim() || process.env[nom]?.trim()
    return lireSecret(poseNeuf ? nom : ancien(nom))
}
