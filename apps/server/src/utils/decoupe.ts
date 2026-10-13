// DÉCOUPAGE D'UN DOCUMENT EN PASSAGES.
//
// Deux opérations : lire l'en-tête YAML, puis découper le corps.

export type EnTete = {
    titre?: string
    reference?: string
    type?: string
    version?: string
    statut?: string
    dateRevision?: string
    proprietaire?: string
    diffusion?: string
    /**
     * Type d'incident (taxonomie de l'établissement) auquel la fiche répond.
     *
     * LISTE, parce que le corpus l'écrit `type_incidents: [malware]` — et c'est sa forme
     * qui a gagné. Le code lisait `type_incident:` en valeur plate : la clé ne
     * correspondait pas, et le lecteur de valeurs plates ignorait de toute façon ce qui
     * commence par un crochet. Six fiches déclarées, zéro lue — le pont était inerte, et
     * seul « --montrer » posé sur un P1 réel l'a fait voir. Le linter du corpus garantit
     * une seule valeur par fiche ; la liste est sa syntaxe, pas sa sémantique.
     */
    typeIncidents?: string[]
    /** Domaines du Catalogue (vocabulaire de /api/lacunes) que la fiche couvre. */
    domainesCatalogue?: string[]
    /**
     * Par quels mots on cherche cette fiche, et les questions auxquelles elle répond.
     *
     * L'assistant ne trouvait une fiche que par les mots qu'elle EMPLOIE. Or une fiche bien
     * rédigée n'emploie qu'un seul terme par notion, par souci de rigueur — de sorte que la
     * rigueur rédactionnelle jouait contre la recherche. Mesuré sur INC-04 : ses sections
     * opératoires disent « isoler la machine du réseau », jamais « malware ».
     */
    motsCles?: string[]
    repondA?: string[]
}

export type Passage = {
    ordre: number
    titreSection: string | null
    ancre: string | null
    texte: string
}

/** Clés de l'en-tête lues comme des LISTES. */
const LISTES: Record<string, 'motsCles' | 'repondA' | 'typeIncidents' | 'domainesCatalogue'> = {
    mots_cles: 'motsCles',
    repond_a: 'repondA',
    // Les deux écritures sont acceptées, singulier et pluriel : le désaccord de convention
    // qui a rendu le pont inerte ne doit pas pouvoir se reproduire sur une variante.
    type_incidents: 'typeIncidents',
    type_incident: 'typeIncidents',
    domaine_catalogue: 'domainesCatalogue',
    domaines_catalogue: 'domainesCatalogue',
}

/** Clés de l'en-tête qu'on sait lire. Le reste est ignoré sans bruit. */
const CLES: Record<string, keyof EnTete> = {
    titre: 'titre',
    reference: 'reference',
    type: 'type',
    version: 'version',
    statut: 'statut',
    date_revision: 'dateRevision',
    proprietaire: 'proprietaire',
    diffusion: 'diffusion',
}

/**
 * Sépare l'en-tête YAML du corps.
 */
export function lireEnTete(brut: string): { entete: EnTete, corps: string } {
    const texte = brut.replace(/^﻿/, '')
    if (!texte.startsWith('---')) return { entete: {}, corps: texte }

    const fin = texte.indexOf('\n---', 3)
    if (fin === -1) return { entete: {}, corps: texte }

    const bloc = texte.slice(3, fin)
    // Le saut de ligne qui suit la fermeture appartient à l'en-tête, pas au corps.
    const corps = texte.slice(texte.indexOf('\n', fin + 1) + 1).replace(/^\n+/, '')

    const entete: EnTete = {}
    // Liste en cours de lecture, pour la forme à tirets qui court sur plusieurs lignes.
    let listeEnCours: (typeof LISTES)[string] | null = null

    const propre = (v: string) => v.trim().replace(/^["']|["']$/g, '').trim()

    for (const brute of bloc.split('\n')) {
        // Un tiret en début de ligne poursuit la liste ouverte. On ne `trim()` pas avant de
        // regarder, sinon on ne saurait pas distinguer une entrée de liste d'une clé.
        const tiret = /^\s*-\s+(.*)$/.exec(brute)
        if (tiret && listeEnCours) {
            const v = propre(tiret[1]!)
            if (v) entete[listeEnCours] = [...(entete[listeEnCours] ?? []), v]
            continue
        }

        const m = /^([a-z_]+)\s*:\s*(.*)$/.exec(brute.trim())
        if (!m) continue
        listeEnCours = null

        const cleListe = LISTES[m[1]!]
        if (cleListe) {
            const reste = m[2]!.trim()
            if (reste.startsWith('[')) {
                // Forme en ligne. On coupe sur les virgules : ces valeurs n'en contiennent
                // pas — une question qui en contiendrait s'écrit en forme à tirets.
                const items = reste.replace(/^\[|\]$/g, '').split(',').map(propre).filter(Boolean)
                if (items.length) entete[cleListe] = items
            }
            // Sans rien après le deux-points, la liste continue aux lignes suivantes.
            else if (!reste) listeEnCours = cleListe
            // Une valeur plate sur une clé de liste : on l'accepte comme entrée unique
            // plutôt que de la perdre. Écrire `mots_cles: malware` est une faute vénielle.
            else entete[cleListe] = [propre(reste)]
            continue
        }

        const cle = CLES[m[1]!]
        if (!cle) continue
        const valeur = propre(m[2]!)
        // Les clés plates de CLES ne recouvrent aucune clé de liste — l'assignation est
        // sûre, TypeScript ne peut simplement pas le prouver depuis deux tables séparées.
        if (valeur && !valeur.startsWith('[')) (entete as Record<string, string>)[cle] = valeur
    }
    return { entete, corps }
}

/**
 * Titre d'un document SANS en-tête YAML : le premier `# `.
 */
export function titreDuCorps(corps: string): string | null {
    for (const ligne of corps.split('\n', 40)) {
        const m = /^#\s+(.+?)\s*$/.exec(ligne)
        if (m) return m[1]!
    }
    return null
}

export function retirerCommentairesEnTete(corps: string): string {
    return corps.replace(/^\s*(?:<!--[\s\S]*?-->\s*)+/, '')
}

/** `## Confinement du compte` → `confinement-du-compte`, comme l'ancre GitLab. */
export function ancre(titre: string): string {
    return titre
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
}

/**
 * Découpe le corps en passages.
 *
 * Règle : une section `##` fait un passage, `###` compris. Si elle dépasse `tailleVisee`,
 * elle est scindée sur ses `###` — et en dernier recours sur les paragraphes, pour qu'un
 * document sans sous-titres ne produise pas un passage unique de 20 000 caractères que le
 * modèle ne lira qu'à moitié.
 */
export function decouper(corps: string, tailleVisee = 2500, tailleMin = 250): Passage[] {
    const lignes = corps.split('\n')
    const brutes: { titre: string | null, lignes: string[] }[] = []
    let courante: { titre: string | null, lignes: string[] } = { titre: null, lignes: [] }
    let dansCloture = false

    for (const ligne of lignes) {
        // Un `## ` à l'intérieur d'un bloc de code n'est pas un titre, c'est un commentaire.
        if (/^```/.test(ligne.trim())) dansCloture = !dansCloture

        if (!dansCloture && /^##\s+/.test(ligne) && !/^###/.test(ligne)) {
            if (courante.lignes.some(l => l.trim())) brutes.push(courante)
            courante = { titre: ligne.replace(/^##\s+/, '').trim(), lignes: [] }
            continue
        }
        courante.lignes.push(ligne)
    }
    if (courante.lignes.some(l => l.trim())) brutes.push(courante)

    const passages: Passage[] = []
    for (const s of brutes) {
        const texte = s.lignes.join('\n').trim()
        if (!texte) continue

        if (texte.length <= tailleVisee) {
            passages.push(faire(s.titre, texte, passages.length))
            continue
        }
        for (const morceau of scinder(texte, tailleVisee)) {
            passages.push(faire(s.titre, morceau, passages.length))
        }
    }
    return regrouper(passages, tailleMin, tailleVisee)
}

/**
 * Recolle les passages trop courts au précédent.
 *
 * Sur le corpus réel, le découpage brut laisse une trentaine de passages sous 200
 * caractères : un titre de section suivi de deux lignes. Isolés, ils ne remontent jamais —
 * ou remontent sans rien apprendre. Recollés à ce qui précède, ils enrichissent un passage
 * qui, lui, a du sens.
 */
function regrouper(passages: Passage[], tailleMin: number, tailleVisee: number): Passage[] {
    const sortie: Passage[] = []
    for (const p of passages) {
        const precedent = sortie[sortie.length - 1]
        const tropCourt = p.texte.length < tailleMin
        const tientEncore = precedent && (precedent.texte.length + p.texte.length) <= tailleVisee

        if (tropCourt && precedent && tientEncore) {
            precedent.texte = `${precedent.texte}\n\n${p.texte}`
            continue
        }
        sortie.push({ ...p, ordre: sortie.length })
    }
    return sortie
}

function faire(titre: string | null, texte: string, ordre: number): Passage {
    return {
        ordre,
        titreSection: titre,
        ancre: titre ? ancre(titre) : null,
        // Le titre est répété dans le texte : il porte souvent le mot-clé qui fait
        // retrouver le passage, et la colonne engendrée l'indexe déjà séparément.
        texte: titre ? `## ${titre}\n\n${texte}` : texte,
    }
}

/** Scinde sur les `###`, sinon sur les paragraphes, sinon de force. */
function scinder(texte: string, taille: number): string[] {
    const parSousTitre = texte.split(/\n(?=###\s+)/)
    const morceaux = parSousTitre.length > 1 ? parSousTitre : texte.split(/\n\s*\n/)

    const sortie: string[] = []
    let tampon = ''
    for (const m of morceaux) {
        // On regroupe tant qu'on tient dans la taille visée : scinder au plus juste
        // produirait des passages minuscules, exactement le défaut qu'on cherche à éviter.
        if (tampon && (tampon.length + m.length) > taille) {
            sortie.push(tampon.trim())
            tampon = m
        }
        else tampon = tampon ? `${tampon}\n\n${m}` : m
    }
    if (tampon.trim()) sortie.push(tampon.trim())

    // Un pavé sans sous-titre NI saut de paragraphe ne se scinde sur rien, et ressortait
    // entier — un passage de 20 000 caractères que le modèle ne lit qu'à moitié. Le corpus
    // actuel n'en contient pas ; un document Nextcloud, si. Découverte par un essai, pas
    // en lecture : rien dans le code ne le laissait voir.
    return sortie.flatMap(m => m.length <= taille * 1.5 ? [m] : couperNet(m, taille))
}

/** Coupe sur l'espace le plus proche de la limite, pour ne pas trancher un mot. */
function couperNet(texte: string, taille: number): string[] {
    const sortie: string[] = []
    let reste = texte
    while (reste.length > taille) {
        const fenetre = reste.slice(0, taille)
        const coupe = Math.max(fenetre.lastIndexOf('\n'), fenetre.lastIndexOf(' '))
        const point = coupe > taille * 0.5 ? coupe : taille
        sortie.push(reste.slice(0, point).trim())
        reste = reste.slice(point).trim()
    }
    if (reste) sortie.push(reste)
    return sortie
}

/**
 * Résout la mention qui s'applique à un chemin.
 *
 * Les règles sont des chaînes `préfixe|phrase`. La plus SPÉCIFIQUE gagne — c'est-à-dire la
 * plus longue : `docs/reprise.md` l'emporte sur `docs/`. Sans cette règle, l'ordre de
 * saisie déciderait, et personne ne s'en souviendrait.
 */
export function mentionPour(chemin: string, regles: string[]): string | null {
    let meilleure: { longueur: number, phrase: string } | null = null
    for (const regle of regles) {
        const coupure = regle.indexOf('|')
        if (coupure <= 0) continue
        const prefixe = regle.slice(0, coupure).trim()
        const phrase = regle.slice(coupure + 1).trim()
        if (!prefixe || !phrase || !chemin.startsWith(prefixe)) continue
        if (!meilleure || prefixe.length > meilleure.longueur) {
            meilleure = { longueur: prefixe.length, phrase }
        }
    }
    return meilleure?.phrase ?? null
}
