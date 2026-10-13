import { describe, expect, test } from "bun:test";
import { lireEnTete, decouper, ancre, titreDuCorps, retirerCommentairesEnTete } from "./decoupe";
import { exclu } from "./gitlab";

describe('lireEnTete', () => {

    test("lit l'en-tête normalisé du corpus", () => {
        const { entete, corps } = lireEnTete(
            '---\ntitre: Phishing\nreference: INC-09\nstatut: valide\ndate_revision: 2026-07-25\n---\n\n# Phishing\n\nTexte.')
        expect(entete.reference).toBe('INC-09')
        expect(entete.statut).toBe('valide')
        expect(entete.dateRevision).toBe('2026-07-25')
        expect(corps).toStartWith('# Phishing')
    })

    test("un document sans en-tête n'est pas une erreur", () => {
        const { entete, corps } = lireEnTete('# Notes de réunion\n\nTexte.')
        expect(entete).toEqual({})
        expect(corps).toStartWith('# Notes')
    })

    test('les listes sont ignorées, pas mal lues', () => {
        const { entete } = lireEnTete('---\ntitre: X\nniveau_p: [P3, P4]\n---\n\nTexte.')
        expect(entete.titre).toBe('X')
        expect(Object.values(entete)).not.toContain('[P3, P4]')
    })

    test("un en-tête non refermé ne mange pas le document", () => {
        const { entete, corps } = lireEnTete('---\ntitre: X\n\n# Titre\n\nTexte.')
        expect(entete).toEqual({})
        expect(corps).toContain('# Titre')
    })
})

describe('decouper', () => {

    test('une section ## fait un passage, ### compris', () => {
        const p = decouper('## Un\n\nA.\n\n### Sous\n\nB.\n\n## Deux\n\nC.', 2500, 0)
        expect(p).toHaveLength(2)
        expect(p[0]!.texte).toContain('### Sous')
        expect(p[1]!.titreSection).toBe('Deux')
    })

    // Le « en un coup d'œil » du corpus vit avant le premier ##, et c'est souvent le plus
    // informatif de la fiche.
    test('le texte avant le premier ## est conservé', () => {
        const p = decouper("Résumé important.\n\n## Un\n\nA.", 2500, 0)
        expect(p[0]!.titreSection).toBeNull()
        expect(p[0]!.texte).toContain('Résumé important')
    })

    test("un ## dans un bloc de code n'est pas un titre", () => {
        const p = decouper('## Un\n\n```bash\n## ceci est un commentaire\n```\n\nA.', 2500, 0)
        expect(p).toHaveLength(1)
    })

    test('une section trop longue est scindée', () => {
        const p = decouper(`## Un\n\n${'phrase. '.repeat(600)}`, 1000, 0)
        expect(p.length).toBeGreaterThan(1)
        for (const x of p) expect(x.texte.length).toBeLessThan(2000)
    })

    test('les passages trop courts sont recollés au précédent', () => {
        const long = 'a'.repeat(400)
        const avec = decouper(`## Un\n\n${long}\n\n## Deux\n\nx.`, 2500, 250)
        const sans = decouper(`## Un\n\n${long}\n\n## Deux\n\nx.`, 2500, 0)
        expect(avec).toHaveLength(1)
        expect(sans).toHaveLength(2)
        expect(avec[0]!.texte).toContain('x.')
    })

    test("l'ordre est contigu après regroupement", () => {
        const p = decouper('## A\n\nx.\n\n## B\n\ny.\n\n## C\n\nz.', 2500, 250)
        expect(p.map(x => x.ordre)).toEqual(p.map((_, i) => i))
    })
})

describe('ancre', () => {
    test('reproduit la forme des ancres GitLab', () => {
        expect(ancre('Confinement du compte')).toBe('confinement-du-compte')
        expect(ancre('Étape 3 — Éradication')).toBe('etape-3-eradication')
        expect(ancre("Qu'est-ce qu'on fait ?")).toBe('quest-ce-quon-fait')
    })
})

describe('exclu — filtre par chemin', () => {

    const EXCL = ['_archive/', 'sortie/']

    test('écarte les dossiers exclus', () => {
        expect(exclu('_archive/arch-01.md', EXCL)).toBe(true)
        expect(exclu('sortie/rapport.md', EXCL)).toBe(true)
        expect(exclu('incidents/inc-09.md', EXCL)).toBe(false)
    })

    test('écarte un dossier exclu imbriqué', () => {
        expect(exclu('doc/_archive/vieux.md', EXCL)).toBe(true)
    })

    // Les .local.md portent les valeurs réelles — secrets, configuration d'IdP. Ils sont
    // ignorés par Git, donc ne devraient jamais apparaître : le filtre existe pour le jour
    // où l'un serait commité par accident, qui est exactement le jour où il ne faut pas
    // qu'un assistant le recopie.
    test('écarte les .local.md où qu\'ils soient', () => {
        expect(exclu('doc/Installation.local.md', EXCL)).toBe(true)
        expect(exclu('incidents/notes.local.md', [])).toBe(true)
    })

    test("ne confond pas un préfixe avec un dossier", () => {
        expect(exclu('sortie-des-stocks/x.md', EXCL)).toBe(false)
        expect(exclu('_archives-2025/x.md', EXCL)).toBe(false)
    })
})

describe('documents sans en-tête — la documentation éditeur', () => {

    test('le titre vient du premier #', () => {
        expect(titreDuCorps('<!-- copie -->\n\n# Données de télémétrie\n\nTexte.')).toBe('Données de télémétrie')
    })

    test("un ## ne fait pas titre de document", () => {
        expect(titreDuCorps('## Section\n\nTexte.')).toBeNull()
    })

    test('ne cherche pas indéfiniment', () => {
        expect(titreDuCorps(`${'x\n'.repeat(200)}# Trop loin`)).toBeNull()
    })

    // Le même commentaire figure sur les 197 fichiers de la copie de référence : indexé,
    // il ajoute les mêmes mots partout et fausse la fréquence des termes qu'il contient.
    test("les commentaires HTML de tête sont retirés", () => {
        const c = retirerCommentairesEnTete(
            '<!-- Documentation HarfangLab — copie de référence -->\n\n# Sigma\n\nTexte.')
        expect(c).toStartWith('# Sigma')
        expect(c).not.toContain('copie de référence')
    })

    test('un commentaire dans le corps est conservé', () => {
        const c = retirerCommentairesEnTete('# Titre\n\n<!-- note utile -->\n\nTexte.')
        expect(c).toContain('note utile')
    })
})

/**
 * Les deux clés de recherche, lues dans leurs deux formes.
 *
 * L'assistant ne trouvait une fiche que par les mots qu'elle EMPLOIE — et une fiche bien
 * rédigée n'emploie qu'un seul terme par notion. La rigueur rédactionnelle jouait donc
 * contre la recherche.
 */
describe("mots-clés et questions déclarés dans l'en-tête", () => {
    const entete = (bloc: string) => lireEnTete(`---\n${bloc}\n---\n\n# Titre\n\ncorps`).entete

    test('lit la forme en ligne', () => {
        expect(entete('mots_cles: [malware, code malveillant, rançongiciel]').motsCles)
            .toEqual(['malware', 'code malveillant', 'rançongiciel'])
    })

    test('lit la forme à tirets, sur plusieurs lignes', () => {
        const e = entete([
            'repond_a:',
            '  - que faire en cas de malware sur un poste',
            "  - un poste est infecté, quelles étapes",
        ].join('\n'))
        expect(e.repondA).toEqual([
            'que faire en cas de malware sur un poste',
            'un poste est infecté, quelles étapes',
        ])
    })

    test('referme la liste à la clé suivante', () => {
        const e = entete(['mots_cles:', '  - malware', 'statut: valide'].join('\n'))
        expect(e.motsCles).toEqual(['malware'])
        expect(e.statut).toBe('valide')
    })

    test('lit les deux clés côte à côte, formes mêlées', () => {
        const e = entete([
            'titre: Fiche',
            'mots_cles: [malware, virus]',
            'repond_a:',
            '  - que faire',
        ].join('\n'))
        expect(e.titre).toBe('Fiche')
        expect(e.motsCles).toEqual(['malware', 'virus'])
        expect(e.repondA).toEqual(['que faire'])
    })

    // Une faute vénielle ne doit pas coûter la clé entière : mieux vaut une entrée unique
    // qu'un silence dont personne ne saura qu'il vient d'une virgule manquante.
    test('accepte une valeur plate comme entrée unique', () => {
        expect(entete('mots_cles: malware').motsCles).toEqual(['malware'])
    })

    test('retire les guillemets et les entrées vides', () => {
        expect(entete('mots_cles: ["malware", , \'virus\']').motsCles).toEqual(['malware', 'virus'])
    })

    test("l'absence des clés n'est pas une erreur", () => {
        const e = entete('titre: Fiche\nstatut: valide')
        expect(e.motsCles).toBeUndefined()
        expect(e.repondA).toBeUndefined()
        expect(e.titre).toBe('Fiche')
    })

    // Un tiret hors de toute liste ouverte ne doit rien remplir : le corpus contient des
    // en-têtes avec des lignes de séparation ou des commentaires.
    test('ignore un tiret qui ne suit aucune clé de liste', () => {
        const e = entete('titre: Fiche\n  - orphelin')
        expect(e.motsCles).toBeUndefined()
        expect(e.repondA).toBeUndefined()
    })
})

/**
 * Le pont déclaré dans l'en-tête — dans la forme RÉELLE du corpus.
 *
 * Le corpus écrit `type_incidents: [malware]` ; le code lisait `type_incident:` en valeur
 * plate. Six fiches déclarées, zéro lue, pont inerte — découvert sur un P1 réel. Les deux
 * écritures sont désormais acceptées, pour que ce désaccord ne puisse plus exister.
 */
describe('type_incidents et domaine_catalogue', () => {
    const entete = (bloc: string) => lireEnTete(`---\n${bloc}\n---\n\n# T\n\nc`).entete

    test('lit la forme du corpus : pluriel, en liste', () => {
        expect(entete('type_incidents: [malware]').typeIncidents).toEqual(['malware'])
    })

    test('accepte aussi le singulier et la valeur plate', () => {
        expect(entete('type_incident: malware').typeIncidents).toEqual(['malware'])
        expect(entete('domaine_catalogue: certificats').domainesCatalogue).toEqual(['certificats'])
    })

    test('cohabite avec les autres clés de liste', () => {
        const e = entete(['mots_cles: [a, b]', 'type_incidents: [ransomware]'].join('\n'))
        expect(e.motsCles).toEqual(['a', 'b'])
        expect(e.typeIncidents).toEqual(['ransomware'])
    })
})

describe('un document éclaire plusieurs domaines', () => {
    const entete = (bloc: string) => lireEnTete(`---\n${bloc}\n---\n\n# T\n\nc`).entete

    // LE CAS QUI A CASSÉ LE PONT. L'annexe D déclare « rgpd, conformite », l'annexe I
    // « listes-blanches, conformite », la fiche SOC « edr, parc ». Notre colonne était du
    // texte simple et ne gardait que la première valeur : `conformite`, qui n'apparaît QUE
    // comme seconde, aurait été vide alors qu'il est déclaré deux fois.
    test('lit toutes les valeurs, pas seulement la première', () => {
        expect(entete('domaine_catalogue: [rgpd, conformite]').domainesCatalogue)
            .toEqual(['rgpd', 'conformite'])
        expect(entete('domaines_catalogue: [edr, parc]').domainesCatalogue)
            .toEqual(['edr', 'parc'])
    })

    test('accepte une valeur seule sans la transformer en liste vide', () => {
        expect(entete('domaine_catalogue: [certificats]').domainesCatalogue).toEqual(['certificats'])
        expect(entete('domaine_catalogue: acces').domainesCatalogue).toEqual(['acces'])
    })
})
