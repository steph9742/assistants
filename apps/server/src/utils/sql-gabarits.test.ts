// UN ACCENT GRAVE DANS UNE REQUÊTE LA COUPE EN DEUX, ET RIEN NE LE DIT.
//
// Le défaut : un commentaire SQL citait l'opérateur de recouvrement entre accents graves,
// à l'intérieur d'un gabarit `sql`…``. L'accent grave a refermé le gabarit. Ce qui suivait
// — l'opérateur, puis la vraie condition avec ses valeurs interpolées en clair — devenait
// une expression JavaScript rendant une simple CHAÎNE, passée telle quelle à `db.execute`.
// Postgres recevait du texte non préparé, et toute question de données portant une
// déclaration de pont échouait.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Tous les fichiers TypeScript du serveur, sans les essais ni les dépendances. */
function sources(dossier: string, trouves: string[] = []): string[] {
    for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom)
        if (nom === 'node_modules') continue
        if (statSync(chemin).isDirectory()) { sources(chemin, trouves); continue }
        if (chemin.endsWith('.ts') && !chemin.endsWith('.test.ts')) trouves.push(chemin)
    }
    return trouves
}

/**
 * Repère chaque gabarit `sql`…`` et rend sa fin telle que JavaScript la voit : le contenu
 * jusqu'au premier accent grave non échappé, et ce qui suit immédiatement cet accent.
 *
 * On ne cherche pas à analyser du JavaScript. On lit exactement ce que l'interpréteur lira,
 * ce qui est justement le point : c'est l'écart entre l'intention et cette lecture-là qui a
 * produit le défaut.
 */
function gabarits(source: string): { ligne: number, contenu: string, suite: string }[] {
    const trouves: { ligne: number, contenu: string, suite: string }[] = []
    for (const m of source.matchAll(/\bsql`/g)) {
        const debut = m.index + m[0].length
        let i = debut
        while (i < source.length) {
            if (source[i] === '\\') { i += 2; continue }
            // `${…}` peut contenir des accents graves qui ne ferment pas le gabarit.
            if (source[i] === '$' && source[i + 1] === '{') {
                let prof = 1
                i += 2
                while (i < source.length && prof > 0) {
                    if (source[i] === '{') prof++
                    else if (source[i] === '}') prof--
                    i++
                }
                continue
            }
            if (source[i] === '`') break
            i++
        }
        trouves.push({
            ligne: source.slice(0, debut).split('\n').length,
            contenu: source.slice(debut, i),
            suite: source.slice(i + 1, i + 40),
        })
    }
    return trouves
}

describe('les gabarits SQL se referment là où on croit', () => {
    const fichiers = sources(join(import.meta.dir, '..'))

    test('aucune requête ne se termine au milieu d\'un commentaire', () => {
        const coupes: string[] = []
        for (const f of fichiers) {
            for (const g of gabarits(readFileSync(f, 'utf-8'))) {
                // Une requête légitime ne s'arrête jamais sur une ligne de commentaire :
                // c'est la signature exacte d'un accent grave cité dans une explication.
                const derniere = g.contenu.split('\n').at(-1) ?? ''
                if (derniere.includes('--')) coupes.push(`${f}:${g.ligne}`)
            }
        }
        expect(coupes).toEqual([])
    })

    test('ce qui suit la requête est bien une fin d\'expression', () => {
        const suspects: string[] = []
        for (const f of fichiers) {
            for (const g of gabarits(readFileSync(f, 'utf-8'))) {
                // Après l'accent grave fermant vient une clôture d'appel, un séparateur, un
                // enchaînement, une branche de ternaire — tout cela est légitime. Ce qui ne
                // l'est jamais, c'est un OPÉRATEUR DE CALCUL : une requête n'est pas un
                // terme qu'on additionne ni une condition qu'on combine. « && », « || »,
                // « + », « ?? » après un gabarit signent une requête coupée trop tôt, dont
                // la seconde moitié est devenue du JavaScript. On refuse ceux-là, et eux
                // seuls : un contrôle qui crie sur des tournures correctes finit désactivé.
                if (/^\s*(&&|\|\||\?\?|\+)/.test(g.suite)) suspects.push(`${f}:${g.ligne} → « ${g.suite.trim().slice(0, 30)} »`)
            }
        }
        expect(suspects).toEqual([])
    })

    test('le contrôle sait reconnaître le défaut qu\'il surveille', () => {
        // Le défaut réel, réduit : sans cette vérification, le contrôle passerait sur tout.
        const casse = 'const r = db.execute(sql`SELECT 1\n  -- `&&` : deux listes\n  WHERE a && b`)'
        const g = gabarits(casse)
        expect(g).toHaveLength(1)
        expect((g[0]!.contenu.split('\n').at(-1) ?? '').includes('--')).toBe(true)
        expect(/^\s*(&&|\|\||\?\?|\+)/.test(g[0]!.suite)).toBe(true)
    })
})
