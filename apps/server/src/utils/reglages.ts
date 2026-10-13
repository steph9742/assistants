// LECTURE ET ÉCRITURE DES RÉGLAGES.
//
// Le registre (`@assistants/database/registre`) dit ce qui existe, avec quel défaut et
// quel type. Cette couche fait le lien avec la base : une clé absente de la table renvoie
// le défaut du registre, une clé déclarée « secret » est chiffrée à l'écriture et
// déchiffrée à la lecture.

import { db } from "@assistants/database";
import { settingsSchema } from "@assistants/database/tables";
import { REGISTRE, reglage, estSecret, valider } from "@assistants/database/registre";
import { inArray, eq, sql } from "drizzle-orm";
import { chiffrer, dechiffrer } from "./secrets";

/** Valeurs brutes en base, pour les clés demandées. Absentes = non surchargées. */
async function brutes(cles: string[]): Promise<Record<string, string>> {
    if (!cles.length) return {}
    const lignes = await db.select().from(settingsSchema.appSetting)
        .where(inArray(settingsSchema.appSetting.key, cles))
    return Object.fromEntries(lignes.map(l => [l.key, l.value?.trim() ?? '']))
}

/**
 * Lit un réglage. Renvoie toujours une chaîne : le défaut du registre si rien n'est
 * enregistré, la valeur déchiffrée si c'est un secret.
 *
 * Un secret dont le déchiffrement échoue renvoie le défaut (vide, en pratique) plutôt que
 * des octets illisibles : l'intégration doit se taire jusqu'à ressaisie, pas s'authentifier
 * avec n'importe quoi.
 */
export async function lire(cle: string): Promise<string> {
    const r = reglage(cle)
    const v = (await brutes([cle]))[cle]
    if (v === undefined || v === '') return r.defaut
    return estSecret(cle) ? (dechiffrer(v) ?? r.defaut) : v
}

export async function lireNombre(cle: string): Promise<number> {
    const r = reglage(cle)
    if (r.type !== 'nombre') throw new Error(`« ${cle} » n'est pas un nombre.`)
    const n = Number(await lire(cle))
    // Une valeur illisible en base ne doit pas propager NaN dans un délai ou une limite.
    return Number.isFinite(n) ? n : Number(r.defaut)
}

export async function lireBooleen(cle: string): Promise<boolean> {
    return (await lire(cle)) === 'true'
}

export async function lireListe(cle: string): Promise<string[]> {
    return (await lire(cle)).split(',').map(s => s.trim()).filter(Boolean)
}

/** Lit plusieurs réglages d'un coup — un seul aller-retour en base. */
export async function lirePlusieurs(cles: string[]): Promise<Record<string, string>> {
    const v = await brutes(cles)
    const sortie: Record<string, string> = {}
    for (const cle of cles) {
        const r = reglage(cle)
        const b = v[cle]
        sortie[cle] = (b === undefined || b === '')
            ? r.defaut
            : (estSecret(cle) ? (dechiffrer(b) ?? r.defaut) : b)
    }
    return sortie
}

export type EchecEcriture = { cle: string, motif: string }

/**
 * Écrit des réglages. Valide d'abord TOUT, n'écrit qu'ensuite : un lot à moitié appliqué
 * laisserait une configuration incohérente sans que personne le sache.
 *
 * Une valeur vide efface la ligne — donc rétablit le défaut du registre. C'est la seule
 * façon de « revenir en arrière » sans avoir à connaître la valeur d'origine.
 */
export async function ecrire(
    valeurs: Record<string, string>,
    parQui: string | null = null,
): Promise<EchecEcriture[]> {
    const echecs: EchecEcriture[] = []
    for (const [cle, valeur] of Object.entries(valeurs)) {
        try {
            const motif = valider(cle, valeur)
            if (motif) echecs.push({ cle, motif })
        }
        catch (e) {
            echecs.push({ cle, motif: e instanceof Error ? e.message : String(e) })
        }
    }
    if (echecs.length) return echecs

    for (const [cle, valeur] of Object.entries(valeurs)) {
        if (valeur === '') {
            await db.delete(settingsSchema.appSetting).where(eq(settingsSchema.appSetting.key, cle))
            continue
        }
        const aEcrire = estSecret(cle) ? chiffrer(valeur) : valeur
        await db.insert(settingsSchema.appSetting)
            .values({ key: cle, value: aEcrire, updatedBy: parQui })
            .onConflictDoUpdate({
                target: settingsSchema.appSetting.key,
                set: { value: aEcrire, updatedAt: sql`now()`, updatedBy: parQui },
            })
    }
    return []
}

/**
 * État de tous les réglages, pour l'interface d'administration.
 *
 * Les secrets ne ressortent JAMAIS en clair : on dit seulement s'ils sont renseignés.
 * C'est ce qui permet d'afficher un écran de réglages sans exposer les jetons à quiconque
 * ouvre les outils de développement du navigateur.
 */
export async function etat(): Promise<Array<{
    cle: string, rubrique: string, libelle: string, description: string,
    type: string, portee: string, defaut: string, note?: string,
    unite?: string, min?: number, max?: number,
    valeur: string | null, renseigne: boolean, surcharge: boolean,
}>> {
    const v = await brutes(REGISTRE.map(r => r.cle))
    return REGISTRE.map(r => {
        const brut = v[r.cle]
        const surcharge = brut !== undefined && brut !== ''
        const secret = r.type === 'secret'
        return {
            cle: r.cle, rubrique: r.rubrique, libelle: r.libelle, description: r.description,
            type: r.type, portee: r.portee, defaut: r.defaut, note: r.note,
            unite: r.unite, min: r.min, max: r.max,
            valeur: secret ? null : (surcharge ? brut : r.defaut),
            renseigne: secret ? (surcharge || r.defaut !== '') : true,
            surcharge,
        }
    })
}
