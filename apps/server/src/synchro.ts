#!/usr/bin/env bun
// SYNCHRONISATION DES SOURCES — processus court, lancé par cron.
//
//   bun run apps/server/src/synchro.ts            toutes les sources actives dues
//   bun run apps/server/src/synchro.ts --forcer     sans tenir compte de l'intervalle
//   bun run apps/server/src/synchro.ts --reindexer  relit tout, empreintes ignorées
//   bun run apps/server/src/synchro.ts --vecteurs-manquants   rattrape les vecteurs absents
//   bun run apps/server/src/synchro.ts --essais-recherche      rejoue les cas d'essai de la recherche
//   bun run apps/server/src/synchro.ts --essais-donnees        vérifie la forme des réponses des sources
//   bun run apps/server/src/synchro.ts --montrer <cle> [k=v…]   montre ce qu'une question reçoit
//   bun run apps/server/src/synchro.ts --formes    rend les clés des questions jamais mesurées\n//   bun run apps/server/src/synchro.ts --lectures  montre ce que les sources DÉCLARENT
//   bun run apps/server/src/synchro.ts --source X   une seule

import { db } from "@assistants/database";
import { indexSchema } from "@assistants/database/tables";
import { and, eq, inArray, sql } from "drizzle-orm";
import { lireNombre } from "./utils/reglages";
import { lireConfig, listerDetaille, lireFichier, urlDocument } from "./utils/gitlab";
import * as nc from "./utils/nextcloud";
import { extraire } from "./utils/extraction";
import { lireEnTete, decouper, titreDuCorps, retirerCommentairesEnTete, mentionPour } from "./utils/decoupe";
import { bilanTroncature, bilanVecteurs, calculerVecteur } from "./utils/embeddings";
import { purger } from "./utils/audit";

/** Un document du corpus dépasse rarement 50 ko. Au-delà, quelque chose ne va pas. */
const TAILLE_MAX = 2_000_000

type Source = typeof indexSchema.source.$inferSelect

/**
 * Le contexte recopié sur chaque passage, pour que l'index puisse s'en servir.
 *
 * Une colonne engendrée ne voit que sa propre ligne : sans cette recopie, le titre du
 * document et ses mots-clés ne peuvent pas entrer dans le `tsvector` du passage. C'est le
 * prix d'un index GIN utilisable, et il est sans risque — ces colonnes sont réécrites à
 * chaque synchronisation et modifiées nulle part ailleurs.
 */
function contexte(entete: { motsCles?: string[], repondA?: string[] }, titre: string, reference?: string | null) {
    const fort = [...(entete.motsCles ?? []), ...(entete.repondA ?? [])].join(' . ').trim()
    return {
        contexteFort: fort || null,
        contexteMoyen: [titre, reference].filter(Boolean).join(' ') || null,
    }
}

async function marquer(sourceId: string, champs: Partial<typeof indexSchema.synchro.$inferInsert>) {
    await db.insert(indexSchema.synchro)
        .values({ sourceId, ...champs })
        .onConflictDoUpdate({ target: indexSchema.synchro.sourceId, set: champs })
}

/**
 * Synchronise une source GitLab.
 *
 * L'ordre compte : on liste d'abord (une requête, les sha de tous les fichiers), on compare
 * aux empreintes en base, et on ne télécharge QUE ce qui a bougé. Sur un corpus qui change
 * une fois par semaine et une synchronisation toutes les six heures, c'est la différence
 * entre 53 téléchargements et zéro.
 */
/**
 * `--forcer` N'EST PAS `--reindexer`, ET LA CONFUSION COÛTE CHER.
 *
 * `--forcer` ignore l'INTERVALLE entre deux passages. Il ne touche pas à la comparaison
 * d'empreinte : un document dont le contenu n'a pas bougé reste sauté, et ses passages ne
 * sont pas réécrits.
 */
async function synchroniserGitLab(s: Source, reindexer: boolean): Promise<{ vus: number, changes: number }> {
    const cfg = lireConfig(s.config, s.jetonChiffre)
    if (!cfg) throw new Error(`Source « ${s.nom} » : adresse, projet ou jeton manquant.`)

    const mentions = ((s.config as Record<string, unknown>)?.mentions as string[] | undefined) ?? []
    const releve = await listerDetaille(cfg)
    const entrees = releve.entrees
    if (releve.absents.length) {
        console.log(`  dossiers absents de ce dépôt, ignorés : ${releve.absents.join(', ')}`)
    }
    const connus = await db.select({
        id: indexSchema.document.id,
        chemin: indexSchema.document.chemin,
        empreinte: indexSchema.document.empreinte,
    }).from(indexSchema.document).where(eq(indexSchema.document.sourceId, s.id))

    const parChemin = new Map(connus.map(d => [d.chemin, d]))
    const vivants = new Set(entrees.map(e => e.chemin))
    let changes = 0

    for (const e of entrees) {
        const existant = parChemin.get(e.chemin)
        if (!reindexer && existant && existant.empreinte === e.empreinte) continue

        const brut = await lireFichier(cfg, e.chemin)
        if (brut.length > TAILLE_MAX) {
            console.error(`  ${e.chemin} : ${brut.length} octets, au-delà du plafond. Ignoré.`)
            continue
        }

        const { entete, corps: avecCommentaires } = lireEnTete(brut)
        const corps = retirerCommentairesEnTete(avecCommentaires)

        // Second filtre dur, indispensable en plus de l'exclusion par chemin :
        // quotidien/qot-13 porte `statut: obsolete` tout en vivant hors de _archive/.
        if (entete.statut === 'obsolete') {
            if (existant) await db.delete(indexSchema.document).where(eq(indexSchema.document.id, existant.id))
            console.log(`  ${e.chemin} : statut obsolete, exclu`)
            continue
        }

        const taille = await lireNombre('recherche.taille_passage')
        const passages = decouper(corps, taille)

        // Remplacement complet plutôt que rapprochement passage par passage : le document
        // a changé, ses découpes aussi, et un rapprochement laisserait des orphelins que
        // personne ne verrait jamais.
        if (existant) await db.delete(indexSchema.document).where(eq(indexSchema.document.id, existant.id))

        const titreDoc = entete.titre ?? titreDuCorps(corps) ?? e.chemin.split('/').pop() ?? e.chemin

        const [doc] = await db.insert(indexSchema.document).values({
            sourceId: s.id,
            chemin: e.chemin,
            empreinte: e.empreinte,
            reference: entete.reference ?? null,
            // Trois recours, dans cet ordre. L'en-tête YAML pour le corpus maison ; le
            // premier `# ` pour tout ce qui n'en a pas — sans quoi la documentation
            // éditeur s'indexerait sous le nom « index.md » cent-quatre-vingt-dix-sept
            // fois, et une citation ne dirait rien de ce qu'elle cite ; le chemin en
            // dernier ressort.
            titre: titreDoc,
            typeDoc: entete.type ?? null,
            // Le linter du corpus garantit une valeur au plus : la liste est une syntaxe.
            // TOUTES les valeurs, pas la première : un document peut éclairer plusieurs
            // domaines, et la rédaction l'a écrit noir sur blanc.
            typesIncident: entete.typeIncidents?.length ? entete.typeIncidents : null,
            domainesCatalogue: entete.domainesCatalogue?.length ? entete.domainesCatalogue : null,
            statut: entete.statut ?? null,
            version: entete.version ?? null,
            dateRevision: entete.dateRevision ?? null,
            url: urlDocument(cfg, e.chemin),
            mention: mentionPour(e.chemin, mentions),
            extraction: passages.length ? 'complete' : 'none',
        }).returning({ id: indexSchema.document.id })

        for (const p of passages) {
            await db.insert(indexSchema.passage).values({
                documentId: doc!.id,
                ordre: p.ordre,
                titreSection: p.titreSection,
                ancre: p.ancre,
                texte: p.texte,
                ...contexte(entete, titreDoc, entete.reference),
                vecteur: await calculerVecteur(p.texte, 'passage'),
            })
        }
        changes++
        console.log(`  ${e.chemin} → ${passages.length} passages`)
    }

    // Fichiers disparus du dépôt. Les laisser serait servir des procédures supprimées.
    const disparus = connus.filter(d => !vivants.has(d.chemin))
    if (disparus.length) {
        await db.delete(indexSchema.document)
            .where(inArray(indexSchema.document.id, disparus.map(d => d.id)))
        console.log(`  ${disparus.length} document(s) disparu(s) du dépôt, retiré(s) de l'index`)
    }

    return { vus: entrees.length, changes }
}

/**
 * Synchronise un dossier Nextcloud.
 *
 * Deux chemins. Avec un jeton, on demande le DELTA — Nextcloud rend ce qui a changé et ce
 * qui a disparu, ce que la comparaison de listes de GitLab ne sait pas faire aussi bien.
 * Sans jeton, ou quand le serveur le refuse, on relit tout.
 */
async function synchroniserNextcloud(s: Source, etatPrecedent: string | null, reindexer: boolean): Promise<{ vus: number, changes: number, jeton: string | null, echecs: number }> {
    const cfg = nc.lireConfig(s.config, s.jetonChiffre)
    if (!cfg) throw new Error(`Source « ${s.nom} » : adresse, compte ou mot de passe manquant.`)

    let releve: nc.Releve
    if (etatPrecedent) {
        try { releve = await nc.depuis(cfg, etatPrecedent) }
        catch (e) {
            if (!(e instanceof nc.JetonPerime)) throw e
            console.log(`  ${e.message}`)
            releve = await nc.relever(cfg)
        }
    }
    else releve = await nc.relever(cfg)

    const connus = await db.select({
        id: indexSchema.document.id,
        chemin: indexSchema.document.chemin,
        empreinte: indexSchema.document.empreinte,
    }).from(indexSchema.document).where(eq(indexSchema.document.sourceId, s.id))
    const parChemin = new Map(connus.map(d => [d.chemin, d]))

    // UN CHEMIN, UNE ENTRÉE. un relevé WebDAV peut porter deux fois le même
    // chemin. La boucle supprime-puis-insère ; au second passage du doublon, la
    // suppression vise un identifiant déjà parti, ne retire rien, et l'insertion viole la
    // contrainte (source, chemin) — un doublon de listing devenait une panne de source
    // entière. La dernière occurrence gagne, et le doublon est dit.
    const uniques = new Map(releve.vivants.map(v => [v.chemin, v]))
    if (uniques.size < releve.vivants.length) {
        console.log(`  ${releve.vivants.length - uniques.size} entrée(s) en double dans le relevé, dédoublonnées`)
    }
    const vivants = [...uniques.values()]

    const taille = await lireNombre('recherche.taille_passage')
    let changes = 0
    let echecs = 0

    for (const e of vivants) {
        if (nc.exclu(e.chemin, cfg.exclusions)) continue
        const existant = parChemin.get(e.chemin)
        if (!reindexer && existant && existant.empreinte === e.empreinte) continue

        if (e.taille > cfg.tailleMax) {
            console.error(`  ${e.chemin} : ${e.taille} octets, au-delà du plafond. Ignoré.`)
            continue
        }

        // UN FICHIER NE TUE PAS LA SOURCE. Ces fichiers sont déposés par des tiers dans un
        // dossier partagé : l'un d'eux qui casse — extraction, insertion, peu importe —
        // est une information à consigner, pas une raison d'abandonner les centaines
        // d'autres. L'échec est nommé fichier par fichier, compté, et remonté dans l'état
        // de la source.
        try {
            const r = await extraire(e.chemin, await nc.lireFichier(cfg, e.chemin))
            const corps = r.texte ? retirerCommentairesEnTete(lireEnTete(r.texte).corps) : ''
            const passages = corps ? decouper(corps, taille) : []

            if (existant) await db.delete(indexSchema.document).where(eq(indexSchema.document.id, existant.id))

            const titreNc = titreDuCorps(corps) ?? e.chemin.split('/').pop() ?? e.chemin

            const [doc] = await db.insert(indexSchema.document).values({
                sourceId: s.id,
                chemin: e.chemin,
                empreinte: e.empreinte,
                reference: e.fileid,
                titre: titreNc,
                // Pas de statut : un document Nextcloud n'a pas d'en-tête. Ce n'est pas un
                // défaut à combler, c'est une information — l'interface affiche « statut
                // inconnu » plutôt qu'un vide qui se lirait comme « rien à signaler ».
                statut: null,
                dateRevision: e.modifieLe ? new Date(e.modifieLe).toISOString().slice(0, 10) : null,
                url: nc.urlDocument(cfg, e.fileid, e.chemin),
                mention: mentionPour(e.chemin, cfg.mentions),
                extraction: r.etat,
            }).returning({ id: indexSchema.document.id })

            for (const p of passages) {
                await db.insert(indexSchema.passage).values({
                    documentId: doc!.id, ordre: p.ordre,
                    titreSection: p.titreSection, ancre: p.ancre, texte: p.texte,
                    // Un document Nextcloud n'a pas d'en-tête : pas de zone A, mais son titre
                    // compte autant que celui d'une fiche.
                    ...contexte({}, titreNc, null),
                    vecteur: await calculerVecteur(p.texte, 'passage'),
                })
            }
            changes++
            console.log(`  ${e.chemin} → ${passages.length} passages${r.etat === 'none' ? ` (${r.motif})` : ''}`)
        }
        catch (err) {
            echecs++
            // La CAUSE, pas l'emballage : Drizzle préfixe son message par la requête
            // entière, et la ligne Postgres qui dit pourquoi — contrainte violée, octet
            // invalide — passait après la troncature. Vingt-neuf échecs identiques et
            // illisibles l'ont payé.
            const cause = err instanceof Error
                ? (err.cause instanceof Error ? err.cause.message : err.message)
                : String(err)
            console.error(`  ${e.chemin} : ÉCHEC — ${cause.slice(0, 300)}`)
        }
    }

    // Suppressions. En lecture complète, ce sont les chemins absents du relevé ; en delta,
    // ceux que Nextcloud a explicitement marqués disparus.
    const aRetirer = releve.complet
        ? connus.filter(d => !uniques.has(d.chemin)).map(d => d.id)
        : releve.disparus.map(c => parChemin.get(c)?.id).filter((x): x is string => !!x)

    if (aRetirer.length) {
        await db.delete(indexSchema.document).where(inArray(indexSchema.document.id, aRetirer))
        console.log(`  ${aRetirer.length} document(s) retiré(s) de l'index`)
    }

    return { vus: vivants.length, changes, jeton: releve.jeton, echecs }
}

async function synchroniser(s: Source, forcer: boolean, reindexer: boolean) {
    if (!s.actif) { console.log(`${s.nom} : inactive, ignorée`); return }

    if (!forcer && !reindexer) {
        const [etat] = await db.select().from(indexSchema.synchro)
            .where(eq(indexSchema.synchro.sourceId, s.id))
        const intervalle = await lireNombre('synchro.intervalle_h') * 3600_000
        if (etat?.dernierSucces && Date.now() - etat.dernierSucces.getTime() < intervalle) {
            console.log(`${s.nom} : à jour`)
            return
        }
    }

    console.log(`${s.nom} : synchronisation`)
    const [avant] = await db.select().from(indexSchema.synchro)
        .where(eq(indexSchema.synchro.sourceId, s.id))
    await marquer(s.id, { dernierDebut: new Date(), etat: 'en_cours', message: null })

    try {
        let r: { vus: number, changes: number, jeton?: string | null, echecs?: number }
        switch (s.type) {
            case 'gitlab':
                r = await synchroniserGitLab(s, reindexer); break
            case 'nextcloud_fichiers':
                r = await synchroniserNextcloud(s, forcer || reindexer ? null : avant?.dernierJeton ?? null, reindexer); break
            default:
                // Les sources de nature « données » — Catalogue, Sniff, tâches Nextcloud —
                // ne s'indexent pas : elles sont interrogées au moment de la question.
                console.log(`${s.nom} : source interrogée à la question, rien à indexer`)
                await marquer(s.id, { dernierSucces: new Date(), etat: 'ok', message: null })
                return
        }

        await marquer(s.id, {
            dernierSucces: new Date(), etat: 'ok',
            message: r.echecs ? `${r.echecs} fichier(s) en échec — voir le journal de synchronisation` : null,
            documentsVus: r.vus, documentsChanges: r.changes,
            ...(r.jeton !== undefined ? { dernierJeton: r.jeton } : {}),
        })
        console.log(`${s.nom} : ${r.vus} documents, ${r.changes} mis à jour${r.echecs ? `, ${r.echecs} en échec` : ''}`)
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        // L'échec est ENREGISTRÉ, pas seulement journalisé : sans trace en base, l'interface
        // afficherait une source simplement vieillissante là où elle est en panne.
        await marquer(s.id, { etat: 'echec', message: message.slice(0, 1000) })
        console.error(`${s.nom} : ÉCHEC — ${message}`)
        process.exitCode = 1
    }
}

const args = process.argv.slice(2)
const forcer = args.includes('--forcer')
/**
 * Relit TOUT et réécrit tous les passages, sans tenir compte des empreintes.
 *
 * À passer après toute migration qui change ce qu'on indexe. `--forcer` ne suffit pas : il
 * ignore l'intervalle, pas la comparaison d'empreinte, et laisse donc les colonnes neuves
 * nulles sur les documents inchangés — sans qu'aucune erreur ne le dise.
 */
const reindexer = args.includes('--reindexer')
/**
 * Rattrape les passages sans vecteur, sans rien relire.
 *
 * Après une réindexation, 25 passages sur 3 196 étaient restés sans vecteur — délais
 * dépassés, très probablement. Les rattraper imposait jusqu'ici de tout refaire : relire les
 * sources, redécouper, revectoriser 3 196 passages pour 25. Une heure pour 0,8 %.
 */
const vecteursManquants = args.includes('--vecteurs-manquants')
/**
 * Rejoue les cas d'essai de la recherche contre la vraie base, SANS MODÈLE.
 *
 * Toutes les régressions de la recherche ont été découvertes en service, par un humain qui
 * connaissait la réponse. Ce mode est cet humain, disponible à chaque déploiement — la
 * recherche étant déterministe, un passage unique prouve, là où un essai du modèle ne
 * prouve rien.
 */
const essaisRecherche = args.includes('--essais-recherche')
/**
 * Vérifie que la FORME des réponses des sources vivantes tient toujours.
 *
 * Le Catalogue et Sniff déploient vite. Si un champ dont nos post-conditions dépendent
 * change de nom, elles cessent de se déclencher EN SILENCE : la réponse sort, plausible,
 * sans ses mises en garde. Ce mode appelle chaque question déclarée avec des paramètres
 * anodins et vérifie les champs déclarés — jamais le contenu, qui vit.
 */
/**
 * CE QUE LES SOURCES DÉCLARENT — que nous consommions sans jamais pouvoir le regarder.
 *
 * Le manque s'est vu à l'usage : chaque fois qu'une question portait sur ce que la source
 * déclare — quelles familles d'OS ? quels domaines connus ? — il fallait déduire depuis une
 * réponse ou demander au fournisseur. Un contrat qu'on ne peut pas relire se discute de
 * mémoire, et c'est ainsi qu'on affirme qu'un champ est une date alors qu'il est un booléen.
 */
const lectures = args.includes('--lectures')

const essaisDonnees = args.includes('--essais-donnees')

/** La valeur à un chemin, ou `undefined`. Un tableau se lit sur son premier élément. */
function valeurAu(corps: unknown, chemin: string): unknown {
    let n: any = corps
    for (const part of chemin.split('.')) {
        if (Array.isArray(n)) { if (!n.length) return undefined; n = n[0] }
        if (n === null || typeof n !== 'object') return undefined
        n = n[part]
    }
    return n
}
/**
 * Montre ce qu'une question déclarée reçoit RÉELLEMENT — la requête, les mentions, et le
 * début du corps brut.
 *
 * Né du premier passage de --essais-donnees : trois formes en échec, et aucun moyen de
 * trancher entre « la source a dérivé » et « ma déclaration était fausse » sans voir la
 * réponse. La clé de service est chiffrée en base, à dessein — cet outil est le seul chemin
 * de lecture ad hoc, et il ne sait faire que ce qu'executer() sait faire : les questions
 * déclarées, leurs paramètres filtrés, rien d'autre.
 */
/**
 * LA FORME DES QUESTIONS QUE RIEN N'A JAMAIS MESURÉES.
 *
 * Seize questions n'avaient aucun champ attendu : leur forme venait du contrat, jamais de
 * la charge utile. C'est l'état exact dans lequel une exigence portant sur `titre` a
 * survécu à un champ qui n'existe pas chez Sniff — rien ne rougissait, la réponse sortait
 * simplement sans intitulé.
 */
const formes = args.includes('--formes')

const montrerIdx = args.indexOf('--montrer')
const seule = args.includes('--source') ? args[args.indexOf('--source') + 1] : null

const sources = await db.select().from(indexSchema.source)
    .where(seule ? eq(indexSchema.source.nom, seule) : sql`true`)

if (!sources.length) {
    console.error(seule ? `Aucune source nommée « ${seule} ».` : 'Aucune source configurée.')
    process.exit(1)
}

if (formes) {
    const { executer } = await import('./utils/donnees')
    const { QUESTIONS } = await import('./utils/questions')

    /** Les clés d'un corps : celles du dessus, puis celles du premier élément de ses tableaux. */
    const clesDe = (corps: unknown, prefixe = '', profondeur = 0): string[] => {
        if (profondeur > 2 || corps === null || typeof corps !== 'object') return []
        if (Array.isArray(corps)) return corps.length ? clesDe(corps[0], prefixe, profondeur + 1) : []
        return Object.entries(corps).flatMap(([c, v]) => [
            `${prefixe}${c}`,
            ...(Array.isArray(v) || (v && typeof v === 'object') ? clesDe(v, `${prefixe}${c}.`, profondeur + 1) : []),
        ])
    }

    for (const q of QUESTIONS) {
        if (q.attendChamps?.length) continue
        const libresObligatoires = q.parametres.filter(p => p.obligatoire && !p.valeurs?.length)
        if (libresObligatoires.length) {
            console.log(`— ${q.cle} : SAUTÉE, exige ${libresObligatoires.map(p => p.cle).join(', ')} — mesurer avec --montrer et un objet réel`)
            continue
        }
        // UN PARAMÈTRE OBLIGATOIRE À VALEURS FERMÉES SE REMPLIT TOUT SEUL, comme le fait la
        // sonde de portée. Sans cela, le trou `{catalogue}` partait tel quel dans l'URL et
        // la source répondait 404 — franchement, sur une requête que nous n'aurions jamais
        // dû composer. Le défaut était dans l'outil de mesure, pas dans les questions.
        const fermesObligatoires = Object.fromEntries(q.parametres
            .filter(p => p.obligatoire && p.valeurs?.length)
            .map(p => [p.cle, p.valeurs![0]!]))
        const appel = await executer(q.cle, { ...fermesObligatoires, ...(q.essai ?? {}) })
        if (!appel) { console.log(`— ${q.cle} : question inconnue`); continue }
        if (appel.erreur) { console.log(`— ${q.cle} : ${appel.erreur.slice(0, 160)}`); continue }
        const cles = [...new Set(clesDe(appel.corps))]
        console.log(`— ${q.cle}  (${appel.requete})`)
        console.log(`   ${cles.length ? cles.join(' · ') : '(corps sans clé : tableau vide ou scalaire)'}`)
    }
    process.exit(0)
}

if (montrerIdx !== -1) {
    const cle = args[montrerIdx + 1]
    if (!cle) { console.error('Usage : --montrer <question> [param=valeur…]'); process.exit(1) }
    const params: Record<string, string> = {}
    for (const brut of args.slice(montrerIdx + 2)) {
        const egal = brut.indexOf('=')
        if (egal > 0) params[brut.slice(0, egal)] = brut.slice(egal + 1)
    }
    const { executer } = await import('./utils/donnees')
    const appel = await executer(cle, params)
    if (!appel) { console.error(`Question inconnue : « ${cle} ».`); process.exit(1) }

    console.log(`requête : ${appel.requete}`)
    if (appel.erreur) console.log(`ERREUR : ${appel.erreur}`)
    for (const m of appel.mentions) console.log(`mention : ${m}`)
    const corps = JSON.stringify(appel.corps, null, 1) ?? '(corps vide)'
    /**
     * LES BLOCS DE SYNTHÈSE D'ABORD — la troncature coupait exactement l'information utile.
     *
     * `--montrer` affichait les 3 000 premiers caractères. Or les charges utiles commencent
     * par leur grand tableau — `lignes`, `rows`, `resultats` — et rangent la synthèse
     * derrière : `resume`, `comptes`, `total`. Trois mille caractères ne franchissent jamais
     * quatre-vingts lignes de tableau.
     */
    const racine = appel.corps && typeof appel.corps === 'object' && !Array.isArray(appel.corps)
        ? Object.entries(appel.corps as Record<string, unknown>).filter(([, v]) => !Array.isArray(v))
        : []
    if (racine.length) {
        console.log('\nblocs de synthèse (hors tableaux), en entier :')
        console.log(JSON.stringify(Object.fromEntries(racine), null, 1))
    }

    console.log(`\ncorps (${corps.length} caractères)${corps.length > 3000 ? ', tronqué à 3000' : ''} :`)
    console.log(corps.slice(0, 3000))
    process.exit(appel.erreur ? 1 : 0)
}

if (lectures) {
    const { lecturesDe } = await import('./utils/lectures')
    const { sourcesDonneesActives } = await import('./utils/donnees')

    for (const type of await sourcesDonneesActives()) {
        const cat = await lecturesDe(type)
        console.log(`\n═══ ${type} ═══`)
        if (cat.erreur) { console.log(`  ⚠️  ${cat.erreur}`); continue }

        if (cat.vocabulaires.length) {
            console.log(`\n  VOCABULAIRES (${cat.vocabulaires.length})`)
            for (const v of cat.vocabulaires) {
                console.log(`    ${v.cle} · champ \`${v.champ}\`${v.applicable ? '' : ' — NON applicable'}`)
                /**
                 * `signifie` EST LE PÉRIMÈTRE, et je ne l'affichais pas.
                 *
                 * Un outil de lecture qui n'affiche que ce qui tient sur une ligne rend la
                 * partie qu'on pouvait deviner.
                 */
                for (const x of v.valeurs ?? []) {
                    if (typeof x === 'string') console.log(`      ${x}`)
                    else console.log(`      ${x?.valeur}${x?.signifie ? ` — ${x.signifie}` : ''}`)
                }
                // `discriminer` dit à quelle condition l'homonyme se distingue : sans lui,
                // un contrôle de fraîcheur éteint ressemble à un contrôle absent.
                if (v.discriminer) console.log(`      distinguer : ${v.discriminer}`)
            }
        }

        if (cat.partitions.length) {
            console.log(`\n  PARTITIONS (${cat.partitions.length})`)
            for (const p of cat.partitions) {
                console.log(`    ${p.route} → \`${p.chemin}\`${p.sousPartition ? ` × \`${p.sousPartition}\`` : ''}`)
                console.log(`      vocabulaire ${p.vocabulaire}${p.population ? ` · population ${p.population}` : ' · SANS population'}`)
                console.log(`      clés : ${p.cles.join(', ')}${p.nul ? ` · nul : ${p.nul}` : ''}`)
                if (p.note) console.log(`      ${p.note}`)
            }
        }

        if (cat.champsCalcules.length) {
            console.log(`\n  CHAMPS CALCULÉS (${cat.champsCalcules.length})`)
            for (const c of cat.champsCalcules) console.log(`    ${c.champs.join(', ')}${c.piege ? ` — ${c.piege}` : ''}`)
        }

        console.log(`\n  lectures : ${cat.lectures.length} · garantie : ${cat.garantie ? JSON.stringify(cat.garantie) : 'non déclarée'}`)
    }
    process.exit(0)
}

if (essaisDonnees) {
    const { QUESTIONS, champPresent } = await import('./utils/questions')
    const { executer } = await import('./utils/donnees')
    let echecs = 0, indecidables = 0, sautees = 0

    for (const q of QUESTIONS) {
        if (!q.attendChamps?.length) continue

        /**
         * UNE OMISSION DÉLIBÉRÉE ET UN OUBLI SE RESSEMBLENT PARFAITEMENT — leçon du
         * Catalogue, dont l'audit a laissé la même route de côté deux fois de suite.
         *
         * Ce saut disait « paramètre obligatoire sans valeur d'essai ». Il couvrait DEUX
         * situations que rien ne distinguait :
         */
        const essai = { ...(q.essai ?? {}) }
        for (const x of q.parametres) {
            if (x.obligatoire && !essai[x.cle] && x.valeurs?.length) essai[x.cle] = x.valeurs[0]!
        }
        const force = q.parametres.filter(x => x.obligatoire && !essai[x.cle])
        if (force.length) {
            console.log(`⏭️  ${q.cle} — ${force.map(x => `\`${x.cle}\``).join(', ')} désigne un objet réel `
                + `(aucune valeur fermée à prendre), portée seule`)
            sautees++
            continue
        }

        const appel = await executer(q.cle, essai)
        if (!appel) { console.log(`❌ ${q.cle} — question inconnue d'executer()`); echecs++; continue }
        if (appel.erreur) {
            if (/n'est pas configurée/.test(appel.erreur)) {
                console.log(`⏭️  ${q.cle} — source non configurée`)
                sautees++
            }
            else { console.log(`❌ ${q.cle} — ${appel.erreur.slice(0, 160)}`); echecs++ }
            continue
        }

        /**
         * UN CHAMP ATTENDU DISAIT QU'IL EXISTE, JAMAIS DE QUEL TYPE — et c'est par là qu'une
         * date a été inventée.
         *
         * Nos quatre champs fantômes précédents étaient ABSENTS — l'exigence mourait en
         * silence. Celui-ci est présent et c'est son TYPE qui était supposé : le contrôle
         * passait au vert, et l'exigence produisait une valeur au lieu de se taire. Un champ
         * dont on suppose le type est plus dangereux qu'un champ absent.
         */
        const absents: string[] = []
        const flous: string[] = []
        const typesFaux: string[] = []
        for (const declare of q.attendChamps) {
            const [chemin, type] = declare.split(':') as [string, string | undefined]
            const v = champPresent(appel.corps, chemin)
            if (v === 'absent') { absents.push(chemin); continue }
            if (v === 'indecidable') { flous.push(chemin); continue }
            if (!type) continue
            const vu = valeurAu(appel.corps, chemin)
            const reel = Array.isArray(vu) ? 'array' : vu === null ? 'null' : typeof vu
            // `null` porte un sens dans ces contrats (hors portée, non évalué) : il ne
            // contredit aucun type déclaré.
            if (reel !== 'null' && reel !== type) typesFaux.push(`${chemin} est ${reel}, déclaré ${type}`)
        }
        if (typesFaux.length) {
            echecs++
            console.log(`❌ ${q.cle} — TYPE inattendu : ${typesFaux.join(' · ')}`)
            console.log(`   Une exigence de rédaction qui suppose le type d'un champ présent ne meurt pas en`)
            console.log(`   silence : elle fabrique une valeur. C'est ainsi qu'une date inexistante a été inventée.`)
            continue
        }

        if (absents.length) {
            echecs++
            console.log(`❌ ${q.cle} — champs DISPARUS : ${absents.join(', ')}`)
            // Un rouge COMPRIS dit sa cause établie ; un rouge nouveau dit quoi craindre.
            if (q.essaiNote) console.log(`   [cause connue] ${q.essaiNote}`)
            else console.log(`   La forme de la source a changé : les post-conditions qui lisent ces champs`
                + ` ne se déclenchent plus, sans erreur nulle part. C'est précisément ce que ce mode surveille.`)
        }
        else {
            if (flous.length) indecidables++
            /**
             * UNE LISTE VIDE À L'INTÉRIEUR N'EST PAS UN CORPS VIDE.
             *
             * La nuance décide de ce qu'il faut faire. `veilles`, indécidable sur
             * `resultats.status`, attend simplement qu'une veille existe : rien à corriger.
             * Ici, notre déclaration n'a JAMAIS été confrontée à une charge réelle, et si
             * la source rend un objet une fois remplie, nous ne le saurons qu'alors.
             */
            const corpsVide = Array.isArray(appel.corps) && !appel.corps.length
            console.log(`✅ ${q.cle}${flous.length ? ` (indécidable sur liste vide : ${flous.join(', ')})` : ''}`)
            if (flous.length && corpsVide) {
                console.log(`   ⚠️  le CORPS lui-même est une liste vide — la source rend \`[]\`, pas l'objet déclaré.`)
                console.log(`   La forme « ${q.attendChamps.join(', ')} » n'a jamais été confrontée à une charge réelle.`)
            }
        }
    }

    /**
     * LE PONT, VÉRIFIÉ DE BOUT EN BOUT — déclaration lue, fiche trouvée, sections rendues.
     *
     * Le pont a été inerte pendant un déploiement entier sans qu'aucun harnais ne le voie :
     * six fiches déclaraient leur type, zéro était lue, et seul --montrer posé sur un P1
     * réel l'a fait voir. Ce contrôle appelle la vraie chaîne — extraction du type sur un
     * corps synthétique, requête sur les déclarations en base, sections de conduite — et
     * échoue en nommant l'étage cassé.
     */
    {
        const { fichesDeConduite, extraireTypesIncidents } = await import('./utils/assistant')
        const types = extraireTypesIncidents({ resultats: [{ type: 'malware' }] })
        const conduite = types.length ? await fichesDeConduite(types, [], 2) : []
        const refs = [...new Set(conduite.map(c => c.reference))]
        if (!types.length) {
            console.log('❌ pont — extraireTypesIncidents ne reconnaît plus « malware »')
            echecs++
        }
        else if (!conduite.length) {
            console.log('❌ pont — aucune fiche ne porte `types_incident` en base pour « malware ».')
            console.log("   Soit le corpus ne déclare plus le pont, soit la déclaration n'est pas LUE :")
            console.log("   après un changement de ce que l'en-tête extrait, seule une RÉINDEXATION")
            console.log("   (--reindexer) réécrit les documents inchangés — --forcer les saute.")
            echecs++
        }
        else {
            console.log(`✅ pont — malware → ${refs.join(', ')} (${conduite.length} sections de conduite)`)
        }
    }

    /**
     * LA SECONDE VOIE DU PONT — celle qui n'a jamais servi.
     *
     * Conséquence : une réponse sur les certificats, les listes blanches ou la conformité
     * ne propose jamais la conduite à tenir, alors que le mécanisme existe, est testé, et
     * attend une ligne d'en-tête.
     */
    {
        const { fichesDeConduite } = await import('./utils/assistant')
        const DOMAINES = ['certificats', 'listes-blanches', 'rgpd', 'conformite', 'parc', 'edr', 'acces', 'risques', 'connecteurs']
        const couverts: string[] = []
        for (const d of DOMAINES) {
            const c = await fichesDeConduite([], [d], 2)
            if (c.length) couverts.push(`${d} → ${[...new Set(c.map(x => x.reference))].join(', ')}`)
        }
        if (!couverts.length) {
            console.log(`\n⚠️  pont par DOMAINE — aucune fiche ne déclare \`domaines_catalogue\` (0 sur ${DOMAINES.length} domaines).`)
            console.log('   La moitié « données → procédure » qui part du domaine ne rend rien : une réponse sur les')
            console.log("   certificats ou la conformité n'attache aucune conduite. Le mécanisme existe et attend une")
            console.log("   ligne d'en-tête côté corpus. Non compté dans les échecs — le manque n'est pas dans le code.")
        }
        else {
            console.log(`\n✅ pont par domaine — ${couverts.length}/${DOMAINES.length} : ${couverts.join(' · ')}`)
        }
    }

    /**
     * LE CONTRAT DES UNITÉS, VÉRIFIÉ SUR LE FIL PLUTÔT QUE CRU SUR PAROLE.
     *
     * `combien` a porté trois sens sans que rien ne les distingue : des enregistrements sur
     * `parc`, des jours sur `connecteurs`, et — le seul qui ressemble à un décompte
     * plausible — un « oui » valant 1 sur un connecteur jamais lancé. Le Catalogue a rendu
     * `unite` obligatoire chez lui, et son compilateur tient la promesse à la source.
     */
    {
        const CONNUES = ['fiches', 'jours', 'presence']
        const a = await executer('lacunes_catalogue', {})
        const lignes: any[] = (a?.corps as any)?.resultats ?? (a?.corps as any)?.lacunes ?? []
        if (a?.erreur) console.log(`\n⚠️  unités des lacunes — non vérifiables (${a.erreur}).`)
        else if (!lignes.length) console.log('\n✅ unités des lacunes — aucune lacune déclarée.')
        else {
            const muettes = lignes.filter(l => !CONNUES.includes(l?.unite))
            // « 34 jours sur 8800 » n'a pas de référent. Leur contrôle l'interdit ; le
            // nôtre regarde ce qui arrive réellement, pas ce qui est promis.
            const absurdes = lignes.filter(l => l?.unite !== 'fiches' && l?.sur !== null && l?.sur !== undefined)
            /**
             * LE MIROIR, ET C'EST LUI QUI DÉTECTE UNE UNITÉ PAR DÉFAUT.
             *
             * Premier relevé après leur livraison : douze lacunes, toutes `fiches`. Ce peut
             * être exact — ou le symptôme d'un champ rendu obligatoire et rempli d'une même
             * valeur pour faire compiler. Vérifier que l'unité est CONNUE ne distingue pas
             * les deux ; vérifier qu'elle est COHÉRENTE le fait : une lacune en fiches sans
             * dénominateur n'est pas une lacune en fiches.
             */
            const sansDenominateur = lignes.filter(l => l?.unite === 'fiches' && !(Number.isFinite(l?.sur) && l.sur > 0))
            if (!muettes.length && !absurdes.length && !sansDenominateur.length) {
                console.log(`\n✅ unités des lacunes — ${lignes.length} lacune(s), toutes déclarées `
                    + `(${[...new Set(lignes.map(l => l.unite))].join(', ')}).`)
            }
            if (muettes.length) {
                console.log(`\n⚠️  unités des lacunes — ${muettes.length} sur ${lignes.length} sans unité connue `
                    + `(${[...new Set(muettes.map(l => String(l?.unite)))].join(', ')}).`)
                console.log('   Ces lacunes s\'affichent SANS leur mesure : « information incomplète sur X » sans dire')
                console.log('   combien. La mise en garde reste vraie, elle devient imprécise. Non compté.')
            }
            if (absurdes.length) {
                console.log(`\n⚠️  unités des lacunes — ${absurdes.length} lacune(s) portent un dénominateur `
                    + `sur une unité qui n'en admet pas : ${absurdes.map(l => `${l.domaine} (${l.combien} ${l.unite} sur ${l.sur})`).join(', ')}.`)
                console.log('   Le dénominateur est ignoré à l\'affichage. À signaler au Catalogue. Non compté.')
            }
        }
    }

    /**
     * LES PARTITIONS DÉCLARÉES, VÉRIFIÉES SUR LE FIL.
     *
     * Le Catalogue a fermé chez lui la classe « n valeurs déclarées, n−k compteurs écrits » :
     * ses partitions dérivent de l'énumération, et un contrôle vérifie qu'un alias couvre le
     * vocabulaire exactement une fois. Cette garantie s'arrête à son dépôt. Ce qui arrive
     * sur le fil dépend de la version déployée, et c'est la seule moitié qui nous revienne —
     * ils l'ont dit eux-mêmes, elle leur échappe entièrement.
     */
    const rapprochables: { p: any, valeurs: Record<string, number> }[] = []
    const { partitionsDiscordantes } = await import('./utils/rapprochement')
    {
        const { lecturesDe, partitionManquante } = await import('./utils/lectures')
        const { valeursDePartition } = await import('./utils/rapprochement')
        const cat = await lecturesDe('catalogue')

        if (cat.erreur) console.log(`\n⚠️  partitions — /api/lectures non lu (${cat.erreur}).`)
        else if (!cat.partitions.length) {
            console.log('\n⚠️  partitions — aucune déclarée. La version déployée du Catalogue est antérieure')
            console.log("   au bloc `partitions` : ce n'est PAS une régression, c'est un déploiement en retard.")
        }
        else {
            // Une partition par route ; on n'appelle chaque route qu'une fois.
            const parRoute = new Map<string, typeof cat.partitions>()
            for (const p of cat.partitions) parRoute.set(p.route, [...(parRoute.get(p.route) ?? []), p])

            let verifiees = 0, muettes = 0
            const muettesRoutes = new Set<string>()
            const soucis: string[] = []
            const releves = rapprochables
            for (const [route, liste] of parRoute) {
                const q = QUESTIONS.find(x => x.source === 'catalogue' && x.chemin === route)
                // UNE ROUTE DÉCLARÉE QU'AUCUNE QUESTION N'INTERROGE EST UNE CAPACITÉ, PAS UN
                // DÉFAUT — mais un nombre ne se transforme pas en travail. « 13 sur une route
                // qu'aucune question n'interroge » se lit et s'oublie ; la liste des routes,
                // elle, se traite.
                if (!q) { muettes += liste.length; muettesRoutes.add(route); continue }
                const a = await executer(q.cle, q.essai ?? {})
                if (a?.erreur || !a?.corps) { muettes += liste.length; continue }
                for (const p of liste) {
                    const r = partitionManquante(a.corps, p)
                    if (!r) {
                        verifiees++
                        const v = valeursDePartition(a.corps, p)
                        if (v) releves.push({ p, valeurs: v })
                        continue
                    }
                    if (r.etat === 'nul') { verifiees++; continue }  // portée de la clé, pas un défaut
                    if (r.etat === 'incomplet') {
                        soucis.push(`${route} → \`${p.chemin}\` sans compteur pour ${r.manquantes.join(', ')} (vocabulaire \`${p.vocabulaire}\`).`)
                        continue
                    }
                    /**
                     * CHERCHER LE BLOC AILLEURS AVANT DE LE DÉCLARER PERDU.
                     *
                     * Premier cas réel : `resume.parEolStatut` déclaré absent, alors que le
                     * bloc existait — sous `comptes`. La déclaration se trompait de chemin,
                     * pas la route. « Introuvable » et « ailleurs » appellent deux correctifs
                     * opposés chez le fournisseur, et un contrôle qui ne les distingue pas
                     * envoie chercher une régression là où il n'y a qu'une faute de frappe.
                     */
                    const feuille = p.chemin.split('.').at(-1)!
                    const ailleurs: string[] = []
                    const chercher = (n: any, ou: string, prof: number) => {
                        if (prof > 4 || !n || typeof n !== 'object' || Array.isArray(n)) return
                        for (const [k, v] of Object.entries(n)) {
                            if (k === feuille) ailleurs.push(ou ? `${ou}.${k}` : k)
                            chercher(v, ou ? `${ou}.${k}` : k, prof + 1)
                        }
                    }
                    chercher(a.corps, '', 0)
                    soucis.push(ailleurs.length
                        ? `${route} → \`${p.chemin}\` déclaré, mais le bloc est à \`${ailleurs.join('` ou `')}\`. `
                          + `Le CHEMIN déclaré est faux, la route est bonne.`
                        : `${route} → \`${p.chemin}\` DÉCLARÉ et INTROUVABLE : le chemin s'arrête à \`${r.ou}\`, `
                          + `et \`${feuille}\` n'est nulle part dans la réponse.`)
                }
            }

            if (!soucis.length) {
                console.log(`\n✅ partitions — ${verifiees}/${cat.partitions.length} déclarée(s) tenues sur le fil`
                    + `${muettes ? ` · ${muettes} sur ${muettesRoutes.size} route(s) qu'aucune question n'interroge` : ''}.`)
                if (muettesRoutes.size) {
                    console.log(`   Décomptes publiés que nous n'exposons pas : ${[...muettesRoutes].join(', ')}.`)
                    console.log('   Ce sont des questions auxquelles la source sait répondre et que personne ne pose.')
                }
            }
            else {
                for (const x of soucis) console.log(`\n⚠️  partition — ${x}`)
                // PLUSIEURS PARTITIONS ABSENTES SOUS UN MÊME PARENT ACCUSENT LE PARENT.
                // Le dire ici évite d'envoyer au fournisseur un rapport qui vise deux blocs
                // quand c'est leur contenant qui manque — ou un paramètre qui le conditionne.
                const parents = new Set(soucis.map(x => x.match(/s'arrête à `([^`]+)`/)?.[1]).filter(Boolean))
                if (parents.size === 1 && soucis.length > 1) {
                    console.log(`   Les ${soucis.length} manques partent du MÊME point : c'est \`${[...parents][0]}\` qui est en cause,`)
                    console.log('   pas ses blocs. Vérifier avec --montrer avant de signaler quoi que ce soit.')
                }
                console.log("   Une catégorie sans compteur ne se découvre qu'en sommant les lignes — c'est-à-dire en")
                console.log('   faisant ce que le contrat interdit. Non compté.')
            }
        }
    }

    /**
     * LE RAPPROCHEMENT, RENDU POSSIBLE PAR `population` — et pas avant.
     *
     * NON COMPTÉ, comme les autres contrôles portant sur un fournisseur.
     */
    if (rapprochables.length > 1) {
        const discordances = partitionsDiscordantes(rapprochables)
        if (!discordances.length) {
            const pops = [...new Set(rapprochables.map(r => r.p.population))]
            console.log(`\n✅ rapprochement — ${rapprochables.length} partition(s) comparables sur `
                + `${pops.length} population(s) : ${pops.join(', ')} · aucun écart.`)
        }
        else {
            for (const d of discordances) {
                console.log(`\n⚠️  rapprochement — \`${d.vocabulaire}\` sur la population \`${d.population}\` : `
                    + `« ${d.valeur} » vaut ${d.ecarts.map(e => `${e.n} en \`${e.chemin}\``).join(' et ')}.`)
            }
            console.log('   Même population déclarée, décomptes différents : régression chez la source. Non compté.')
        }
    }

    const total = QUESTIONS.filter(q => q.attendChamps?.length).length

    /**
     * CE QUE CE HARNAIS NE COUVRE PAS, ET QUI NE SE VOYAIT PAS.
     *
     * « 27/27 formes tenues » se lit comme « tout est vérifié », alors que seize questions
     * n'avaient aucun champ attendu et n'étaient donc même pas comptées. Leurs formes
     * venaient du contrat, jamais de la charge utile — c'est exactement l'état dans lequel
     * une exigence sur `titre` a survécu à un champ qui n'existe pas.
     */
    const jamaisEprouvees = QUESTIONS.filter(q => !q.attendChamps?.length).map(q => q.cle)
    console.log(`\n${total - echecs}/${total} formes tenues · ${sautees} sautée(s) · ${indecidables} avec champs indécidables · pont vérifié.`)
    if (jamaisEprouvees.length) {
        console.log(`\n${jamaisEprouvees.length} question(s) SANS champ attendu — leur forme n'a jamais été confrontée à la charge utile :`)
        console.log(`  ${jamaisEprouvees.join(', ')}`)
        console.log('  `--formes` les interroge et montre ce qu\'elles rendent, pour les déclarer sur une mesure.')
    }
    process.exit(echecs ? 1 : 0)
}

if (essaisRecherche) {
    const { CAS } = await import('./essais-recherche-cas')
    const { chercher } = await import('./utils/recherche')
    let echecs = 0

    for (const cas of CAS) {
        const r = await chercher(cas.question, calculerVecteur)
        const refs = [...new Set(r.passages.map(p => p.reference).filter(Boolean))] as string[]

        let ok: boolean
        let detail: string
        if (cas.rienAttendu) {
            ok = r.sousLePlancher
            detail = ok ? 'sous le plancher, comme attendu'
                : `AURAIT DÛ rester sous le plancher — rend ${refs.join(', ') || '(sans référence)'} à ${r.meilleurScore.toFixed(2)}`
        }
        else if (!cas.attend.length) {
            ok = !r.sousLePlancher
            detail = ok ? `rend ${refs.slice(0, 3).join(', ') || '(référence externe)'}` : 'RIEN TROUVÉ'
        }
        else {
            /**
             * UN CONTRÔLE DOIT MONTRER CE QU'IL AFFIRME.
             *
             * La ligne disait « OUT-05 présent (INC-04, ANX-J, 1504, 5869) » — un vert dont
             * la preuve affichée ne contenait pas ce qu'il déclarait. L'assertion portait
             * sur toutes les références, l'affichage n'en montrait que quatre, et la
             * référence attendue arrivait plus loin.
             */
            const trouve = cas.attend.find(a => refs.includes(a))
            ok = trouve !== undefined
            const rang = trouve ? refs.indexOf(trouve) + 1 : 0
            const tete = refs.slice(0, 4).join(', ')
            detail = ok
                ? `${trouve} au rang ${rang}/${refs.length}` + (rang > 4 ? ` — tête : ${tete}` : ` (${tete})`)
                : `attendait ${cas.attend.join(' ou ')}, reçu : ${refs.slice(0, 5).join(', ') || '(rien)'}`
        }

        // La section désignée, en plus du document. Un cas peut exiger les deux.
        // Le titre peut être un `###` : la découpe le garde DANS le passage de son `##`
        // parent, dont le titreSection ne le porte pas. On cherche donc aussi dans les
        // lignes de titre du texte — même sémantique que `porteAncre` côté renvois.
        if (ok && cas.attendSection) {
            const voulu = cas.attendSection.section.toLowerCase()
            const la = r.passages.some(x => x.reference === cas.attendSection!.ref
                && ((x.titreSection ?? '').toLowerCase().includes(voulu)
                    || [...x.texte.matchAll(/^#{2,3}\s+(.+)$/gm)].some(m => m[1]!.toLowerCase().includes(voulu))))
            if (!la) {
                ok = false
                const sections = r.passages.filter(x => x.reference === cas.attendSection!.ref)
                    .map(x => x.titreSection ?? '—')
                detail += ` — MAIS la section « ${cas.attendSection.section} » de ${cas.attendSection.ref} manque`
                    + (sections.length ? ` (présentes : ${sections.join(' · ')})` : ` (${cas.attendSection.ref} absent)`)
            }
        }

        console.log(`${ok ? '✅' : '❌'} ${cas.question}\n   ${detail}`)
        if (!ok) {
            console.log(`   motif du cas : ${cas.motif}`)
            // LE DÉTAIL DES PASSAGES, PAS SEULEMENT LES RÉFÉRENCES. Deux échecs de suite ont
            // rendu la même liste de documents sans qu'on puisse dire si la section porteuse
            // du renvoi était présente — c'est-à-dire si le défaut était dans le classement
            // des cibles ou dans la rétention. Un harnais qui ne montre pas de quoi conclure
            // fait reposer la conclusion sur une hypothèse, ce qui est ce qu'il devait éviter.
            for (const x of r.passages) {
                console.log(`     · ${x.reference ?? x.titre} — ${x.titreSection ?? '—'}`
                    + `${x.ramene ? ` [${x.via}]` : ` (${x.score.toFixed(2)})`}`)
            }
            echecs++
        }
    }

    console.log(`\n${CAS.length - echecs}/${CAS.length} cas au vert.`)
    process.exit(echecs ? 1 : 0)
}

if (vecteursManquants) {
    const aFaire = await db.select({ id: indexSchema.passage.id, texte: indexSchema.passage.texte })
        .from(indexSchema.passage)
        .where(sql`${indexSchema.passage.vecteur} IS NULL`)

    console.log(`${aFaire.length} passage(s) sans vecteur.`)
    let repares = 0
    for (const p of aFaire) {
        const v = await calculerVecteur(p.texte, 'passage')
        if (!v) continue
        await db.update(indexSchema.passage).set({ vecteur: v })
            .where(eq(indexSchema.passage.id, p.id))
        repares++
    }
    console.log(`${repares} réparé(s), ${aFaire.length - repares} toujours en échec.`)

    const reste = bilanVecteurs()
    if (reste) console.warn(reste)
    process.exit(0)
}

if (reindexer) console.log('RÉINDEXATION COMPLÈTE : tous les documents sont relus, empreintes ignorées.')
for (const s of sources) await synchroniser(s, forcer, reindexer)

// La purge du journal de consultation voyage avec la synchronisation : c'est le seul
// processus qui tourne régulièrement, et une durée de conservation qu'aucune tâche
// n'applique est une intention, pas un fait.
// Ce que la vectorisation a pu perdre. Dit une fois, à la fin, plutôt qu'à chaque passage.
const troncature = bilanTroncature()
if (troncature) console.warn(troncature)

const sansVecteur = bilanVecteurs()
if (sansVecteur) console.warn(sansVecteur)

const purgees = await purger()
if (purgees) console.log(`journal de consultation : ${purgees} ligne(s) purgée(s)`)

process.exit(process.exitCode ?? 0)
