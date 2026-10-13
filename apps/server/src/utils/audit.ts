// JOURNAL DE CONSULTATION.
//
// Une fonction par outil, plutôt qu'une fonction générique avec un drapeau. Ce n'est pas
// du style : la différence entre les deux est une règle qu'on ne doit pas pouvoir enfreindre
// par inadvertance.

import { db } from "@assistants/database";
import { indexSchema } from "@assistants/database/tables";
import { lireBooleen, lireNombre } from "./reglages";
import { lt, sql } from "drizzle-orm";
import type { Citation } from "./assistant";
import type { Origine } from "./ia";

/** Le journal ne doit jamais faire échouer une réponse déjà produite. */
async function ecrire(ligne: typeof indexSchema.consultation.$inferInsert) {
    try { await db.insert(indexSchema.consultation).values(ligne) }
    catch (e) { console.error('audit: écriture impossible —', e instanceof Error ? e.message : e) }
}

export async function consignerAssistant(v: {
    utilisateur: string | null
    question: string
    trouve: boolean
    citations: Citation[]
    origine: Origine
    dureeMs: number
}) {
    const garderQuestion = await lireBooleen('audit.conserver_question')
    await ecrire({
        outil: 'assistant',
        utilisateur: v.utilisateur,
        question: garderQuestion ? v.question.slice(0, 2000) : null,
        tailleEntree: v.question.length,
        trouve: v.trouve,
        // Les références suffisent à refaire le chemin. Stocker la réponse en ferait une
        // seconde copie de texte engendré, qu'on relirait un jour comme un constat.
        citations: v.citations.map(c => ({
            reference: c.reference, titre: c.titre, section: c.section,
            source: c.source, statut: c.statut,
        })),
        modele: v.origine.modele,
        consigne: v.origine.consigne,
        dureeMs: v.dureeMs,
    })
}

/**
 * Pour l'analyse de journaux. Cette fonction NE PREND PAS le contenu collé, seulement sa
 * longueur — c'est délibéré, et c'est ce qui rend la règle inviolable par mégarde.
 */
export async function consignerJournaux(v: {
    utilisateur: string | null
    tailleEntree: number
    origine?: Origine
    dureeMs: number
    erreur?: string
}) {
    await ecrire({
        outil: 'journaux',
        utilisateur: v.utilisateur,
        question: null,
        tailleEntree: v.tailleEntree,
        modele: v.origine?.modele ?? null,
        consigne: v.origine?.consigne ?? null,
        dureeMs: v.dureeMs,
        erreur: v.erreur?.slice(0, 500) ?? null,
    })
}

/**
 * Purge les lignes trop anciennes.
 *
 * Lancée avec la synchronisation. Sans elle, la durée de conservation affichée dans les
 * réglages serait une intention et non un fait — et c'est le fait qui compte devant le
 * registre des traitements.
 */
export async function purger(): Promise<number> {
    const jours = await lireNombre('audit.retention_jours')
    const limite = new Date(Date.now() - jours * 86400_000)
    const r = await db.delete(indexSchema.consultation)
        .where(lt(indexSchema.consultation.date, limite))
        .returning({ id: indexSchema.consultation.id })
    return r.length
}

/** Ce que l'administration affiche. La question n'apparaît que si elle a été conservée. */
export async function journal(limite = 200) {
    return db.select().from(indexSchema.consultation)
        .orderBy(sql`date desc`)
        .limit(Math.min(limite, 1000))
}
