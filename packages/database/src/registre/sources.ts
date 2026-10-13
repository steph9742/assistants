// DESCRIPTEURS DE TYPES DE SOURCE.
//
// Même discipline que le registre des réglages, appliquée aux connecteurs : chaque type de
// source déclare ICI ses champs, une seule fois, avec leur description en français. Il en
// découle la même chose — le code lit le descripteur, l'écran de configuration se construit
// depuis le descripteur, et `doc/Connecteurs.md` en est engendré.

export type TypeChamp = 'texte' | 'liste' | 'nombre' | 'booleen'

export type ChampSource = {
    cle: string
    libelle: string
    type: TypeChamp
    description: string
    defaut?: string
    obligatoire?: boolean
    exemple?: string
    note?: string
}

export type DescripteurSource = {
    type: string
    libelle: string
    description: string
    /**
     * `index` — les documents sont découpés et rangés dans l'index.
     * `donnees` — la source est interrogée AU MOMENT DE LA QUESTION, jamais indexée.
     *
     * La distinction n'est pas technique, elle est de fond : on n'indexe pas un incident.
     * Une donnée vivante recopiée dans un index est une donnée fausse dès la minute
     * suivante, et elle a l'air aussi vraie que les autres.
     */
    nature: 'index' | 'donnees'
    categorieDefaut: string
    champs: ChampSource[]
    /** Libellé du secret. Il vit dans `source.jetonChiffre`, jamais dans `config`. */
    secret?: { libelle: string, description: string, note?: string }
}

/**
 * Mentions par chemin, sous la forme `chemin|phrase`.
 *
 * Portée par la SOURCE, la mention s'appliquait à tous ses documents — ce qui est faux dès
 * qu'un dépôt en contient plusieurs sortes. « Cette procédure doit exister sur papier » vaut
 * pour le plan de reprise d'Arche, pas pour ses treize documents.
 */
const MENTIONS_COMMUNES: ChampSource = {
    cle: 'mentions', libelle: 'Mentions par chemin', type: 'liste', defaut: '',
    description: "Phrases qu'une réponse citant ces documents doit porter, sous la forme `chemin|phrase`. Le chemin est un préfixe.",
    exemple: "docs/reprise.md|Cette procédure doit exister sur papier, hors des deux machines.",
    note: "Écrite ici et non dans la consigne du modèle : une consigne se réécrit dans les réglages, une mention attachée au document le suit partout.",
}

const EXCLUSIONS_COMMUNES: ChampSource = {
    cle: 'exclusions', libelle: 'Chemins exclus', type: 'liste',
    defaut: '_archive/,sortie/,_gabarits/,_outils/',
    description: "Dossiers jamais lus. Un chemin est exclu s'il traverse l'un d'eux.",
    note: "Les fichiers `.local.md` sont TOUJOURS exclus, quelle que soit cette liste : ils portent les valeurs réelles, secrets et configuration d'IdP. Ils sont déjà ignorés par Git ; le filtre existe pour le jour où l'un serait commité par accident, qui est exactement le jour où il ne faut pas qu'un assistant le recopie.",
}

export const DESCRIPTEURS: readonly DescripteurSource[] = [

    // ---------------------------------------------------------------------------------
    {
        type: 'gitlab',
        libelle: 'Dépôt GitLab',
        nature: 'index',
        categorieDefaut: 'exploitation',
        description: "Lit les fichiers Markdown d'un dépôt, à HEAD. Sert le corpus de procédures, les dossiers de référence, et les `doc/` des dépôts d'application.",
        secret: {
            libelle: "Jeton d'accès",
            description: "Jeton de projet ou de groupe, portée `read_repository` ou `read_api`. Chiffré en base.",
            note: "Un jeton de GROUPE sur `ssi/` couvre les cinq dépôts d'un coup — un jeton par projet multiplie les rotations à faire.",
        },
        champs: [
            { cle: 'base', libelle: 'Adresse du GitLab', type: 'texte', obligatoire: true,
              exemple: 'https://gitlab.example.org',
              description: "Racine de l'instance, sans `/api/v4`." },
            { cle: 'projet', libelle: 'Chemin du projet', type: 'texte', obligatoire: true,
              exemple: 'ssi/documentation',
              description: "Chemin complet, espace de noms compris.",
              note: "Le chemin CANONIQUE, jamais une redirection. GitLab redirige après un transfert de projet, mais la redirection saute dès que quelqu'un recrée un projet à l'ancien chemin." },
            { cle: 'ref', libelle: 'Branche', type: 'texte', defaut: 'main',
              description: "On n'indexe que la tête de cette branche. Jamais l'historique : le corpus a été nettoyé par `git filter-repo`, et parcourir les commits antérieurs réintroduirait dans l'index exactement ce qui en a été retiré." },
            { cle: 'dossiers', libelle: 'Dossiers à lire', type: 'liste', obligatoire: true,
              exemple: 'incidents,outils,quotidien,annexes,validation',
              description: "Une même source ne lit que ces dossiers. Déclarer plusieurs sources sur un même dépôt permet de donner des autorités différentes à des dossiers différents." },
            EXCLUSIONS_COMMUNES,
            MENTIONS_COMMUNES,
        ],
    },

    // ---------------------------------------------------------------------------------
    {
        type: 'nextcloud_fichiers',
        libelle: 'Nextcloud — dossier de fichiers',
        nature: 'index',
        categorieDefaut: 'equipe',
        description: "Lit un dossier par WebDAV et suit ses changements par jeton de synchronisation. Les documents n'ont pas d'en-tête : le titre vient du premier `#` ou du nom de fichier, et il n'y a pas de statut.",
        secret: {
            libelle: "Mot de passe d'application",
            description: "Créé dans Nextcloud sous Paramètres → Sécurité. Chiffré en base.",
            note: "Un MOT DE PASSE D'APPLICATION, jamais celui du compte : il se révoque seul et n'ouvre pas l'interface web.",
        },
        champs: [
            { cle: 'base', libelle: 'Adresse du Nextcloud', type: 'texte', obligatoire: true,
              exemple: 'https://nextcloud.example.org',
              description: "Racine de l'instance, sans `/remote.php`." },
            { cle: 'compte', libelle: 'Compte de service', type: 'texte', obligatoire: true,
              exemple: 'assistant-lecture',
              description: "Le compte avec lequel le dossier est lu. Il doit avoir le partage en LECTURE SEULE : pas de repartage, pas de suppression.",
              note: "C'est la seule barrière qui garantisse la règle 1 côté Nextcloud, indépendamment de notre code." },
            { cle: 'dossier', libelle: 'Dossier à lire', type: 'texte', obligatoire: true,
              exemple: 'Equipe',
              description: "Chemin depuis la racine du compte. Vide = tout ce que le compte voit." },
            { cle: 'exclusions', libelle: 'Chemins exclus', type: 'liste', defaut: '_archive/',
              description: "Dossiers jamais lus.",
              note: "`_archive/` est la convention qui REMPLACE le champ `statut` : un document Nextcloud n'a pas d'en-tête, donc le filtre « obsolète » ne peut pas s'y appliquer. Sans ce dossier, une note d'équipe périmée reste indéfiniment retournable." },
            { cle: 'refuser_federes', libelle: 'Refuser les partages fédérés entrants', type: 'booleen', defaut: 'true',
              description: "Écarte les documents venus d'un partage fédéré.",
              note: "Quiconque écrit dans un dossier partagé peut y déposer un document empoisonné ; un partage fédéré élargit ce « quiconque » hors de l'établissement." },
            { cle: 'taille_max', libelle: 'Taille maximale d\'un fichier', type: 'nombre', defaut: '20000000',
              description: "Au-delà, le fichier est ignoré et signalé. L'extraction de texte est le poste à pics mémoire, et elle dépend de fichiers déposés par des tiers." },
            MENTIONS_COMMUNES,
        ],
    },

    // ---------------------------------------------------------------------------------
    {
        type: 'nextcloud_taches',
        libelle: 'Nextcloud — tâches partagées',
        nature: 'donnees',
        categorieDefaut: 'equipe',
        description: "Lit une liste de tâches par CalDAV, AU MOMENT DE LA QUESTION.",
        secret: {
            libelle: "Mot de passe d'application",
            description: "Le même que pour les fichiers, ou un autre. Chiffré en base.",
        },
        champs: [
            { cle: 'base', libelle: 'Adresse du Nextcloud', type: 'texte', obligatoire: true,
              exemple: 'https://nextcloud.example.org',
              description: "Racine de l'instance." },
            { cle: 'compte', libelle: 'Compte de service', type: 'texte', obligatoire: true,
              description: "Le même compte que pour les fichiers, en principe." },
            { cle: 'liste', libelle: 'Liste de tâches', type: 'texte', obligatoire: true,
              exemple: 'cellule-cyber',
              description: "Identifiant du calendrier qui porte les tâches.",
              note: "Non indexée volontairement : quelques centaines d'entrées se relisent en entier à la question, et ça supprime le cas où une synchronisation de six heures sert une tâche fermée le matin comme si elle était ouverte." },
        ],
    },

    // ---------------------------------------------------------------------------------
    {
        type: 'catalogue',
        libelle: 'Catalogue — données vivantes',
        nature: 'donnees',
        categorieDefaut: 'donnees',
        description: "Interroge le Catalogue au moment de la question, selon son contrat de lecture. Rien n'est indexé.",
        secret: {
            libelle: 'Clé de service',
            description: "Clé `sk_…`, portée `read`. Chiffrée en base.",
            note: "La portée du compte de service est DÉCLARÉE côté Catalogue : une clé sans `read` ni `cat:<clé>` ne lit rien. À vérifier avant la première mise en service.",
        },
        champs: [
            { cle: 'base', libelle: 'Adresse du Catalogue', type: 'texte', obligatoire: true,
              exemple: 'https://catalogue.example.org',
              description: "Racine publique. Le contrat de lecture est servi sur `/openapi`." },
        ],
    },

    // ---------------------------------------------------------------------------------
    {
        type: 'sniff',
        libelle: 'Sniff — incidents',
        nature: 'donnees',
        categorieDefaut: 'donnees',
        description: "Interroge Sniff au moment de la question. Rien n'est indexé : un incident recopié dans un index est faux dès la minute suivante.",
        secret: {
            libelle: 'Clé de service',
            description: "Clé `sk_…` en lecture. Chiffrée en base.",
        },
        champs: [
            { cle: 'base', libelle: 'Adresse de Sniff', type: 'texte', obligatoire: true,
              exemple: 'https://sniff.example.org',
              description: "Racine publique. Le contrat de lecture est servi sur `/openapi`." },
            { cle: 'version_minimale', libelle: 'Version minimale exigée', type: 'texte', defaut: '72d3857',
              description: "Commit comparé à celui que rend `/health`. Une correspondance exacte suffit à valider.",
              note: "Deux abrégés de commit NE SE COMPARENT PAS : ce sont des empreintes, pas des numéros. Ce champ ne sert donc qu'à reconnaître une version, pas à en ordonner deux. C'est « Date minimale » qui tranche." },
            { cle: 'date_minimale', libelle: 'Date minimale de construction', type: 'texte', defaut: '',
              exemple: '2026-01-15',
              description: "Comparée à `construitLe`, que `/health` rend depuis la version 72d3857 de Sniff.",
              note: "C'est ce champ qui permet à l'avertissement de version de se lever tout seul. Avant lui, l'assistant ne pouvait que signaler une différence entre deux empreintes de commit sans pouvoir dire laquelle était la plus récente — un avertissement vrai et inutile, qui restait affiché. `construitLe: null` ne veut PAS dire « antérieure » : c'est une image bâtie sans l'argument, ce qu'une image récente montée à la main porte aussi. Ce que les versions antérieures à 72d3857 coûtent : la pagination des incidents n'est pas fiable, et le décompte peut ne pas compter ce que la liste montre." },
        ],
    },

] as const

const PAR_TYPE = new Map(DESCRIPTEURS.map(d => [d.type, d]))

export function descripteur(type: string): DescripteurSource {
    const d = PAR_TYPE.get(type)
    if (!d) throw new Error(`Type de source inconnu : « ${type} ».`)
    return d
}

export const TYPES_SOURCE = DESCRIPTEURS.map(d => d.type)

/**
 * La valeur d'un champ, ou le défaut de son descripteur.
 *
 * Une source déjà enregistrée ne reçoit pas rétroactivement les défauts des champs ajoutés
 * depuis. Sans cette lecture, un champ neuf reste vide sur tout le parc existant et son
 * contrôle ne s'applique qu'aux sources créées après — c'est-à-dire à aucune.
 */
export function valeurOuDefaut(type: string, config: Record<string, unknown>, cle: string): string {
    const v = config?.[cle]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v)
    return descripteur(type).champs.find(c => c.cle === cle)?.defaut ?? ''
}

/** Valide une configuration contre son descripteur. Renvoie les manques, vide si tout va. */
export function validerConfig(type: string, config: Record<string, unknown>): string[] {
    const d = descripteur(type)
    const manques: string[] = []
    for (const c of d.champs) {
        if (!c.obligatoire) continue
        const v = config[c.cle]
        if (v === undefined || v === null || String(v).trim() === '') {
            manques.push(`${c.libelle} (${c.cle})`)
        }
    }
    return manques
}
