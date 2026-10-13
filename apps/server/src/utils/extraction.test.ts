import { describe, expect, it } from 'bun:test'
import { strToU8, zipSync } from 'fflate'
import { extraire } from './extraction'

// Les gabarits sont FABRIQUÉS ici, pas stockés : un binaire en dépôt ne se relit pas, et
// ces formats sont des ZIP de XML — les construire rend l'essai lisible d'un bloc.
function archive(entrees: Record<string, string>): ArrayBuffer {
    const z = zipSync(Object.fromEntries(Object.entries(entrees).map(([n, c]) => [n, strToU8(c)])))
    return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer
}

describe('extraction OpenDocument', () => {
    it('lit un odt : titres, paragraphes, sauts de ligne, entités', async () => {
        const contenu = `<?xml version="1.0"?><office:document-content><office:body><office:text>
<text:h>Plan de reprise</text:h>
<text:p>Premier &amp; second</text:p>
<text:p>Avant<text:line-break/>apr&#232;s</text:p>
</office:text></office:body></office:document-content>`
        const r = await extraire('note.odt', archive({ 'content.xml': contenu }))
        expect(r.etat).toBe('complete')
        expect(r.texte).toContain('Plan de reprise')
        expect(r.texte).toContain('Premier & second')
        expect(r.texte).toContain('Avant\naprès')
    })

    it('lit un ods : cellules tabulées, une ligne par ligne', async () => {
        const contenu = `<?xml version="1.0"?><office:document-content><office:body><office:spreadsheet><table:table>
<table:table-row><table:table-cell><text:p>Nom</text:p></table:table-cell><table:table-cell><text:p>Rôle</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>GLPI</text:p></table:table-cell><table:table-cell><text:p>tickets</text:p></table:table-cell></table:table-row>
</table:table></office:spreadsheet></office:body></office:document-content>`
        const r = await extraire('correspondants.ods', archive({ 'content.xml': contenu }))
        expect(r.etat).toBe('complete')
        const lignes = (r.texte ?? '').split('\n')
        expect(lignes[0]).toMatch(/^Nom\s+Rôle$/)
        expect(lignes[1]).toMatch(/^GLPI\s+tickets$/)
    })

    it('ne fait pas passer une archive sans content.xml pour un document vide', async () => {
        const r = await extraire('x.odt', archive({ 'autre.xml': '<a/>' }))
        expect(r.etat).toBe('none')
        if (r.etat === 'none') expect(r.motif).toContain('content.xml')
    })

    it('dit « illisible » sur un fichier qui n\'est pas un ZIP', async () => {
        const r = await extraire('x.odt', strToU8('pas une archive').buffer as ArrayBuffer)
        expect(r.etat).toBe('none')
        if (r.etat === 'none') expect(r.motif).toContain('illisible')
    })
})

describe('extraction xlsx', () => {
    it('résout les chaînes partagées, les chaînes en ligne et les nombres', async () => {
        const sst = `<?xml version="1.0"?><sst><si><t>Entité</t></si><si><t xml:space="preserve">UFR ST</t></si><si><r><t>riche</t></r><r><t> assemblé</t></r></si></sst>`
        const feuille = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>en ligne</t></is></c></row>
</sheetData></worksheet>`
        const r = await extraire('correspondants.xlsx',
            archive({ 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': feuille }))
        expect(r.etat).toBe('complete')
        const lignes = (r.texte ?? '').split('\n')
        expect(lignes[0]).toMatch(/^Entité\s+UFR ST$/)
        expect(lignes[1]).toMatch(/^riche assemblé\s+42$/)
        expect(lignes[2]).toBe('en ligne')
    })

    it('dit « classeur sans texte » plutôt que de rendre une chaîne vide', async () => {
        const r = await extraire('vide.xlsx',
            archive({ 'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>' }))
        expect(r.etat).toBe('none')
        if (r.etat === 'none') expect(r.motif).toContain('sans texte')
    })
})

describe('formats toujours hors de portée', () => {
    it('nomme le format plutôt que d\'échouer en silence', async () => {
        const r = await extraire('dessin.odg', archive({ 'content.xml': '<office:body/>' }))
        expect(r.etat).toBe('none')
        if (r.etat === 'none') expect(r.motif).toContain('odg')
    })
})
