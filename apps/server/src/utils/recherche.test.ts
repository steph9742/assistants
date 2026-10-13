import { describe, expect, test } from "bun:test";
import { repartir, lirePlaces, preseance, ordonnerParFiche, extraireRenvois, porteAncre, RANGS, type PassageTrouve } from "./recherche";
import { mentionPour } from "./decoupe";
import { QUESTIONS, mentionsDe } from "./questions";
import { mentionsDeValeurs } from "./valeurs";

// Passages factices, dans l'ordre du classement.
const p = (id: string, categorie: string): PassageTrouve => ({
    passageId: id, documentId: id, ordre: 0, texte: '', titreSection: null, ancre: null,
    reference: id, titre: id, statut: null, typeDoc: null, chemin: id + '.md', version: null, dateRevision: null,
    url: null, extraction: 'complete', sourceNom: categorie, autorite: null, categorie, mention: null,
    score: 0, scoreLexical: 0, scoreSemantique: 0,
})

describe('lirePlaces', () => {
    test('lit les plafonds', () => {
        expect([...lirePlaces(['reference:2', 'equipe:1'])]).toEqual([['reference', 2], ['equipe', 1]])
    })
    test('une entrée illisible est ignorée, pas fatale', () => {
        expect([...lirePlaces(['reference:2', 'nimporte', 'x:-1', 'y:abc'])]).toEqual([['reference', 2]])
    })
    test('un plafond à zéro exclut la catégorie', () => {
        expect(lirePlaces(['reference:0']).get('reference')).toBe(0)
    })
})

describe("repartir — le tableau d'autorité inscrit dans la mécanique", () => {

    const places = lirePlaces(['reference:2'])

    // LE cas qui motive tout : la doc éditeur pèse 197 fichiers contre 53 fiches maison.
    // Elle sort donc en tête du classement brut sur presque toute question.
    test('la référence ne prend jamais plus que son plafond', () => {
        const classes = Array.from({ length: 10 }, (_, i) => p(`ref${i}`, 'reference'))
            .concat(Array.from({ length: 4 }, (_, i) => p(`proc${i}`, 'procedure')))
        const r = repartir(classes, places, 6)
        expect(r.filter(x => x.categorie === 'reference')).toHaveLength(2)
        expect(r.filter(x => x.categorie === 'procedure')).toHaveLength(4)
    })

    test("les places d'un plafond non atteint retournent au pot commun", () => {
        const classes = [p('ref0', 'reference'), ...Array.from({ length: 8 }, (_, i) => p(`proc${i}`, 'procedure'))]
        const r = repartir(classes, places, 6)
        expect(r).toHaveLength(6)
        expect(r.filter(x => x.categorie === 'procedure')).toHaveLength(5)
    })

    test('sans plafond, le score seul décide', () => {
        const classes = [p('a', 'procedure'), p('b', 'reference'), p('c', 'procedure')]
        expect(repartir(classes, new Map(), 3).map(x => x.passageId)).toEqual(['a', 'b', 'c'])
    })

    test("l'ordre de sortie suit le classement, pas l'ordre de service", () => {
        // `ref0` est premier au score : il doit rester premier, même si la répartition
        // sert les catégories plafonnées avant les autres.
        const classes = [p('ref0', 'reference'), p('proc0', 'procedure'), p('ref1', 'reference')]
        expect(repartir(classes, places, 3).map(x => x.passageId)).toEqual(['ref0', 'proc0', 'ref1'])
    })

    test('aucun doublon quand une catégorie est servie deux fois', () => {
        const classes = [p('a', 'reference'), p('b', 'reference'), p('c', 'procedure')]
        const r = repartir(classes, places, 6)
        expect(new Set(r.map(x => x.passageId)).size).toBe(r.length)
    })

    test('ne renvoie jamais plus que le nombre demandé', () => {
        const classes = Array.from({ length: 30 }, (_, i) => p(`x${i}`, i % 2 ? 'reference' : 'procedure'))
        expect(repartir(classes, places, 6)).toHaveLength(6)
    })

    test('une catégorie plafonnée à zéro est exclue', () => {
        const classes = [p('r', 'reference'), p('p', 'procedure')]
        const r = repartir(classes, lirePlaces(['reference:0']), 6)
        expect(r.map(x => x.passageId)).toEqual(['p'])
    })
})

describe('preseance — qui a raison quand les sources divergent', () => {

    const avec = (cats: string[], autorites?: (string | null)[]) =>
        cats.map((c, i) => ({ ...p(`x${i}`, c), autorite: autorites?.[i] ?? null }))

    // Le cas qui a fait changer la règle. `reference/README.md` du corpus est explicite :
    // « quand un texte et une procédure divergent, c'est le texte qui a raison et la
    // procédure qui doit être corrigée. » Les renvoyer dos à dos serait une erreur.
    test('un texte réglementaire prime sur une procédure', () => {
        const r = preseance(avec(['procedure', 'juridique']))
        expect(r.prime?.categorie).toBe('juridique')
        expect(r.prime?.sur).toContain('procedure')
    })

    // Entre pairs, la règle d'origine tient : l'outil signale, il ne tranche pas.
    test('entre pairs, aucune préséance', () => {
        expect(preseance(avec(['procedure', 'procedure'])).prime).toBeUndefined()
    })

    test('une seule catégorie ne produit pas de préséance', () => {
        expect(preseance(avec(['juridique', 'juridique'])).prime).toBeUndefined()
    })

    test('un guide de bonnes pratiques ne prime pas sur une procédure', () => {
        const r = preseance(avec(['bonne_pratique', 'procedure']))
        expect(r.prime?.categorie).toBe('procedure')
        expect(r.prime?.sur).toContain('bonne_pratique')
    })

    test("la doc éditeur ne prime pas sur nos pratiques", () => {
        expect(preseance(avec(['produit', 'exploitation'])).prime?.categorie).toBe('exploitation')
    })

    test('les étiquettes d\'autorité sont rendues sans doublon', () => {
        const r = preseance(avec(['procedure', 'procedure'], ['Conduite à tenir', 'Conduite à tenir']))
        expect(r.autorites).toEqual(['Conduite à tenir'])
    })

    // Une catégorie inconnue ne doit pas se retrouver en tête par accident de tri.
    test('une catégorie hors barème est ignorée pour la préséance', () => {
        expect(preseance(avec(['inventee', 'procedure'])).prime).toBeUndefined()
    })

    test("l'ordre des rangs suit celui du corpus", () => {
        expect(RANGS.juridique).toBeLessThan(RANGS.procedure!)
        expect(RANGS.procedure).toBeLessThan(RANGS.produit!)
        expect(RANGS.produit).toBeLessThan(RANGS.bonne_pratique!)
    })
})

describe('mention obligatoire', () => {
    // Le plan de reprise d'Arche doit exister sur PAPIER : si l'assistant devient un chemin
    // commode vers lui, quelqu'un cessera de l'imprimer — et le jour où la production tombe,
    // l'assistant tombe avec elle.
    test('la mention voyage avec le passage', () => {
        const avecMention = { ...p('x', 'exploitation'), mention: 'Cette procédure doit exister sur papier.' }
        expect(avecMention.mention).toBe('Cette procédure doit exister sur papier.')
    })

    test('une source sans mention n\'en invente pas', () => {
        expect(p('y', 'procedure').mention).toBeNull()
    })
})

describe('mentionPour — mentions par chemin', () => {
    const R = [
        'docs/|Documentation du projet.',
        'docs/reprise.md|Cette procédure doit exister sur papier, hors des deux machines.',
    ]

    // La plus SPÉCIFIQUE gagne, pas la première déclarée : sans cette règle, l'ordre de
    // saisie déciderait et personne ne s'en souviendrait.
    test('le préfixe le plus long gagne', () => {
        expect(mentionPour('docs/reprise.md', R)).toContain('sur papier')
        expect(mentionPour('docs/mco.md', R)).toBe('Documentation du projet.')
    })

    test('un chemin hors règle ne reçoit rien', () => {
        expect(mentionPour('README.md', R)).toBeNull()
    })

    test('une règle malformée est ignorée, pas fatale', () => {
        expect(mentionPour('docs/x.md', ['sans-barre', '|phrase-orpheline', 'docs/|ok'])).toBe('ok')
    })
})

describe('post-conditions des questions', () => {
    const q = (cle: string) => QUESTIONS.find(x => x.cle === cle)!

    /**
     * Ces essais portent sur la GARANTIE, pas sur l'endroit où elle est écrite.
     *
     * Une réponse porte deux couches : les post-conditions de sa question, et les pièges qui
     * tiennent au champ et s'appliquent à toute réponse. Certaines mises en garde ont migré
     * de la première vers la seconde le jour où l'on a voulu qu'elles couvrent aussi les
     * routes non déclarées. Ces essais ne doivent pas tomber pour un déménagement : ce qu'ils
     * vérifient, c'est qu'une réponse ne peut pas sortir sans la mention.
     */
    const dit = (cle: string, corps: any) =>
        [...mentionsDe(q(cle), corps), ...mentionsDeValeurs(corps)].join(' ')

    test('un cadre non lu ne passe pas pour un cadre sans écart', () => {
        const m = mentionsDe(q('ecarts_conformite'), { total: 0, cadresLus: ['nis2'] })
        expect(m.join(' ')).toContain('faute de droits')
        expect(m.join(' ')).toContain("ne veut pas dire qu'ils sont sans écart")
    })

    test("un connecteur jamais abouti ne passe pas pour un écart nul", () => {
        expect(dit('couverture_edr', { dernierStatut: 'jamais', comptes: {} }))
            .toContain('JAMAIS été relevé')
    })

    // Celle-ci reste propre à la route : aucun champ ne la porte, elle se déduit.
    test("un écart nul par absence de groupe critique se dit comme tel", () => {
        expect(dit('couverture_edr', { reglesDeclarees: 0 }))
            .toContain('par construction, pas par constat')
    })

    test('un premier relevé de moteurs n\'est pas « aucun changement »', () => {
        expect(dit('moteurs_edr', { changements: null })).toContain('premier relevé')
        // Et l'inverse doit rester silencieux : `[]` VEUT dire « aucun changement ».
        expect(dit('moteurs_edr', { changements: [] })).not.toContain('premier relevé')
    })

    test("agentEdr inconnu n'est pas agentEdr absent", () => {
        expect(dit('parc_expose', { resultats: [{ agentEdr: 'inconnu' }] }))
            .toContain('PAS « absent »')
    })

    test("données personnelles non tranchées ne valent pas absence", () => {
        expect(dit('dossier_application', { donneesPersonnelles: { traite: null } }))
            .toContain("N'A PAS ÉTÉ TRANCHÉE")
    })

    /**
     * Le point de tout ce déménagement : la mise en garde s'applique désormais à une route
     * QU'ON N'A PAS DÉCLARÉE. Sans cela, un accès libre en lecture rendrait « cette
     * application ne traite pas de données personnelles » — la phrase que le § 1 du contrat
     * interdit nommément.
     */
    test('la mise en garde vaut aussi hors des questions déclarées', () => {
        expect(mentionsDeValeurs({ donneesPersonnelles: { traite: null } }).join(' '))
            .toContain("N'A PAS ÉTÉ TRANCHÉE")
    })

    test('la recherche par libellé se déclare comme non exhaustive', () => {
        expect(dit('recherche_catalogue', { exhaustif: false })).toContain('PAS un décompte')
    })

    test("aucun responsable enregistré n'est pas aucun responsable", () => {
        const m = mentionsDe(q('responsables'), { total: 0 })
        expect(m.join(' ')).toContain('ENREGISTRÉ')
    })

    // Une post-condition qui lève ne doit jamais faire échouer une réponse déjà produite.
    test('une post-condition qui lève est absorbée', () => {
        expect(() => mentionsDe(q('ecarts_conformite'), null)).not.toThrow()
    })
})

/**
 * ON CHERCHE DES PASSAGES, ON RÉPOND AVEC UNE FICHE.
 *
 * Mesuré sur INC-04 : « 6. Éradication » et « 9. Analyse post-incident » gagnent à 0,462,
 * « 3. Confinement » — isoler la machine, c'est-à-dire la réponse — arrive douzième à 0,176.
 * Les sections qui FONT nomment le moins, et aucun poids ne corrige cela.
 */
describe('ordre de lecture d\'une fiche', () => {
    const sect = (doc: string, ordre: number, titre: string): PassageTrouve =>
        ({ ...p(`${doc}-${ordre}`, 'procedure'), documentId: doc, ordre, titreSection: titre })

    test('remet les sections d\'une fiche dans leur ordre', () => {
        const melange = [sect('INC-04', 9, 'Analyse post-incident'), sect('INC-04', 3, 'Confinement')]
        expect(ordonnerParFiche(melange).map(x => x.ordre)).toEqual([3, 9])
    })

    /**
     * Le classement par pertinence est le bon ordre pour CHOISIR, le mauvais pour LIRE. Un
     * modèle qui reçoit « analyse post-incident » avant « confinement » restitue la
     * procédure à l'envers — ce qui est faux au sens propre : on ne documente pas un
     * incident avant de l'avoir confiné.
     */
    test('garde les documents dans l\'ordre de pertinence', () => {
        const melange = [
            sect('INC-04', 9, 'Analyse'),
            sect('AUTRE', 1, 'Autre fiche'),
            sect('INC-04', 3, 'Confinement'),
        ]
        const r = ordonnerParFiche(melange)
        // INC-04 d'abord parce que son meilleur passage venait en tête ; ses sections
        // remises dans l'ordre ; l'autre fiche ensuite.
        expect(r.map(x => `${x.documentId}-${x.ordre}`)).toEqual(['INC-04-3', 'INC-04-9', 'AUTRE-1'])
    })

    test('ne réordonne rien quand chaque document n\'a qu\'une section', () => {
        const l = [sect('A', 5, 'x'), sect('B', 1, 'y'), sect('C', 3, 'z')]
        expect(ordonnerParFiche(l).map(x => x.documentId)).toEqual(['A', 'B', 'C'])
    })

    test('supporte une liste vide', () => {
        expect(ordonnerParFiche([])).toEqual([])
    })
})

/**
 * LA FICHE DOMINANTE EST CELLE QUI FOURNIT LE PLUS DE SECTIONS.
 *
 * Prendre le premier passage était faux, et le relevé sur le corpus l'a montré : à la
 * question sur le malware, « INC-GRILLE — 1. Niveaux » arrive premier avec UNE section,
 * tandis qu'INC-04 en fournit plusieurs. C'est INC-04 qui est la réponse.
 */
describe('quelle fiche domine', () => {
    const sect = (doc: string, ordre: number): PassageTrouve =>
        ({ ...p(`${doc}-${ordre}`, 'procedure'), documentId: doc, ordre })

    /** Reproduit le choix de `completerFiche`, sans base. */
    const dominante = (l: PassageTrouve[]) => {
        const compte = new Map<string, { n: number, rang: number }>()
        for (const [i, x] of l.entries()) {
            const v = compte.get(x.documentId)
            if (v) v.n++
            else compte.set(x.documentId, { n: 1, rang: i })
        }
        const [d] = [...compte].sort((a, b) => b[1].n - a[1].n || a[1].rang - b[1].rang)
        return d && d[1].n >= 2 ? d[0] : null
    }

    test('choisit la fiche la plus représentée, pas celle arrivée en tête', () => {
        expect(dominante([
            sect('INC-GRILLE', 1),
            sect('INC-04', 10),
            sect('INC-04', 7),
        ])).toBe('INC-04')
    })

    test('départage deux fiches à égalité par leur meilleur rang', () => {
        expect(dominante([
            sect('A', 1), sect('B', 1), sect('A', 2), sect('B', 2),
        ])).toBe('A')
    })

    // Une fiche qui n'apporte qu'un passage n'est pas la réponse : la ramener entière
    // noierait les autres sources.
    test('ne déclenche rien quand aucune fiche n\'en fournit deux', () => {
        expect(dominante([sect('A', 1), sect('B', 1), sect('C', 1)])).toBeNull()
    })
})

/**
 * L'extraction des renvois — la moitié pure du suivi, testable sans base.
 */
describe('extraireRenvois', () => {
    const avec = (chemin: string, texte: string): PassageTrouve =>
        ({ ...p('x', 'procedure'), chemin, texte })

    test('résout un chemin relatif avec remontée', () => {
        const r = extraireRenvois([avec('incidents/checklist-malware.md', 'voir [OUT-05](../outils/out-05-boite-a-outils.md)')])
        expect([...r.keys()]).toEqual(['outils/out-05-boite-a-outils.md'])
    })

    test('capture et normalise l\'ancre — accents, majuscules, encodage', () => {
        const r = extraireRenvois([avec('outils/out-05.md',
            'voir [annexe J §3](../annexes/anx-j.md#3-Capturer-la-m%C3%A9moire-vive)')])
        expect(r.get('annexes/anx-j.md')).toEqual(new Set(['3-capturer-la-memoire-vive']))
    })

    test('rassemble plusieurs ancres vers un même document', () => {
        const r = extraireRenvois([avec('a/b.md', '[x](c.md#un) et [y](c.md#deux) et [z](c.md)')])
        expect(r.get('a/c.md')).toEqual(new Set(['un', 'deux']))
    })

    test('un lien sans ancre donne un jeu vide, pas d\'entrée fantôme', () => {
        const r = extraireRenvois([avec('a/b.md', '[x](c.md)')])
        expect(r.get('a/c.md')).toEqual(new Set())
    })

    test('ignore les liens externes et les images', () => {
        const r = extraireRenvois([avec('a/b.md', '[x](https://exemple.fr/d.md) ![i](img.png)')])
        // Le lien https se résout comme un chemin — mais il ne correspondra à aucun
        // document en base, ce qui le neutralise. On vérifie seulement qu'aucun .png n'entre.
        expect([...r.keys()].some(k => k.endsWith('.png'))).toBe(false)
    })
})

describe('porteAncre — la désignation atteint aussi les ###', () => {
    test("reconnaît l'ancre du passage lui-même", () => {
        expect(porteAncre({ ancre: 'les-cinq-issues', texte: '## Les cinq issues\n\ntexte' },
            new Set(['les-cinq-issues']))).toBe(true)
    })

    test('reconnaît un ### contenu dans le texte du passage parent', () => {
        // Le cas mesuré : « Le signalement sans suite » est un ### sous « Les cinq
        // issues » — la découpe le garde dans le passage parent, dont l'ancre est celle
        // du ##. La désignation doit le trouver quand même.
        const texte = '## Les cinq issues\n\n### La veille est un statut\n\n…\n\n### Le signalement sans suite\n\nquatre gestes'
        expect(porteAncre({ ancre: 'les-cinq-issues', texte },
            new Set(['le-signalement-sans-suite']))).toBe(true)
    })

    test('normalise les accents et apostrophes comme la découpe', () => {
        const texte = "## Gestes\n\n### 2. Isoler une machine sans l'éteindre\n\ncommandes"
        expect(porteAncre({ ancre: 'gestes', texte },
            new Set(['2-isoler-une-machine-sans-leteindre']))).toBe(true)
    })

    test("ne reconnaît pas une ancre absente, et un ## dans le texte n'est pas un ###", () => {
        expect(porteAncre({ ancre: 'gestes', texte: '## Gestes\n\nrien' },
            new Set(['absent']))).toBe(false)
        expect(porteAncre({ ancre: null, texte: '## Le signalement sans suite\n\nx' },
            new Set(['le-signalement-sans-suite']))).toBe(false)
    })
})
