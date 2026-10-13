// RECHERCHE — la seule partie de ce projet sans précédent dans la maison.
//
// Slowpoke a de l'IA et une copie du corpus, mais pas de recherche : il choisit la fiche
// applicable de façon déterministe à partir du type d'incident, puis passe le document
// entier au modèle. Un incident, une procédure, aucun choix à faire. Une question
// d'assistant n'arrive pas avec un type d'incident — d'où ce module.

import { db } from "@assistants/database";
import { sql } from "drizzle-orm";
import { lire, lireNombre, lireBooleen, lireListe } from "./reglages";
import { ancre } from "./decoupe";

export type PassageTrouve = {
    passageId: string
    documentId: string
    /** Rang de la section dans son document. Sert à relire une fiche dans l'ordre. */
    ordre: number
    /**
     * Vrai si la section a été RAMENÉE par cohésion documentaire, non trouvée par la
     * recherche. Marqué plutôt que déduit d'un score nul : depuis que le titre du document
     * compte, un passage peut être trouvé par son seul titre et porter un score faible mais
     * réel. Confondre les deux ferait passer une trouvaille pour un complément.
     */
    ramene?: boolean
    /** Comment la section est arrivée sans être trouvée : `cohesion` ou `renvoi`. */
    via?: 'cohesion' | 'renvoi'
    texte: string
    titreSection: string | null
    ancre: string | null
    reference: string | null
    titre: string
    statut: string | null
    /** `fiche-incident`, `annexe`, `fiche-outil`, `quotidien`, `validation` — ou null hors corpus. */
    typeDoc: string | null
    /** Chemin du document dans sa source. Sert à résoudre les renvois relatifs. */
    chemin: string
    version: string | null
    dateRevision: string | null
    url: string | null
    extraction: string
    sourceNom: string
    autorite: string | null
    categorie: string
    mention: string | null
    score: number
    scoreLexical: number
    scoreSemantique: number
}

type Ligne = Omit<PassageTrouve, 'score' | 'scoreLexical' | 'scoreSemantique'> & { s: number, densite?: number }

/**
 * Recherche lexicale, configuration `french`, pondérée par la rareté des termes.
 *
 * IL A FALLU TROIS ESSAIS SUR LE CORPUS RÉEL POUR ARRIVER ICI. Les deux premiers sont
 * instructifs, et c'est pourquoi ils sont écrits :
 */
/**
 * TROIS ZONES, PONDÉRÉES PAR POSTGRESQL.
 *
 * Le `tsvector` d'un passage portait `titre_section || texte`, et rien d'autre. Le titre du
 * DOCUMENT n'y était pas : une fiche « INC-04 — Malware sur un poste » dont une section dit
 * « isoler la machine du réseau » avait une couverture nulle sur « malware ».
 */
async function lexicale(question: string, statutsExclus: string[], motsVides: string[], partCouverture: number, limite: number): Promise<Ligne[]> {
    const r = await db.execute(sql`
        WITH tous AS (
            SELECT DISTINCT unnest(tsvector_to_array(to_tsvector('french', ${question}))) AS mot
        ),
        vides AS (
            SELECT unnest(tsvector_to_array(to_tsvector('french', ${motsVides.join(' ')}))) AS mot
        ),
        mots AS (
            SELECT mot FROM tous WHERE mot NOT IN (SELECT mot FROM vides)
        ),
        total AS (SELECT GREATEST(count(*), 1)::float AS n FROM passage),
        pond AS (
            SELECT m.mot,
                   ln(1 + total.n / GREATEST(
                       (SELECT count(*) FROM passage p2
                         WHERE p2.tsv @@ to_tsquery('simple', quote_literal(m.mot))), 1)::float) AS w
            FROM mots m, total
        ),
        somme AS (SELECT GREATEST(sum(w), 1e-9) AS t FROM pond),
        req AS (SELECT to_tsquery('simple', string_agg(quote_literal(mot), ' | ')) AS q FROM mots),
        brut AS (
            SELECT p.id AS "passageId", d.id AS "documentId", p.ordre, p.texte,
                   p.titre_section AS "titreSection", p.ancre, d.reference, d.titre,
                   d.statut, d.type_doc AS "typeDoc", d.chemin, d.version, d.date_revision AS "dateRevision",
                   d.url, d.extraction, d.mention, src.nom AS "sourceNom", src.autorite, src.categorie,
                   -- Le titre du document et les mots-cles declares SONT dans le tsv du
                   -- passage, recopies a la synchronisation. La couverture n'a donc
                   -- plus a aller les chercher, et ts_rank_cd applique nativement leur
                   -- ponderation : A pour les mots-cles, B pour les titres, C pour le corps.
                   (SELECT COALESCE(sum(pond.w), 0) FROM pond
                     WHERE pond.mot = ANY(tsvector_to_array(p.tsv)))
                   / (SELECT t FROM somme) AS couverture,
                   ts_rank_cd(p.tsv, req.q, 32) AS densite
            FROM passage p
            JOIN document d   ON d.id = p.document_id
            JOIN source   src ON src.id = d.source_id
            CROSS JOIN req
            WHERE src.actif
              AND req.q IS NOT NULL
              AND (d.statut IS NULL OR NOT (d.statut = ANY(string_to_array(${statutsExclus.join(',')}, ','))))
              -- Une seule condition : le tsv du passage contient desormais le titre du
              -- document et ses mots-cles. L'elargissement du vivier qu'il fallait ajouter
              -- cote requete devient inutile, et l'index GIN redevient utilisable de bout
              -- en bout : il ne l'etait plus depuis qu'on recalculait le tsvector par ligne.
              AND p.tsv @@ req.q
        )
        SELECT brut.*, couverture AS s
        FROM brut
        ORDER BY couverture * ${partCouverture} + densite * ${1 - partCouverture} DESC
        LIMIT ${limite}
    `)
    return r.rows as unknown as Ligne[]
}

/** Recherche sémantique. Ne renvoie rien si aucun passage n'a de vecteur. */
async function semantique(vecteur: number[], statutsExclus: string[], limite: number): Promise<Ligne[]> {
    const litteral = `[${vecteur.join(',')}]`
    const r = await db.execute(sql`
        SELECT p.id AS "passageId", d.id AS "documentId", p.texte, p.titre_section AS "titreSection",
               p.ancre, d.reference, d.titre, d.statut, d.type_doc AS "typeDoc", d.chemin, d.version, d.date_revision AS "dateRevision",
               d.url, d.extraction, d.mention, s.nom AS "sourceNom", s.autorite, s.categorie,
               1 - (p.vecteur <=> ${litteral}::vector) AS s
        FROM passage p
        JOIN document d ON d.id = p.document_id
        JOIN source   s ON s.id = d.source_id
        WHERE s.actif
          AND p.vecteur IS NOT NULL
          AND (d.statut IS NULL OR NOT (d.statut = ANY(string_to_array(${statutsExclus.join(',')}, ','))))
        ORDER BY p.vecteur <=> ${litteral}::vector
        LIMIT ${limite}
    `)
    return r.rows as unknown as Ligne[]
}

/**
 * Répartit les places entre catégories de sources.
 *
 * Le classement seul est aveugle au tableau d'autorité. La documentation éditeur de
 * HarfangLab pèse 197 fichiers contre 53 fiches maison : sans plafond, elle occupe la
 * quasi-totalité des passages retenus sur presque toute question — non parce qu'elle
 * répond mieux, mais parce qu'elle est cinq fois plus nombreuse. L'assistant répondrait
 * alors avec le manuel du produit là où une procédure existe, ce que la règle 6 interdit.
 */
export function repartir(classes: PassageTrouve[], places: Map<string, number>, total: number): PassageTrouve[] {
    const retenus: PassageTrouve[] = []
    const pris = new Set<string>()

    for (const [categorie, plafond] of places) {
        let n = 0
        for (const p of classes) {
            if (retenus.length >= total || n >= plafond) break
            if (p.categorie !== categorie || pris.has(p.passageId)) continue
            retenus.push(p); pris.add(p.passageId); n++
        }
    }

    for (const p of classes) {
        if (retenus.length >= total) break
        if (pris.has(p.passageId) || places.has(p.categorie)) continue
        retenus.push(p); pris.add(p.passageId)
    }

    for (const p of classes) {
        if (retenus.length >= total) break
        if (pris.has(p.passageId) || places.get(p.categorie) === 0) continue
        retenus.push(p); pris.add(p.passageId)
    }

    // L'ordre de sortie suit le score, pas l'ordre de service : la répartition décide QUI
    // est retenu, elle n'a pas à décider ce que le modèle lit en premier.
    return retenus.sort((a, b) => classes.indexOf(a) - classes.indexOf(b))
}

/** `reference:2,equipe:2` → Map. Une entrée illisible est ignorée, pas fatale. */
export function lirePlaces(brut: string[]): Map<string, number> {
    const m = new Map<string, number>()
    for (const entree of brut) {
        const [cat, n] = entree.split(':').map(x => x.trim())
        const plafond = Number(n)
        if (cat && Number.isFinite(plafond) && plafond >= 0) m.set(cat, plafond)
    }
    return m
}

export type Resultat = {
    passages: PassageTrouve[]
    /** Vrai quand rien n'atteint le plancher : la réponse sera « ce n'est pas écrit ». */
    sousLePlancher: boolean
    meilleurScore: number
    mode: 'lexical' | 'hybride'
    /** Renseigné UNIQUEMENT sous le plancher : de quoi comprendre pourquoi. */
    diagnostic?: { termes: TermeCherche[], frolements: Frolement[], plancher: number }
}

/**
 * CE QUE LA RECHERCHE A CHERCHÉ. Rendu avec « ce n'est pas écrit », jamais autrement.
 *
 * « Ce n'est pas écrit » était un cul-de-sac : la question partait au journal des lacunes et
 * personne ne pouvait dire pourquoi. Or « pourtant c'est dans la doc » a deux causes très
 * différentes, et elles n'appellent pas la même suite :
 */
export type TermeCherche = { mot: string, df: number, poids: number }

export async function termesDe(question: string, motsVides: string[]): Promise<TermeCherche[]> {
    const r = await db.execute(sql`
        WITH tous AS (
            SELECT DISTINCT unnest(tsvector_to_array(to_tsvector('french', ${question}))) AS mot
        ),
        vides AS (
            SELECT unnest(tsvector_to_array(to_tsvector('french', ${motsVides.join(' ')}))) AS mot
        ),
        mots AS (SELECT mot FROM tous WHERE mot NOT IN (SELECT mot FROM vides)),
        total AS (SELECT GREATEST(count(*), 1)::float AS n FROM passage)
        SELECT m.mot,
               (SELECT count(*) FROM passage p2
                 WHERE p2.tsv @@ to_tsquery('simple', quote_literal(m.mot)))::int AS df,
               ln(1 + total.n / GREATEST(
                   (SELECT count(*) FROM passage p2
                     WHERE p2.tsv @@ to_tsquery('simple', quote_literal(m.mot))), 1)::float) AS poids
        FROM mots m, total
        ORDER BY poids DESC
    `)
    return (r.rows as unknown as TermeCherche[]).map(t => ({
        mot: t.mot, df: Number(t.df), poids: Number(t.poids),
    }))
}

/**
 * Ce qui est passé JUSTE À CÔTÉ du plancher.
 *
 * Un passage à 0,18 quand le plancher est à 0,20 n'est pas « rien » : c'est très
 * probablement le bon document, trouvé par un seul de ses mots. L'afficher permet de voir
 * en un coup d'œil que le document est bien là, et que c'est le seuil ou le vocabulaire qui
 * a manqué — pas la documentation.
 */
export type Frolement = { titre: string, section: string | null, score: number, url: string | null }

/**
 * ON CHERCHE DES PASSAGES, ON RÉPOND AVEC UNE FICHE.
 *
 * Mesuré sur INC-04, à la question « qu'est-ce qu'il faut faire en cas de malware sur un
 * poste ». Les sections qui gagnent sont « 6. Éradication » et « 9. Analyse post-incident »,
 * à 0,462. « 3. Confinement » — isoler la machine, c'est-à-dire LA réponse — arrive
 * douzième, à 0,176.
 */
export async function completerFiche(
    retenus: PassageTrouve[], cohesion: number,
): Promise<PassageTrouve[]> {
    if (cohesion <= 0 || retenus.length < 2) return retenus

    /**
     * LA FICHE DOMINANTE EST CELLE QUI FOURNIT LE PLUS DE SECTIONS, PAS CELLE QUI ARRIVE EN
     * TÊTE.
     *
     * Prendre `retenus[0]` était faux, et le relevé sur le corpus l'a montré : à la question
     * sur le malware, « INC-GRILLE — 1. Niveaux » arrive premier avec UNE section, tandis
     * qu'INC-04 en fournit plusieurs. La cohésion ne se serait pas déclenchée, et c'est
     * pourtant INC-04 qui est la réponse.
     */
    const compte = new Map<string, { n: number, rang: number }>()
    for (const [i, x] of retenus.entries()) {
        const v = compte.get(x.documentId)
        if (v) v.n++
        else compte.set(x.documentId, { n: 1, rang: i })
    }
    const [dominant] = [...compte].sort((a, b) => b[1].n - a[1].n || a[1].rang - b[1].rang)
    if (!dominant) return retenus

    /**
     * QUAND PERSONNE N'ATTEINT DEUX PASSAGES, LE PREMIER FAIT FOI.
     *
     * Une question chargée d'identifiants favorise les EN-TÊTES : ces blocs « en un coup
     * d'œil » sont denses en références, en niveaux et en délais, donc ils apparient un
     * peu de tout. Les six passages retenus étaient six en-têtes de six documents
     * différents — aucune section de corps, aucun document à deux passages, et donc
     * aucune cohésion. Le § 3 Confinement d'INC-04 n'est jamais venu, ni avec lui ses
     * désignations vers la checklist et l'annexe J : la réponse a dit honnêtement que la
     * commande n'était pas dans les blocs.
     */
    if (dominant[1].n < 2 && dominant[1].rang !== 0) return retenus
    const tete = { documentId: dominant[0] }

    const dejaLa = new Set(retenus.map(p => p.passageId))
    const r = await db.execute(sql`
        SELECT p.id AS "passageId", d.id AS "documentId", p.ordre, p.texte,
               p.titre_section AS "titreSection", p.ancre, d.reference, d.titre,
               d.statut, d.type_doc AS "typeDoc", d.chemin, d.version, d.date_revision AS "dateRevision",
               d.url, d.extraction, d.mention, src.nom AS "sourceNom", src.autorite, src.categorie
        FROM passage p
        JOIN document d   ON d.id = p.document_id
        JOIN source   src ON src.id = d.source_id
        WHERE p.document_id = ${tete.documentId}
        ORDER BY p.ordre
    `)

    const ajouts = (r.rows as unknown as Omit<PassageTrouve, 'score' | 'scoreLexical' | 'scoreSemantique'>[])
        .filter(p => !dejaLa.has(p.passageId))
        .slice(0, cohesion)
        // Score nul assumé : ces sections n'ont pas été trouvées, elles ont été ramenées.
        // Leur donner un score inventé fausserait le plancher et le classement.
        .map(p => ({ ...p, score: 0, scoreLexical: 0, scoreSemantique: 0, ramene: true, via: 'cohesion' as const }))

    return ordonnerParFiche([...retenus, ...ajouts])
}

/**
 * Les renvois portés par un jeu de passages : document cible → ancres désignées.
 *
 * Quand le lien porte son ancre (`…#3-capturer-la-mémoire-vive`), la section désignée est
 * ramenée EN PREMIER, avant le remplissage par pertinence. L'ancre est normalisée comme les
 * nôtres à l'indexation — minuscules, accents retirés — pour que celle que GitLab affiche
 * corresponde à celle qu'on stocke.
 */
export function extraireRenvois(passages: PassageTrouve[]): Map<string, Set<string>> {
    const cibles = new Map<string, Set<string>>()
    for (const p of passages) {
        const dossier = p.chemin.includes('/') ? p.chemin.slice(0, p.chemin.lastIndexOf('/')) : ''
        for (const m of p.texte.matchAll(/\]\(([^)#\s]+\.md)(#[^)\s]*)?\)/g)) {
            // Résolution du chemin relatif, sans dépendre d'une bibliothèque.
            const bouts = (dossier ? dossier.split('/') : [])
            for (const seg of m[1]!.split('/')) {
                if (seg === '..') bouts.pop()
                else if (seg !== '.') bouts.push(seg)
            }
            const chemin = bouts.join('/')
            const jeu = cibles.get(chemin) ?? new Set<string>()
            if (m[2]) {
                let brut = m[2].slice(1)
                try { brut = decodeURIComponent(brut) } catch { /* fragment mal encodé : tel quel */ }
                const a = ancre(brut)
                if (a) jeu.add(a)
            }
            cibles.set(chemin, jeu)
        }
    }
    return cibles
}

/**
 * L'ASSISTANT SUIT LES RENVOIS, PARCE QUE LE CORPUS EST ÉCRIT POUR UN LECTEUR QUI LES SUIT.
 *
 * Ne pas suivre les renvois et exiger l'unicité des commandes sont deux décisions
 * incompatibles. On a choisi l'unicité ; ceci est sa contrepartie.
 */
/**
 * UNE ANCRE PEUT DÉSIGNER UN `###` — QUI N'A PAS D'ANCRE DANS L'INDEX.
 *
 * La découpe garde les `###` DANS le passage parent (choix mesuré : 88 mots par section,
 * un `###` isolé ne remonte jamais), et chaque passage porte l'ancre de son `##`. Mais les
 * auteurs du corpus lient légitimement des `###` — GitHub les ancre — et « Le signalement
 * sans suite » en est un : sa désignation ne correspondait à aucune ancre de passage, et
 * la section visée n'arrivait jamais, quel que soit le classement. La désignation se
 * résout donc aussi contre les titres `###` contenus dans le texte, avec la même fonction
 * d'ancrage que la découpe.
 */
export function porteAncre(l: { ancre: string | null, texte: string }, ancres: Set<string>): boolean {
    if (l.ancre !== null && ancres.has(l.ancre)) return true
    for (const m of l.texte.matchAll(/^###\s+(.+)$/gm)) {
        if (ancres.has(ancre(m[1]!.trim()))) return true
    }
    return false
}

export async function suivreRenvois(
    retenus: PassageTrouve[], question: string, plafondDocs: number, plafondSections = 3,
): Promise<PassageTrouve[]> {
    if (plafondDocs <= 0 || !retenus.length) return retenus

    /**
     * LA DÉDUPLICATION OPÈRE AU NIVEAU DE LA SECTION, PAS DU DOCUMENT.
     *
     * Un document partiellement présent peut donc être complété par renvoi ; seules ses
     * sections déjà là sont écartées. La concurrence sur les places reste bornée par
     * `plafondDocs`, et un document ENTIÈREMENT présent produit zéro section nouvelle, donc
     * ne consomme pas de place.
     */
    const dejaLa = new Set(retenus.map(p => p.passageId))
    const cibles = extraireRenvois(retenus)
    if (!cibles.size) return retenus

    /**
     * LES CIBLES SE CLASSENT AVANT DE SE SUIVRE.
     *
     * On interroge donc TOUTES les cibles — la requête est petite et indexée par chemin —
     * et on ne garde que les plus pertinentes contre la question. L'ordre de lecture d'un
     * document ne dit rien de l'utilité de ses renvois.
     */
    const candidats: {
        chemin: string, pertinence: number, complete: boolean, designe: boolean,
        lignes: PassageTrouve[], lignesDesignees: PassageTrouve[],
    }[] = []
    const typesPresents = new Set(retenus.map(p => p.typeDoc))
    const docsPresents = new Set(retenus.map(p => p.chemin))

    /**
     * TOUTES les cibles sont interrogées — le plafond ne s'applique qu'APRÈS le classement.
     *
     * Troisième version, et le même péché originel commis un étage plus haut. La liste des
     * cibles était plafonnée à huit, prises dans l'ordre de lecture : les dix sections
     * d'INC-04 fournissaient à elles seules la grille, la checklist et deux annexes, et le
     * plafond était consommé avant d'atteindre le lien OUT-05 porté par une section
     * ultérieure. On classait les candidats après les avoir tronqués avant — le classement
     * ne pouvait élire que ce que la troncature avait laissé passer.
     */
    for (const [chemin, ancres] of [...cibles.entries()].slice(0, 24)) {
        const ancresTexte = [...ancres].join(',')
        const r = await db.execute(sql`
            WITH tous AS (
                SELECT DISTINCT unnest(tsvector_to_array(to_tsvector('french', ${question}))) AS mot
            ),
            req AS (SELECT to_tsquery('simple', string_agg(quote_literal(mot), ' | ')) AS q FROM tous),
            cible AS (
                SELECT p.id AS "passageId", d.id AS "documentId", p.ordre, p.texte,
                       p.titre_section AS "titreSection", p.ancre, d.reference, d.titre,
                       d.statut, d.type_doc AS "typeDoc", d.chemin, d.version,
                       d.date_revision AS "dateRevision",
                       d.url, d.extraction, d.mention, src.nom AS "sourceNom", src.autorite, src.categorie,
                       ts_rank_cd(p.tsv, req.q, 32) AS pertinence
                FROM passage p
                JOIN document d ON d.id = p.document_id
                JOIN source src ON src.id = d.source_id
                CROSS JOIN req
                WHERE src.actif AND d.chemin = ${chemin}
                  AND (d.statut IS NULL OR d.statut <> 'obsolete')
            )
            SELECT * FROM cible
            -- La section DÉSIGNÉE par l'ancre du renvoi passe avant tout remplissage par
            -- pertinence : c'est elle que le rédacteur du renvoi visait.
            ORDER BY (ancre = ANY(string_to_array(${ancresTexte}, ','))) DESC,
                     (pertinence = 0), pertinence DESC, ordre
            LIMIT 24
        `)
        // La désignation se juge en JS (`porteAncre`, `###` compris) : on ramène donc
        // plus large que le plafond, et on recoupe après — un passage désigné mais pauvre
        // en pertinence ne doit pas être éliminé par la limite SQL avant d'être reconnu.
        const brutes = (r.rows as unknown as (Omit<PassageTrouve, 'score' | 'scoreLexical' | 'scoreSemantique'> & { pertinence: number })[])
            .filter(l => !dejaLa.has(l.passageId))
        if (!brutes.length) continue

        const designees = brutes.filter(l => porteAncre(l, ancres))
        const lignes = [...designees, ...brutes.filter(l => !designees.includes(l))].slice(0, plafondSections)

        const enPassage = (l: (typeof brutes)[number]): PassageTrouve => {
            const { pertinence: _, ...reste } = l
            return { ...reste, score: 0, scoreLexical: 0, scoreSemantique: 0, ramene: true, via: 'renvoi' as const }
        }
        candidats.push({
            chemin,
            pertinence: lignes.reduce((somme, l) => somme + Number(l.pertinence), 0),
            complete: !typesPresents.has(lignes[0]!.typeDoc),
            // Un renvoi qui désigne une section est plus intentionnel qu'un renvoi de
            // document : à étage égal, il passe devant.
            designe: designees.length > 0,
            lignes: lignes.map(enPassage),
            lignesDesignees: designees.slice(0, plafondSections).map(enPassage),
        })
    }

    /**
     * UN RENVOI QUI COMPLÈTE PASSE AVANT UN RENVOI QUI RÉPÈTE.
     *
     * Classer par pertinence contre la question était le mauvais signal, et le cas d'essai
     * l'a montré : la checklist malware gagnait toujours — elle dit « malware » partout —
     * quand OUT-05 ne le dit JAMAIS, par construction : ses questions déclarées sont
     * instrumentales, aucune ne prononce le mot incident. Le document que le mécanisme
     * existe pour atteindre était précisément celui que la pertinence ne pouvait pas élire.
     */
    /**
     * COMPLÉTER UN DOCUMENT DÉJÀ LÀ NE COÛTE PAS UNE PLACE DE DOCUMENT.
     *
     * Une désignation ANCRÉE vers un document déjà représenté est donc servie hors budget
     * — ses seules sections désignées, jamais du remplissage — et le concours ne porte que
     * sur les documents nouveaux.
     */
    const completions = candidats.filter(c => c.designe && docsPresents.has(c.chemin))
    const nouveaux = candidats.filter(c => !(c.designe && docsPresents.has(c.chemin)))

    const ajouts = [
        ...completions.flatMap(c => c.lignesDesignees),
        ...nouveaux
            .sort((x, y) => Number(y.complete) - Number(x.complete)
                || Number(y.designe) - Number(x.designe)
                || y.pertinence - x.pertinence)
            .slice(0, plafondDocs)
            .flatMap(c => c.lignes),
    ]

    if (!ajouts.length) return retenus

    /**
     * SECONDE PASSE — LES DÉSIGNATIONS ANCRÉES, ET RIEN D'AUTRE.
     *
     * « Un niveau, jamais de renvoi de renvoi » reste la règle pour les DOCUMENTS : c'est
     * là que l'explosion de graphe habite. Mais le cas mesuré la prenait en défaut d'une
     * façon précise : la commande sysdiagnose vit dans l'ANX-J §3, désigné par l'ancre du
     * renvoi d'OUT-05 §2 — qui était lui-même arrivé par renvoi. La chaîne fiche → outil →
     * section désignée est exactement l'empilement du corpus, et la couper au deuxième
     * maillon rendait la désignation inutile là où elle servait le plus.
     */
    for (const l of ajouts) dejaLa.add(l.passageId)
    const secondes: PassageTrouve[] = []
    for (const [chemin, ancres] of extraireRenvois(ajouts)) {
        if (!ancres.size || secondes.length >= 3) continue
        const r = await db.execute(sql`
            SELECT p.id AS "passageId", d.id AS "documentId", p.ordre, p.texte,
                   p.titre_section AS "titreSection", p.ancre, d.reference, d.titre,
                   d.statut, d.type_doc AS "typeDoc", d.chemin, d.version,
                   d.date_revision AS "dateRevision",
                   d.url, d.extraction, d.mention, src.nom AS "sourceNom", src.autorite, src.categorie
            FROM passage p
            JOIN document d ON d.id = p.document_id
            JOIN source src ON src.id = d.source_id
            WHERE src.actif AND d.chemin = ${chemin}
              AND (d.statut IS NULL OR d.statut <> 'obsolete')
            ORDER BY p.ordre
            LIMIT 40
        `)
        // Le filtre d'ancre se fait en JS, comme au premier niveau : une ancre peut
        // désigner un `###` que l'index ne porte que dans le texte du passage parent.
        const designees = (r.rows as unknown as Omit<PassageTrouve, 'score' | 'scoreLexical' | 'scoreSemantique'>[])
            .filter(l => porteAncre(l, ancres)).slice(0, 2)
        for (const ligne of designees) {
            if (dejaLa.has(ligne.passageId) || secondes.length >= 3) continue
            dejaLa.add(ligne.passageId)
            secondes.push({ ...ligne, score: 0, scoreLexical: 0, scoreSemantique: 0, ramene: true, via: 'renvoi' })
        }
    }

    return ordonnerParFiche([...retenus, ...ajouts, ...secondes])
}

/**
 * Regroupe par document et remet chaque fiche dans l'ordre de ses sections.
 *
 * Le classement par pertinence est le bon ordre pour CHOISIR, et le mauvais pour LIRE. Un
 * modèle qui reçoit « 9. Analyse post-incident » puis « 3. Confinement » lira une procédure
 * à l'envers, et la restituera dans cet ordre — ce qui est faux au sens propre : on ne
 * documente pas un incident avant de l'avoir confiné.
 */
export function ordonnerParFiche(passages: PassageTrouve[]): PassageTrouve[] {
    const rang = new Map<string, number>()
    for (const [i, p] of passages.entries()) {
        if (!rang.has(p.documentId)) rang.set(p.documentId, i)
    }
    return [...passages].sort((a, b) =>
        (rang.get(a.documentId)! - rang.get(b.documentId)!) || (a.ordre - b.ordre))
}

/**
 * Cherche, fusionne, tranche.
 *
 * On rapatrie trois fois plus de candidats que de passages retenus, pour que la fusion ait
 * de quoi travailler : un passage classé douzième en lexical et deuxième en sémantique doit
 * pouvoir remonter, sinon la moitié sémantique ne sert à rien.
 */
export async function chercher(
    question: string,
    /**
     * La question est vectorisée AVEC SON RÔLE : les modèles d'embedding ne traitent pas
     * une question comme un passage indexé, et le préfixe qui les distingue est un réglage.
     */
    calculerVecteur?: (texte: string, role: 'question' | 'passage') => Promise<number[] | null>,
): Promise<Resultat> {
    const nb = await lireNombre('recherche.passages')
    const plancher = await lireNombre('recherche.score_plancher')
    const poidsLex = await lireNombre('recherche.ponderation_lexicale')
    const statutsExclus = await lireListe('recherche.statuts_exclus')
    const motsVides = await lireListe('recherche.mots_vides')
    const partCouverture = await lireNombre('recherche.part_couverture')
    const semantiqueVoulue = await lireBooleen('embeddings.actif')
    const large = nb * 3

    const lex = await lexicale(question, statutsExclus, motsVides, partCouverture, large)

    let sem: Ligne[] = []
    if (semantiqueVoulue && calculerVecteur) {
        const v = await calculerVecteur(question, 'question')
        if (v) sem = await semantique(v, statutsExclus, large)
    }
    const mode: Resultat['mode'] = sem.length ? 'hybride' : 'lexical'

    // Sans moitié sémantique, la pondération n'a pas de sens : le lexical prend tout, sinon
    // tous les scores seraient rabotés par un poids et le plancher deviendrait faux.
    const pl = mode === 'hybride' ? poidsLex : 1
    const ps = 1 - pl

    const fusion = new Map<string, PassageTrouve>()
    const poser = (l: Ligne, lexScore: number, semScore: number) => {
        const existant = fusion.get(l.passageId)
        if (existant) {
            existant.scoreLexical = Math.max(existant.scoreLexical, lexScore)
            existant.scoreSemantique = Math.max(existant.scoreSemantique, semScore)
            existant.score = pl * existant.scoreLexical + ps * existant.scoreSemantique
            return
        }
        const { s: _, ...reste } = l
        fusion.set(l.passageId, {
            ...reste,
            scoreLexical: lexScore,
            scoreSemantique: semScore,
            score: pl * lexScore + ps * semScore,
        })
    }
    // On conserve l'ordre rendu par SQL (couverture + densité) tout en gardant la
    // couverture comme score : c'est elle, et elle seule, que le plancher compare.
    for (const l of lex) poser(l, Number(l.s), 0)
    for (const l of sem) poser(l, 0, Number(l.s))

    const rangSql = new Map(lex.map((l, i) => [l.passageId, i]))
    const places = lirePlaces(await lireListe('recherche.places'))
    const classes = [...fusion.values()].sort((a, b) => {
        // En hybride, le score fusionné tranche. En lexical seul, on suit l'ordre SQL, qui
        // mêle déjà couverture et densité — retrier sur la seule couverture perdrait la
        // densité et remettrait les mentions de passage devant les fiches.
        if (mode === 'hybride') return b.score - a.score
        return (rangSql.get(a.passageId) ?? 1e9) - (rangSql.get(b.passageId) ?? 1e9)
    })
    const meilleur = Math.max(0, ...classes.map(c => c.score))

    const sousLePlancher = meilleur < plancher
    const retenus = repartir(classes, places, nb)

    return {
        // La cohésion ne s'applique QUE si quelque chose a été trouvé : compléter une fiche
        // sous le plancher reviendrait à fabriquer une réponse à partir de rien.
        passages: sousLePlancher
            ? retenus
            : await suivreRenvois(
                await completerFiche(retenus, await lireNombre('recherche.cohesion')),
                question,
                await lireNombre('recherche.renvois'),
            ),
        sousLePlancher,
        meilleurScore: meilleur,
        mode,
        // Le diagnostic n'est calculé QUE sous le plancher : c'est une requête de plus, et
        // elle ne sert à rien quand la réponse est trouvée.
        diagnostic: sousLePlancher
            ? {
                termes: await termesDe(question, motsVides),
                frolements: classes.slice(0, 5).map(c => ({
                    titre: c.titre, section: c.titreSection, score: c.score, url: c.url,
                })),
                plancher,
            }
            : undefined,
    }
}

/**
 * RANGS D'AUTORITÉ. Plus le nombre est bas, plus la source l'emporte.
 */
export const RANGS: Record<string, number> = {
    juridique: 0,       // « un texte et une fiche qui divergent : la fiche est fausse »
    procedure: 1,       // fait foi sur la conduite à tenir
    exploitation: 2,    // fait foi sur l'exploitation de nos outils
    equipe: 3,
    produit: 4,         // fait foi sur le produit, jamais sur nos pratiques
    bonne_pratique: 5,  // « un guide dit ce qui se fait en général »
}

export type Preseance = {
    /** Étiquettes d'autorité présentes parmi les passages retenus. */
    autorites: string[]
    /** Renseigné quand une catégorie présente l'emporte sur une autre. */
    prime?: { categorie: string, sur: string[] }
}

/**
 * Qui a raison si les passages se contredisent.
 *
 * Ça ne l'est plus depuis que le corpus porte des textes de loi. `reference/README.md` est
 * explicite : « quand un texte et une procédure divergent, c'est le texte qui a raison et
 * la procédure qui doit être corrigée. » Renvoyer les deux dos à dos serait alors une
 * erreur, pas une prudence.
 */
export function preseance(passages: PassageTrouve[]): Preseance {
    const autorites = [...new Set(passages.map(p => p.autorite).filter((a): a is string => !!a))]
    const categories = [...new Set(passages.map(p => p.categorie))]
        .filter(c => c in RANGS)
        .sort((a, b) => RANGS[a]! - RANGS[b]!)

    const [tete, ...suite] = categories
    if (!tete || !suite.length || RANGS[tete] === RANGS[suite[0]!]) return { autorites }
    return { autorites, prime: { categorie: tete, sur: suite } }
}

/** Sources actives, pour le journal des lacunes : dit si le trou est documentaire ou d'index. */
export async function sourcesConsultees(): Promise<string[]> {
    const r = await db.execute(sql`SELECT nom FROM source WHERE actif ORDER BY nom`)
    return (r.rows as unknown as { nom: string }[]).map(x => x.nom)
}
