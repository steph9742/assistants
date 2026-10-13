// INDEX DOCUMENTAIRE.
//
// Trois tables et une règle : l'index est un CACHE, jamais une source. Les documents
// vivent dans GitLab, dans Nextcloud, dans les dépôts — ici on n'en garde qu'une copie
// découpée, pour pouvoir chercher. Tout est reconstructible en une synchronisation.

import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
    boolean, customType, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, vector,
} from "drizzle-orm/pg-core";

/**
 * `tsvector` n'a pas de type natif dans Drizzle. Le déclarer ici plutôt que de laisser la
 * colonne engendrée sortir en `text` : sur une colonne `text`, l'index GIN se crée sans
 * broncher et ne sert à rien — la recherche plein texte retomberait en balayage complet
 * sans qu'aucune erreur ne le signale.
 */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

export const id = () => text('id').primaryKey().$defaultFn(() => createId())

/**
 * SOURCES — une ligne par dépôt, dossier ou API interrogée.
 *
 * `actif` porte la frontière d'instance : c'est en désactivant Nextcloud, Slowpoke et le
 * Catalogue qu'on obtient une instance restreinte. Depuis que ces sources sont lues par des comptes
 * de service à lecture totale, c'est la seule chose qui les sépare.
 */
export const source = pgTable('source', {
    id: id(),
    nom: text('nom').notNull().unique(),
    type: text('type').notNull(),          // 'gitlab' — 'nextcloud_dav' au lot D
    actif: boolean('actif').notNull().default(true),
    /** Propre au type : base, projet, ref, dossiers, exclusions. Aucun secret ici. */
    config: jsonb('config').notNull().default({}),
    /**
     * L'identifiant de lecture, chiffré (`utils/secrets.ts`, préfixe `enc.v1.`). En colonne
     * dédiée plutôt que noyé dans `config` : un secret qui a sa propre colonne ne part pas
     * par accident dans une réponse d'API qui renverrait la configuration entière.
     */
    jetonChiffre: text('jeton_chiffre'),
    /** Ce qui fait autorité sur ce sujet — sert à signaler les contradictions. */
    autorite: text('autorite'),

    /**
     * CATÉGORIE D'AUTORITÉ.
     *
     * Elle sert à deux choses distinctes, qu'il ne faut pas confondre :
     * le nombre de places qu'une source peut occuper parmi les passages retenus, et
     * QUI A RAISON quand deux sources se contredisent. Ce sont deux questions différentes,
     * et une seule catégorie y répond parce que la réponse vient du même endroit — le
     * `reference/README.md` du corpus, qui les fixe explicitement.
     */
    categorie: text('categorie').notNull().default('procedure'),

    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * ÉTAT DE SYNCHRONISATION — une ligne par source.
 *
 * Table séparée, et non des colonnes sur `source`, pour une raison précise : un index qui
 * cesse de se mettre à jour EN SILENCE sert des réponses périmées avec la même assurance
 * qu'une réponse fraîche. C'est le pire mode de panne de tout l'outil. L'état mérite donc
 * d'être un objet de première classe, lisible d'un coup pour toutes les sources, et affiché
 * dans l'interface — pas seulement dans les journaux.
 */
export const synchro = pgTable('synchro', {
    sourceId: text('source_id').primaryKey().references(() => source.id, { onDelete: 'cascade' }),
    dernierDebut: timestamp('dernier_debut', { withTimezone: true }),
    /** Ce qui compte pour la péremption : un début sans succès n'est pas une mise à jour. */
    dernierSucces: timestamp('dernier_succes', { withTimezone: true }),
    /**
     * Jeton de synchronisation, pour les sources qui savent rendre un delta.
     *
     * Nextcloud le fournit via `REPORT sync-collection` : au tour suivant on ne récupère que
     * ce qui a bougé, SUPPRESSIONS COMPRISES — ce que la comparaison de listes de GitLab ne
     * sait pas faire aussi bien.
     */
    dernierJeton: text('dernier_jeton'),
    etat: text('etat').notNull().default('jamais'),   // jamais | en_cours | ok | echec
    message: text('message'),
    documentsVus: integer('documents_vus').notNull().default(0),
    documentsChanges: integer('documents_changes').notNull().default(0),
})

/**
 * DOCUMENTS — un par fichier indexé.
 */
export const document = pgTable('document', {
    id: id(),
    sourceId: text('source_id').notNull().references(() => source.id, { onDelete: 'cascade' }),
    chemin: text('chemin').notNull(),
    empreinte: text('empreinte').notNull(),

    reference: text('reference'),          // INC-09, QOT-03, ANX-A
    titre: text('titre').notNull(),
    typeDoc: text('type_doc'),             // fiche-incident, quotidien, annexe
    /**
     * LE PONT DONNÉES → PROCÉDURE, déclaré par la rédaction dans l'en-tête des fiches.
     *
     * `type_incident` : la taxonomie des incidents de l'ÉTABLISSEMENT — celle de la grille
     * INC-GRILLE, que Sniff implémente. Le nom ne se couple pas à l'outil : si Sniff change
     * un jour, la déclaration des fiches reste vraie. Une réponse de données contenant des
     * incidents de type X attache la conduite de la fiche qui déclare X.
     */
    /**
     * LE PONT, AU PLURIEL — en nom comme en type.
     *
     * Ces deux colonnes étaient du texte simple, et la synchronisation n'en gardait que la
     * première valeur. Trois documents déclarent deux domaines, et `conformite` n'y figure
     * QUE comme seconde valeur : le domaine aurait été vide alors qu'il est déclaré deux
     * fois, sans que rien ne le signale.
     */
    typesIncident: text('types_incident').array(),
    domainesCatalogue: text('domaines_catalogue').array(),
    statut: text('statut'),                // brouillon | valide | obsolete | null
    version: text('version'),
    dateRevision: text('date_revision'),
    url: text('url'),

    /**
     * `complete` | `none` — un PDF scanné s'indexe sans texte. On le garde quand même,
     * repérable par son nom, pour que la réponse puisse dire « ce document existe mais son
     * contenu n'est pas indexable » au lieu de « ce n'est pas écrit ». La nuance compte :
     * la seconde réponse alimente à tort le journal des lacunes.
     */
    extraction: text('extraction').notNull().default('complete'),

    /**
     * MENTION OBLIGATOIRE — phrase que toute réponse citant ce document doit porter.
     *
     * Résolue à l'indexation depuis les `mentions` de la source (`chemin|phrase`), et
     * stockée ici plutôt que sur la source : « cette procédure doit exister sur papier »
     * vaut pour le plan de reprise d'Arche, pas pour ses treize documents.
     */
    mention: text('mention'),

    indexeLe: timestamp('indexe_le', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    uniqueIndex('document_source_chemin').on(t.sourceId, t.chemin),
    index('document_statut').on(t.statut),
])

/**
 * PASSAGES — l'unité de recherche.
 *
 * `tsv` est une colonne ENGENDRÉE en configuration `french`. Engendrée et non calculée à
 * l'écriture : impossible d'oublier de la mettre à jour, et impossible qu'elle diverge du
 * texte qu'elle indexe.
 */
export const passage = pgTable('passage', {
    id: id(),
    documentId: text('document_id').notNull().references(() => document.id, { onDelete: 'cascade' }),
    ordre: integer('ordre').notNull(),
    titreSection: text('titre_section'),
    /**
     * DÉNORMALISATION ASSUMÉE, pour que le `tsvector` puisse s'en servir.
     *
     * Une colonne engendrée ne voit que sa propre ligne. Le titre du document et ses
     * mots-clés vivent sur `document` : sans les recopier ici, ils ne peuvent pas entrer
     * dans l'index, et une fiche « INC-04 — Malware » dont une section dit « isoler la
     * machine du réseau » reste introuvable sur « malware ».
     */
    contexteFort: text('contexte_fort'),
    contexteMoyen: text('contexte_moyen'),
    /** Ancre pour le lien : `#nom-de-la-section`. */
    ancre: text('ancre'),
    texte: text('texte').notNull(),

    /**
     * TROIS ZONES, PONDÉRÉES PAR POSTGRESQL LUI-MÊME.
     *
     *   A — mots-clés déclarés et questions auxquelles la fiche répond ;
     *   B — titre du document, sa référence, et le titre de la section ;
     *   C — le corps.
     */
    tsv: tsvector('tsv').generatedAlwaysAs(
        sql`setweight(to_tsvector('french', coalesce(contexte_fort, '')), 'A')
            || setweight(to_tsvector('french', coalesce(contexte_moyen, '') || ' ' || coalesce(titre_section, '')), 'B')
            || setweight(to_tsvector('french', texte), 'C')`,
    ),
    vecteur: vector('vecteur', { dimensions: 1024 }),
}, (t) => [
    index('passage_tsv').using('gin', sql`${t.tsv}`),
    index('passage_document').on(t.documentId),
])

/**
 * JOURNAL DES LACUNES — les questions restées sans réponse.
 *
 * « Ce n'est pas écrit » est la réponse la plus précieuse de l'outil : elle désigne un trou
 * dans la documentation. Consignée, elle devient la file de rédaction documentaire.
 */
export const lacune = pgTable('lacune', {
    id: id(),
    question: text('question').notNull(),
    /** Ce qui a été fouillé sans rien trouver : dit si le trou est documentaire ou d'index. */
    sourcesConsultees: jsonb('sources_consultees').notNull().default([]),
    meilleurScore: text('meilleur_score'),
    utilisateur: text('utilisateur'),
    date: timestamp('date', { withTimezone: true }).notNull().defaultNow(),
    /** Passe à vrai quand la documentation a comblé le trou. */
    traitee: boolean('traitee').notNull().default(false),
    /**
     * D'où vient cette entrée. `non_trouve` : l'assistant n'a pas su répondre — le cas
     * d'origine du journal. `signalement` : L'HUMAIN a jugé la réponse à côté.
     *
     * Le second existe parce que le premier ne suffit pas : les pires réponses de cette
     * semaine — « Non, pas de P1 », les sections discursives d'INC-04 — étaient TROUVÉES.
     * Elles ne laissaient donc aucune trace nulle part, et chaque « c'est un peu à côté »
     * devait être répété de vive voix pour exister. Le signalement est la moitié manquante
     * de la file de rédaction : ce que l'outil croit savoir et qui ne sert pas.
     */
    origine: text('origine').notNull().default('non_trouve'),
    /** Sur un signalement : ce que la réponse citait. C'est ce qui rend le tri possible. */
    citations: jsonb('citations'),
    /**
     * Sur un signalement : ce qui manquait, dans les mots du signalant.
     *
     * Facultatif, et c'est délibéré — exiger la phrase ferait renoncer au signalement, et
     * un signalement muet vaut mieux qu'un silence. Mais quand elle est là, c'est elle qui
     * dit à la rédaction quoi écrire : « il manquait la commande », « ça ne dit pas quoi
     * faire si l'utilisateur n'a rien saisi ». Le reste du journal se déduit ; celle-ci ne
     * se devine pas.
     */
    ceQuiManquait: text('ce_qui_manquait'),
}, (t) => [index('lacune_date').on(t.date)])

/**
 * JOURNAL DE CONSULTATION — qui a demandé quoi, et quand.
 *
 * CE QUI EST ÉCRIT, ET CE QUI NE L'EST JAMAIS.
 */
export const consultation = pgTable('consultation', {
    id: id(),
    date: timestamp('date', { withTimezone: true }).notNull().defaultNow(),
    utilisateur: text('utilisateur'),
    /** `assistant` | `journaux` */
    outil: text('outil').notNull(),

    /** Renseignée pour l'assistant, TOUJOURS nulle pour l'analyse de journaux. */
    question: text('question'),
    /** Longueur de l'entrée. Suffit à distinguer un essai d'un usage réel. */
    tailleEntree: integer('taille_entree').notNull().default(0),

    trouve: boolean('trouve'),
    /** Références des documents cités : de quoi refaire le chemin sans stocker la réponse. */
    citations: jsonb('citations').notNull().default([]),

    modele: text('modele'),
    /** Empreinte de la consigne réellement envoyée — règle 7, jusque dans la trace. */
    consigne: text('consigne'),
    dureeMs: integer('duree_ms'),
    /** Renseigné quand la demande a échoué : le modèle injoignable est une information. */
    erreur: text('erreur'),
}, (t) => [
    index('consultation_date').on(t.date),
    index('consultation_utilisateur').on(t.utilisateur),
])
