// EXTRACTION DE TEXTE.
//
// En TypeScript, sans Tika. L'argument de capacité qui a écarté Elasticsearch écarte
// pareillement une JVM : le serveur a onze gigaoctets disponibles et un swap saturé.

export type Resultat =
    | { texte: string, etat: 'complete' }
    | { texte: null, etat: 'none', motif: string }

const TEXTE_BRUT = /\.(md|markdown|txt|csv|json|ya?ml|adoc|rst)$/i

export async function extraire(chemin: string, octets: ArrayBuffer): Promise<Resultat> {
    const nom = chemin.toLowerCase()

    if (TEXTE_BRUT.test(nom)) {
        return { texte: new TextDecoder('utf-8').decode(octets), etat: 'complete' }
    }

    if (nom.endsWith('.pdf')) return extrairePdf(octets)
    if (nom.endsWith('.docx')) return extraireDocx(octets)
    if (/\.(odt|odp)$/.test(nom)) return extraireOpenDocument(octets, 'texte')
    if (nom.endsWith('.ods')) return extraireOpenDocument(octets, 'tableur')
    if (nom.endsWith('.xlsx')) return extraireXlsx(octets)

    return { texte: null, etat: 'none', motif: `format non pris en charge (${nom.split('.').pop()})` }
}

/**
 * Plafond de DÉCOMPRESSION, distinct de `taille_max` qui plafonne le fichier reçu.
 *
 * Ces formats sont des ZIP, et un ZIP se fabrique pour exploser à l'ouverture : quelques
 * kilo-octets qui se décompressent en gigaoctets. Les fichiers viennent de dossiers
 * partagés — déposés par des tiers, c'est le cas que ce module doit craindre. Le filtre de
 * `unzipSync` refuse l'entrée AVANT de la décompresser, et on ne décompresse que les
 * entrées dont on a besoin, jamais l'archive entière.
 */
const PLAFOND_DECOMPRESSE = 50_000_000

async function deballer(octets: ArrayBuffer, voulu: (nom: string) => boolean) {
    const { unzipSync, strFromU8 } = await import('fflate')
    const archive = unzipSync(new Uint8Array(octets), {
        filter: f => f.originalSize <= PLAFOND_DECOMPRESSE && voulu(f.name),
    })
    return { archive, lire: (nom: string) => archive[nom] ? strFromU8(archive[nom]!) : null }
}

/** Les cinq entités prédéfinies + les numériques. `&amp;` en dernier, sinon il en fabrique. */
function decoderEntites(s: string): string {
    return s
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
}

/**
 * ODT, ODP, ODS — OpenDocument : un ZIP dont `content.xml` porte tout le texte.
 *
 * Pas de vraie analyse XML : les balises de structure deviennent des séparateurs, le reste
 * tombe. C'est le bon niveau pour un index — on cherche des mots, pas une mise en page.
 * En mode `tableur`, les cellules deviennent des colonnes tabulées et les lignes des
 * lignes ; les paragraphes internes d'une cellule se joignent par une espace.
 */
async function extraireOpenDocument(octets: ArrayBuffer, mode: 'texte' | 'tableur'): Promise<Resultat> {
    try {
        const { lire } = await deballer(octets, n => n === 'content.xml')
        let xml = lire('content.xml')
        if (xml === null) {
            return { texte: null, etat: 'none', motif: 'content.xml absent ou au-delà du plafond de décompression' }
        }

        const corps = xml.match(/<office:body[\s>][\s\S]*<\/office:body>/)
        if (corps) xml = corps[0]

        xml = xml
            .replace(/<text:line-break\s*\/>/g, '\n')
            .replace(/<text:tab\s*\/>/g, '\t')
            .replace(/<\/table:table-cell>/g, '\t')
            .replace(/<\/table:table-row>/g, '\n')
            .replace(/<\/text:[ph]>/g, mode === 'tableur' ? ' ' : '\n')

        let propre = decoderEntites(xml.replace(/<[^>]+>/g, ''))
            .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
        // Une ligne vide de tableur ne porte rien — celles-ci viennent des retours à la
        // ligne littéraux du XML, pas des données.
        if (mode === 'tableur') propre = propre.split('\n').filter(l => l.trim()).join('\n')
        if (!propre) return { texte: null, etat: 'none', motif: 'document sans texte' }
        return { texte: propre, etat: 'complete' }
    }
    catch (e) {
        return { texte: null, etat: 'none', motif: `OpenDocument illisible : ${e instanceof Error ? e.message : e}` }
    }
}

/** Un nœud texte de fast-xml-parser : chaîne nue, ou `{'#text': …}` quand il a des attributs. */
function texteDe(t: unknown): string {
    if (typeof t === 'string') return t
    if (t && typeof t === 'object' && '#text' in (t as Record<string, unknown>)) {
        return String((t as Record<string, unknown>)['#text'])
    }
    return ''
}

/** Un `<si>` de sharedStrings : `<t>` direct, ou des tronçons enrichis `<r><t>`. */
function texteDeSi(si: unknown): string {
    const s = si as Record<string, unknown> | null
    if (s?.t !== undefined) return texteDe(s.t)
    return ([] as unknown[]).concat((s?.r as unknown[]) ?? [])
        .map(r => texteDe((r as Record<string, unknown>)?.t)).join('')
}

/**
 * XLSX — un ZIP : les textes vivent dans `xl/sharedStrings.xml`, les feuilles n'en portent
 * que les indices. On restitue feuille par feuille, cellules tabulées, lignes à la ligne.
 * Les dates restent des numéros de série Excel : imparfait et assumé — on indexe des mots,
 * et les dates utiles d'un classeur sont presque toujours aussi dans des libellés.
 */
async function extraireXlsx(octets: ArrayBuffer): Promise<Resultat> {
    try {
        const { XMLParser } = await import('fast-xml-parser')
        const { archive, lire } = await deballer(octets,
            n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
        // `removeNSPrefix` : la plupart des classeurs écrivent `<sst>`, certains outils
        // écrivent `<x:sst>` — le même document, deux graphies. `trimValues: false` : dans
        // un tronçon enrichi, l'espace de tête de `<t xml:space="preserve"> assemblé</t>`
        // est du texte, pas de la mise en forme XML.
        const parseur = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true, trimValues: false })

        const partagees: string[] = []
        const sst = lire('xl/sharedStrings.xml')
        if (sst !== null) {
            const j = parseur.parse(sst)
            for (const si of ([] as unknown[]).concat(j.sst?.si ?? [])) partagees.push(texteDeSi(si))
        }

        const cellule = (c: Record<string, unknown>): string => {
            const genre = String(c['@_t'] ?? '')
            if (genre === 's') return partagees[Number(texteDe(c.v))] ?? ''
            if (genre === 'inlineStr') return texteDeSi(c.is)
            return texteDe(c.v)
        }

        const feuilles = Object.keys(archive)
            .filter(n => n.startsWith('xl/worksheets/'))
            .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))

        const morceaux: string[] = []
        for (const nom of feuilles) {
            const j = parseur.parse(lire(nom)!)
            const lignes = ([] as unknown[]).concat(j.worksheet?.sheetData?.row ?? [])
            const rendu = lignes.map(l =>
                ([] as unknown[]).concat((l as Record<string, unknown>)?.c ?? [])
                    .map(c => cellule(c as Record<string, unknown>)).join('\t').trimEnd(),
            ).filter(Boolean).join('\n')
            if (rendu) morceaux.push(rendu)
        }

        const propre = morceaux.join('\n\n').trim()
        if (!propre) return { texte: null, etat: 'none', motif: 'classeur sans texte' }
        return { texte: propre, etat: 'complete' }
    }
    catch (e) {
        return { texte: null, etat: 'none', motif: `xlsx illisible : ${e instanceof Error ? e.message : e}` }
    }
}

async function extrairePdf(octets: ArrayBuffer): Promise<Resultat> {
    try {
        const { extractText, getDocumentProxy } = await import('unpdf')
        // `verbosity: 0` — erreurs seulement. Sans lui, PDF.js sème des « Warning: TT:
        // undefined function » (du hinting TrueType qu'il ne connaît pas, sans effet sur
        // le texte extrait) dans le journal de synchronisation, où ce bruit noie les
        // lignes d'ÉCHEC qui, elles, demandent une suite.
        const doc = await getDocumentProxy(new Uint8Array(octets), { verbosity: 0 })
        const { text } = await extractText(doc, { mergePages: true })
        const propre = String(text ?? '').replace(/\s+\n/g, '\n').trim()

        // Un PDF scanné rend quelques caractères parasites, pas rien du tout. Le seuil
        // évite qu'un document image passe pour un document texte quasi vide.
        if (propre.length < 40) {
            return { texte: null, etat: 'none', motif: 'PDF sans couche texte — document scanné, OCR non disponible' }
        }
        return { texte: propre, etat: 'complete' }
    }
    catch (e) {
        return { texte: null, etat: 'none', motif: `PDF illisible : ${e instanceof Error ? e.message : e}` }
    }
}

async function extraireDocx(octets: ArrayBuffer): Promise<Resultat> {
    try {
        const mammoth = await import('mammoth')
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(octets) })
        const propre = String(value ?? '').trim()
        if (!propre) return { texte: null, etat: 'none', motif: 'document sans texte' }
        return { texte: propre, etat: 'complete' }
    }
    catch (e) {
        return { texte: null, etat: 'none', motif: `docx illisible : ${e instanceof Error ? e.message : e}` }
    }
}
