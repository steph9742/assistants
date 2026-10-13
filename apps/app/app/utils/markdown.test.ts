import { describe, expect, it } from 'bun:test'
import { rendreMarkdown } from './markdown'

// Ces essais ne vérifient pas une mise en forme : ils vérifient une affirmation de sécurité.
// Le texte rendu ici vient d'un modèle, qui a lu des documents indexés que la règle 3
// déclare non fiables. Si l'un de ces essais tombe, ce n'est pas un défaut d'apparence.

describe('rien du texte ne devient du HTML', () => {
    it('échappe une balise de script', () => {
        const html = rendreMarkdown('<script>alert(1)</script>')
        expect(html).not.toContain('<script>')
        expect(html).toContain('&lt;script&gt;')
    })

    it('échappe un gestionnaire d\'événement dans une balise', () => {
        const html = rendreMarkdown('<img src=x onerror="alert(1)">')
        expect(html).not.toContain('<img')
        expect(html).toContain('&lt;img')
        expect(html).not.toContain('onerror="')
    })

    it('refuse un lien javascript: et le laisse en texte', () => {
        const html = rendreMarkdown('[cliquez](javascript:alert(1))')
        expect(html).not.toContain('href="javascript:')
        expect(html).toContain('[cliquez]')
    })

    it('refuse un lien data: et le laisse en texte', () => {
        expect(rendreMarkdown('[x](data:text/html,<b>)')).not.toContain('href="data:')
    })

    it('rend un lien http en nouvelle fenêtre sans laisser la page ouverte', () => {
        const html = rendreMarkdown('[fiche](https://exemple.fr/a)')
        expect(html).toContain('href="https://exemple.fr/a"')
        expect(html).toContain('rel="noopener noreferrer"')
    })

    it('ne laisse pas une balise passer par un bloc de code', () => {
        expect(rendreMarkdown('```\n<script>x</script>\n```')).not.toContain('<script>')
    })
})

describe('mise en forme', () => {
    it('rend les titres sous le h1 de la page', () => {
        expect(rendreMarkdown('## Conduite à tenir')).toContain('<h4')
    })

    it('rend une liste à puces en un seul ul', () => {
        const html = rendreMarkdown('- un\n- deux\n- trois')
        expect(html.match(/<ul/g)?.length).toBe(1)
        expect(html.match(/<li>/g)?.length).toBe(3)
    })

    it('sépare une liste numérotée d\'une liste à puces', () => {
        const html = rendreMarkdown('- a\n\n1. b')
        expect(html).toContain('<ul')
        expect(html).toContain('<ol')
    })

    it('rend le gras et le code en ligne', () => {
        const html = rendreMarkdown('la règle **Sigma** est dans `regles/sigma.yml`')
        expect(html).toContain('<strong>Sigma</strong>')
        expect(html).toContain('>regles/sigma.yml</code>')
    })

    it('rend une citation Markdown', () => {
        expect(rendreMarkdown('> texte engendré')).toContain('<blockquote')
    })

    // Le repère interne des extraits de code était un nombre entre deux espaces : sur un
    // corpus qui parle de décomptes, « 4 797 règles » suffisait à faire réapparaître un
    // extrait de code au milieu d'une phrase.
    it('ne confond pas un nombre isolé avec un extrait de code', () => {
        const html = rendreMarkdown('`origine` vaut établissement pour 40 règles sur 4797')
        expect(html).toContain('>origine</code>')
        expect(html).toContain('40')
        expect(html.match(/<code/g)?.length).toBe(1)
    })

    // Un document indexé pourrait contenir le caractère servant de repère.
    it('résiste à un texte contenant le caractère de repère', () => {
        const html = rendreMarkdown('avant \uE0000\uE000 après `vrai`')
        expect(html).toContain('>vrai</code>')
        expect(html.match(/<code/g)?.length).toBe(1)
    })

    it('ne laisse pas un bloc de code non refermé casser le rendu', () => {
        const html = rendreMarkdown('```\nligne')
        expect(html.match(/<pre/g)?.length).toBe(1)
        expect(html).toContain('</code></pre>')
    })

    it('ne transforme pas une étoile de commande en italique', () => {
        expect(rendreMarkdown('`chmod 600 /etc/*.conf`')).not.toContain('<em>')
    })
})

describe('tableaux', () => {
    const t = [
        '| Incident | Gravité | Détecté le |',
        '|---|---|---|',
        '| INC-2026-041 | P1 | 12/08/2026 |',
        '| INC-2026-038 | P3 | 04/08/2026 |',
    ].join('\n')

    it('rend un tableau avec son en-tête et ses lignes', () => {
        const html = rendreMarkdown(t)
        expect(html).toContain('<table')
        expect(html.match(/<th /g)?.length).toBe(3)
        expect(html.match(/<tr>/g)?.length).toBe(3)
        expect(html).toContain('INC-2026-041')
    })

    // Un tableau large doit défiler chez lui, jamais faire déborder la page.
    it('enferme le tableau dans son propre conteneur défilant', () => {
        expect(rendreMarkdown(t)).toContain('overflow-x-auto')
    })

    it('respecte les alignements de la ligne de séparation', () => {
        const html = rendreMarkdown('| a | b | c |\n|:--|--:|:-:|\n| 1 | 2 | 3 |')
        expect(html).toContain('text-align:left')
        expect(html).toContain('text-align:right')
        expect(html).toContain('text-align:center')
    })

    it('tolère les tableaux sans barres extérieures', () => {
        expect(rendreMarkdown('a | b\n--- | ---\n1 | 2')).toContain('<table')
    })

    /**
     * Le piège du corpus : chemins, expressions de règles et alternatives de requête
     * contiennent des barres verticales. Sans la ligne de séparation pour trancher, une
     * phrase ordinaire deviendrait un tableau d'une colonne.
     */
    it('ne prend pas une phrase contenant une barre verticale pour un tableau', () => {
        const html = rendreMarkdown('La règle filtre sur `nom | description | valeur`.')
        expect(html).not.toContain('<table')
        expect(html).toContain('<p')
    })

    it('ne transforme pas une liste à tirets en séparateur de tableau', () => {
        const html = rendreMarkdown('- un\n- deux')
        expect(html).not.toContain('<table')
        expect(html).toContain('<ul')
    })

    it('échappe le contenu des cellules comme le reste', () => {
        const html = rendreMarkdown('| a |\n|---|\n| <script>x</script> |')
        expect(html).not.toContain('<script>')
        expect(html).toContain('&lt;script&gt;')
    })

    it('rend les marques en ligne dans les cellules', () => {
        const html = rendreMarkdown('| a |\n|---|\n| **gras** et `code` |')
        expect(html).toContain('<strong>gras</strong>')
        expect(html).toContain('>code</code>')
    })

    it('reprend le rendu normal après le tableau', () => {
        const html = rendreMarkdown('| a |\n|---|\n| 1 |\n\nUne phrase après.')
        expect(html).toContain('</table>')
        expect(html).toContain('Une phrase après.')
    })
})

/**
 * Le modèle encadre certaines mises en garde d'astérisques et pas d'autres — la première en
 * texte simple, les cinq suivantes en italique. L'irrégularité laisse croire à une
 * hiérarchie qui n'existe pas. Corrigé au rendu plutôt qu'en consigne : déterministe, sans
 * effet sur le texte engendré ni sur ce qui est copié.
 */
describe('une ligne entièrement en italique', () => {
    it('perd son emphase, qui ne distinguait rien', () => {
        expect(rendreMarkdown('*ANGLE MORT sur la conformité.*')).toContain('ANGLE MORT sur la conformité.')
        expect(rendreMarkdown('*ANGLE MORT sur la conformité.*')).not.toContain('<em>')
    })

    it("laisse intacte l'emphase partielle, qui distingue un mot", () => {
        // C'est le sens de l'italique : celle qui recouvre toute la ligne ne distingue plus.
        expect(rendreMarkdown('Le total porte sur *l\'ensemble*, pas sur la restriction.'))
            .toContain('<em>')
    })

    it('ne touche ni aux listes ni au gras', () => {
        expect(rendreMarkdown('* un élément')).toContain('<li')
        expect(rendreMarkdown('**tout en gras**')).toContain('<strong>')
    })
})
