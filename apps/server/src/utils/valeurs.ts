// LES MISES EN GARDE QUI NE TIENNENT PAS À LA ROUTE, MAIS AU CHAMP.
//
// Les post-conditions de `questions.ts` sont attachées à une question déclarée. C'est juste
// pour celles qui portent sur le SENS d'un point d'entrée — « le croisement plafonne à 100 »
// n'a de sens que pour le croisement.

/**
 * Une règle porte sur un nom de champ et sur ce que sa valeur signifie.
 *
 * `dit` est rédigé pour être répercuté tel quel dans la réponse. La formulation suit celle
 * du contrat : ce que la valeur SIGNIFIE, puis ce qu'elle NE signifie PAS — c'est la seconde
 * moitié qui fait le travail, parce que la lecture naïve est toujours la fausse.
 */
export type RegleValeur = {
    cle: string
    quand: (v: unknown) => boolean
    dit: string
}

/**
 * Ces règles s'EFFACENT devant celles que la source publie sur `/api/lectures`.
 *
 * Elles ont été recopiées à la main du § 12 du contrat du Catalogue, et une copie diverge —
 * c'est le reproche exact que nous faisions au tableau Markdown dont elles viennent. Elles
 * ne sont donc plus qu'un filet pour les sources qui n'ont pas encore livré la route, et
 * l'origine de chaque mention le dit.
 */
export type RegleLocale = RegleValeur & { champ: string, valeurTemoin: unknown }

const estNul = (v: unknown) => v === null

export const REGLES_VALEURS: RegleLocale[] = [
    // ----- Ce qui n'a pas été tranché -------------------------------------------------
    {
        cle: 'traite', champ: 'traite', valeurTemoin: null, quand: estNul,
        dit: "`donneesPersonnelles.traite: null` signifie que la question N'A PAS ÉTÉ TRANCHÉE pour cet objet. "
            + "Ce n'est pas une réponse négative : ne jamais écrire qu'il ne traite pas de données personnelles.",
    },
    {
        cle: 'aTrancher', champ: 'aTrancher', valeurTemoin: true, quand: v => v === true,
        dit: "`aTrancher: true` — l'applicabilité n'a pas été déterminée, et aucun délai ne court tant que la "
            + "décision n'est pas enregistrée. Ce n'est PAS « non applicable ».",
    },
    {
        cle: 'conformite', champ: 'conformite', valeurTemoin: null, quand: estNul,
        dit: "`conformite: null` — l'exigence est NON ÉVALUÉE. Ce n'est PAS « conforme », et ce n'est PAS "
            + "« non conforme » : elle ne peut entrer dans aucun des deux décomptes, et un taux d'avancement "
            + "qui l'agrège est faux.",
    },
    // L'ÉTAT RGPD D'UNE APPLICATION. « Personne n'a répondu » et « quelqu'un a répondu non
    // conforme » produisent la même absence de conformité, et une seule est un manquement :
    // la distinction que la source prend soin de faire dans son calcul se perdrait à la
    // lecture sans ces deux règles.
    {
        cle: 'etatRgpd', champ: 'etatRgpd', valeurTemoin: 'non_evalue', quand: v => v === 'non_evalue',
        dit: "`etatRgpd: non_evalue` — l'évaluation RGPD de cette application N'A PAS ÉTÉ FAITE. Ce n'est PAS "
            + "un écart : personne n'a répondu, ce qui ne veut pas dire que quelqu'un a répondu « non conforme ». "
            + "Ne jamais l'agréger aux applications en écart, et le dire à part.",
    },
    {
        cle: 'etatRgpd', champ: 'etatRgpd', valeurTemoin: 'hors_perimetre', quand: v => v === 'hors_perimetre',
        dit: "`etatRgpd: hors_perimetre` — cette application est hors du périmètre RGPD. Ce n'est PAS « conforme » "
            + "et ce n'est PAS un écart : elle n'entre dans aucun des deux décomptes, et l'y compter fausse les deux.",
    },

    {
        cle: 'incidentOuvert', champ: 'incidentOuvert', valeurTemoin: true, quand: v => v === true,
        dit: "`incidentOuvert` vient de Sniff en direct, posé sur la page après coup : ce n'est PAS un "
            + "critère de recherche et il ne se dénombre pas. « Quelles machines ont un incident ouvert » "
            + "se demande depuis l'incident — par le croisement des incidents — jamais depuis la machine.",
    },

    // ----- Ce qui n'a jamais abouti ---------------------------------------------------
    {
        cle: 'agentEdr', champ: 'agentEdr', valeurTemoin: 'inconnu', quand: v => v === 'inconnu',
        dit: "`agentEdr: \"inconnu\"` — le connecteur EDR n'a jamais abouti pour ces machines. Ce n'est PAS "
            + "« absent » : l'écart n'est pas calculable, et un écart nul ne veut rien dire ici.",
    },
    {
        cle: 'dernierStatut', champ: 'dernierStatut', valeurTemoin: 'jamais', quand: v => v === 'jamais',
        dit: "`dernierStatut: \"jamais\"` — cet objet n'a JAMAIS été relevé. Ce n'est PAS « en ordre » : "
            + "il n'apparaît dans aucune alerte parce qu'on ne l'a pas regardé, et son absence des alertes "
            + 'ne veut donc rien dire.',
    },
    {
        cle: 'changements', champ: 'changements', valeurTemoin: null, quand: estNul,
        dit: "`changements: null` — premier relevé, aucune comparaison possible. C'est différent de `[]`, "
            + 'qui signifie « comparaison effectuée, aucun changement ».',
    },

    // ----- Ce qu'on n'a pas le droit de lire ------------------------------------------
    {
        cle: 'lisible', champ: 'lisible', valeurTemoin: false, quand: v => v === false,
        dit: "`lisible: false` — ce bloc est HORS DE LA PORTÉE de la clé de service. Ce n'est pas un "
            + 'référentiel vide.',
    },

    // ----- Les décomptes qui n'en sont pas ---------------------------------------------
    {
        cle: 'exhaustif', champ: 'exhaustif', valeurTemoin: false, quand: v => v === false,
        dit: "`exhaustif: false` — le total rendu est un nombre de correspondances trouvées, PAS un décompte. "
            + 'Ne pas le présenter comme une mesure du parc ou du référentiel.',
    },
    {
        cle: 'tronque', champ: 'tronque', valeurTemoin: true, quand: v => v === true,
        dit: "`tronque: true` — la chaîne a été interrompue au plafond de profondeur. Ce qui est au-delà "
            + "n'a pas été exploré.",
    },

    // ----- Ce qui est un état, et non une échéance -------------------------------------
    {
        cle: 'estUnEtat', champ: 'estUnEtat', valeurTemoin: true, quand: v => v === true,
        dit: "`estUnEtat: true` — alerte SANS date, un état à corriger et non une échéance à planifier. "
            + "Ne lui attribuer aucune date, et ne pas la classer dans un ordre d'urgence par le temps : "
            + "le rang qu'elle y occuperait n'aurait aucun sens.",
    },

    // ----- Les rapprochements qui n'ont pas eu lieu ------------------------------------
    {
        cle: 'rapprochee', champ: 'rapprochee', valeurTemoin: false, quand: v => v === false,
        dit: "`rapprochee: false` — machine saisie librement, sans identifiant GLPI : elle n'a pu être "
            + "rapprochée d'aucune fiche. Un incident sans contexte n'est pas un incident sans enjeu.",
    },

    // ----- Ce que la source déclare elle-même manquant ---------------------------------
    //
    // La seule règle qui demande d'AJOUTER de l'information plutôt que d'en corriger la
    // lecture. Elle vaut d'être ici : `manques` est le champ par lequel les sources disent
    // ce qu'elles ne savent pas, et le taire annule tout le dispositif.
    {
        cle: 'manques', champ: 'manques', valeurTemoin: '(non vide)', quand: v => Array.isArray(v) && v.length > 0,
        dit: "Un champ `manques` est renseigné : la source désigne elle-même ce qui n'est pas rempli. "
            + "Le répercuter — c'est une information, pas du remplissage.",
    },
    /**
     * LES AVERTISSEMENTS ÉCRITS PAR LA SOURCE, POUR ÊTRE RÉPÉTÉS.
     *
     * C'est le même raisonnement que pour `consequence` sur un 503 : celui qui produit le
     * chiffre sait ce qu'il ne prouve pas, et l'écrit dans la charge utile pour qu'on n'ait
     * pas à le deviner. Un appelant qui doit chercher la réserve ailleurs ne la répercute
     * pas.
     */
    {
        cle: 'avertissement', champ: 'avertissement', valeurTemoin: '(non vide)',
        quand: v => typeof v === 'string' && v.trim().length > 0,
        dit: "La source joint un AVERTISSEMENT à cette réponse. Ce n'est PAS un commentaire facultatif : "
            + "il dit ce que le chiffre ne prouve pas. Le porter dans la réponse, mot pour mot ou reformulé "
            + 'sans en changer le sens.',
    },
    {
        cle: 'avertissements', champ: 'avertissements', valeurTemoin: '(non vide)',
        quand: v => Array.isArray(v) && v.length > 0,
        dit: "La source joint des AVERTISSEMENTS à cette réponse. Ce ne sont PAS des commentaires "
            + "facultatifs : ils disent ce que les chiffres ne prouvent pas. Les porter dans la réponse.",
    },
]

/**
 * Parcourt une réponse et rend les mises en garde qui s'y appliquent.
 *
 * On descend dans TOUTE la structure, y compris les tableaux : un `agentEdr: "inconnu"` sur
 * la trentième ligne compte autant que sur la première. Chaque règle ne se déclenche qu'une
 * fois, avec le nombre d'occurrences quand il y en a plusieurs — répéter trente fois la même
 * phrase noierait la réponse, ce qu'on cherche justement à éviter.
 */
export function mentionsDeValeurs(
    corps: unknown,
    regles: RegleLocale[] = REGLES_VALEURS,
    profondeurMax = 8,
): string[] {
    const comptes = new Map<RegleLocale, number>()
    const vus = new WeakSet<object>()

    const parcourir = (n: unknown, profondeur: number) => {
        if (profondeur > profondeurMax || n === null || typeof n !== 'object') return
        if (vus.has(n as object)) return
        vus.add(n as object)

        if (Array.isArray(n)) {
            for (const x of n) parcourir(x, profondeur + 1)
            return
        }

        for (const [cle, v] of Object.entries(n as Record<string, unknown>)) {
            for (const r of regles) {
                if (r.cle === cle && r.quand(v)) comptes.set(r, (comptes.get(r) ?? 0) + 1)
            }
            parcourir(v, profondeur + 1)
        }
    }

    parcourir(corps, 0)

    return [...comptes].map(([r, n]) => n > 1 ? `${r.dit} (${n} occurrences)` : r.dit)
}

/**
 * Les règles locales que la source n'a PAS déclarées.
 */
export function nonCouvertes(
    distantes: { champ: string, valeur: unknown }[],
    locales: RegleLocale[] = REGLES_VALEURS,
    champsCalcules: { champs: string[], filtrable?: false | string, compte?: false | string }[] = [],
): RegleLocale[] {
    const vues = new Set(distantes.map(l => `${l.champ}\u0000${String(l.valeur)}`))

    /**
     * Le recensement des champs calculés efface AUSSI nos règles — mais seulement celles
     * qui disent la même chose que lui.
     *
     * Une entrée qui déclare un champ non filtrable ou non comptable porte exactement le
     * propos de nos deux règles écrites à la main sur `eolStatut` et `incidentOuvert` : les
     * garder ferait dire deux fois la même mise en garde, avec des mots différents.
     */
    const nonExploitables = new Set(champsCalcules
        .filter(c => c.filtrable === false || c.compte === false)
        .flatMap(c => c.champs))

    return locales.filter(r =>
        !vues.has(`${r.champ}\u0000${String(r.valeurTemoin)}`) && !nonExploitables.has(r.champ))
}
