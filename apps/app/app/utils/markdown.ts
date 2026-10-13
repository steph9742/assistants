
// RENDU MARKDOWN DÉLIBÉRÉMENT LIMITÉ.
//
// D'où deux décisions.

import { cleCitation, MARQUEUR, resoudreMarqueur, type SourceReperee } from './citations'

/** Toujours en premier. Rien de ce qui suit ne peut réintroduire de balise. */
export function echapper(t: string): string {
    return t
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

// REPÈRE DES EXTRAITS DE CODE.
//
// Un repère fait de caractères ordinaires (` 0 `, `[[0]]`) finit par être produit par le
// texte lui-même : sur un corpus qui parle de décomptes, un nombre isolé entre deux espaces
// s'afficherait comme un extrait de code. On prend donc un caractère de la zone à usage
// privé, écrit sous forme d'échappement pour ne pas glisser d'octet de contrôle dans le
// source — et on le retire du texte AVANT de s'en servir, faute de quoi un document qui en
// contiendrait un pourrait déplacer les extraits de code d'une réponse.
const REPERE = '\uE000'

/**
 * Marques en ligne, appliquées APRÈS l'échappement.
 *
 * Le code est traité en premier et son contenu mis de côté : sans cela, une étoile dans un
 * extrait de commande deviendrait de l'italique, et une règle de détection s'afficherait
 * fausse. Sur cet outil, ce serait plus grave qu'un défaut de mise en forme.
 */
function enLigne(t: string, sources: SourceReperee[] = []): string {
    const codes: string[] = []
    let s = t.split(REPERE).join('').replace(/`([^`]+)`/g, (_, c) => {
        codes.push(c)
        return `${REPERE}${codes.length - 1}${REPERE}`
    })

    s = s
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        // Liens : http et https seulement. Un `javascript:` ou un `data:` reste du texte.
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline decoration-stone-400 hover:decoration-stone-900">$1</a>')

    // MARQUEURS DE CITATION — après les liens, pour ne pas toucher à ce qui en est déjà un.
    //
    // Un marqueur ne devient cliquable QUE s'il correspond à une source réellement présente
    // sous la réponse : pas de résolution, pas d'ancre, et le texte reste tel quel. C'est la
    // même règle que côté corpus — une désignation qui ne mène nulle part est pire
    // qu'absente, parce qu'elle a l'air de mener quelque part.
    if (sources.length) {
        s = s.replace(MARQUEUR, (entier, interieur: string) => {
            const c = resoudreMarqueur(interieur, sources)
            if (!c) return entier
            return `<a href="#src-${cleCitation(c)}" data-cite="${cleCitation(c)}"`
                + ` class="rounded bg-stone-100 px-1 text-[0.92em] text-stone-600 underline decoration-stone-300`
                + ` decoration-dotted hover:bg-stone-200 hover:text-stone-900">${entier}</a>`
        })
    }

    return s.replace(new RegExp(`${REPERE}(\\d+)${REPERE}`, 'g'),
        (_, i) => `<code class="rounded bg-stone-100 px-1 py-0.5 font-geistmono text-[0.9em]">${codes[Number(i)]}</code>`)
}

/**
 * La ligne de séparation d'un tableau, et elle seule.
 *
 * `|---|---:|:--:|` avec ou sans barres extérieures. C'est ce motif qui décide qu'on est
 * dans un tableau : se fier à la présence d'une barre verticale prendrait pour un tableau
 * toute phrase qui en contient une, et ce corpus en contient — chemins, expressions de
 * règles, alternatives de requête.
 */
const SEPARATEUR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

/** Découpe une ligne de tableau, sans se laisser abuser par les barres extérieures. */
function cellules(ligne: string): string[] {
    const t = ligne.trim().replace(/^\|/, '').replace(/\|$/, '')
    return t.split('|').map(c => c.trim())
}

/**
 * Rend le Markdown en HTML sûr. Exportée séparément du composant pour être testable :
 * l'affirmation « rien du modèle ne devient du HTML » n'a de valeur que vérifiée.
 */
/**
 * UNE LIGNE ENTIÈREMENT EN ITALIQUE NE PORTE AUCUNE INFORMATION.
 *
 * Le modèle encadre certaines mises en garde d'astérisques et pas d'autres : la première en
 * texte simple, les cinq suivantes en italique. Rien n'est cassé, mais l'irrégularité saute
 * aux yeux et laisse croire à une hiérarchie qui n'existe pas.
 */
function retirerItaliqueDeLigneEntiere(ligne: string): string {
    const m = /^\s*\*([^*].*[^*])\*\s*$/.exec(ligne)
    return m && !m[1]!.includes('*') ? m[1]! : ligne
}

export function rendreMarkdown(texte: string, sources: SourceReperee[] = []): string {
    const lignes = echapper(texte).split('\n').map(retirerItaliqueDeLigneEntiere)
    const sortie: string[] = []
    let liste: 'ul' | 'ol' | null = null
    let dansCode = false
    let tampon: string[] = []

    const fermerListe = () => { if (liste) { sortie.push(`</${liste}>`); liste = null } }
    const viderTampon = () => {
        if (!tampon.length) return
        sortie.push(`<p class="my-2 max-w-[70ch]">${enLigne(tampon.join('<br>'), sources)}</p>`)
        tampon = []
    }

    for (let i = 0; i < lignes.length; i++) {
        const ligne = lignes[i]!
        if (/^```/.test(ligne.trim())) {
            viderTampon(); fermerListe()
            sortie.push(dansCode
                ? '</code></pre>'
                : '<pre class="my-2 overflow-x-auto rounded-lg bg-stone-100 p-3"><code class="font-geistmono text-xs">')
            dansCode = !dansCode
            continue
        }
        if (dansCode) { sortie.push(ligne); continue }

        if (!ligne.trim()) { viderTampon(); fermerListe(); continue }

        const titre = /^(#{1,4})\s+(.*)$/.exec(ligne)
        if (titre) {
            viderTampon(); fermerListe()
            const n = Math.min(titre[1]!.length + 2, 6)
            sortie.push(`<h${n} class="mt-4 mb-1 max-w-[70ch] font-semibold">${enLigne(titre[2]!, sources)}</h${n}>`)
            continue
        }

        // Le chevron a déjà été échappé en `&gt;` : c'est cette forme qu'on reconnaît.
        const citation = /^&gt;\s?(.*)$/.exec(ligne)
        if (citation) {
            viderTampon(); fermerListe()
            sortie.push(`<blockquote class="my-2 max-w-[70ch] border-l-2 border-stone-300 pl-3 text-stone-600">${enLigne(citation[1]!, sources)}</blockquote>`)
            continue
        }

        // TABLEAU — reconnu à sa ligne de séparation, jamais à la seule présence de `|`.
        //
        // Une phrase qui contient une barre verticale n'est pas un tableau, et il y en a
        // dans ce corpus : chemins, expressions de règles de détection, alternatives de
        // `to_tsquery`. C'est la ligne `|---|---|` qui tranche, et elle est sans ambiguïté.
        const suivante = lignes[i + 1]
        if (ligne.includes('|') && suivante && SEPARATEUR.test(suivante)) {
            viderTampon(); fermerListe()
            const alignements = cellules(suivante).map(c =>
                c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : 'left')
            const entete = cellules(ligne)

            const corps: string[][] = []
            let j = i + 2
            while (j < lignes.length && lignes[j]!.includes('|') && lignes[j]!.trim()) {
                corps.push(cellules(lignes[j]!))
                j++
            }
            i = j - 1

            const td = (c: string, n: number, balise: 'th' | 'td') => {
                const a = alignements[n] ?? 'left'
                const classe = balise === 'th'
                    ? 'border-b border-stone-300 px-2 py-1 font-medium'
                    : 'border-b border-stone-100 px-2 py-1 align-top'
                return `<${balise} class="${classe}" style="text-align:${a}">${enLigne(c, sources)}</${balise}>`
            }

            // Enveloppé dans son propre conteneur défilant : un tableau large doit défiler
            // chez lui, jamais faire déborder la page.
            sortie.push(
                '<div class="my-3 overflow-x-auto"><table class="w-full border-collapse text-left text-sm">'
                + `<thead><tr>${entete.map((c, n) => td(c, n, 'th')).join('')}</tr></thead>`
                + `<tbody>${corps.map(r => `<tr>${r.map((c, n) => td(c, n, 'td')).join('')}</tr>`).join('')}</tbody>`
                + '</table></div>')
            continue
        }

        const puce = /^\s*[-*+]\s+(.*)$/.exec(ligne)
        const numero = /^\s*\d+[.)]\s+(.*)$/.exec(ligne)
        if (puce || numero) {
            viderTampon()
            const voulue = puce ? 'ul' : 'ol'
            if (liste !== voulue) {
                fermerListe()
                sortie.push(voulue === 'ul'
                    ? '<ul class="my-2 max-w-[70ch] list-disc space-y-0.5 pl-5">'
                    : '<ol class="my-2 max-w-[70ch] list-decimal space-y-0.5 pl-5">')
                liste = voulue
            }
            sortie.push(`<li>${enLigne((puce ?? numero)![1]!, sources)}</li>`)
            continue
        }

        fermerListe()
        tampon.push(ligne)
    }

    viderTampon(); fermerListe()
    // Une clôture de bloc manquante n'est pas une raison de rendre du HTML cassé.
    if (dansCode) sortie.push('</code></pre>')
    return sortie.join('\n')
}
