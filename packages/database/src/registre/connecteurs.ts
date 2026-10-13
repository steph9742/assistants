#!/usr/bin/env bun
// Engendre doc/Connecteurs.md depuis les descripteurs de types de source.
//
//   bun run doc:connecteurs
//   bun run doc:connecteurs --verifier

import { readFileSync, writeFileSync } from "node:fs";
import { DESCRIPTEURS, type ChampSource } from "./sources";

const CHEMIN = new URL('../../../../doc/Connecteurs.md', import.meta.url).pathname

const TYPES: Record<ChampSource['type'], string> = {
    texte: 'texte',
    liste: 'liste, séparée par des virgules',
    nombre: 'nombre',
    booleen: 'oui / non',
}

function engendrer(): string {
    const l: string[] = []
    l.push("# Connecteurs")
    l.push('')
    l.push('> ⚠️ **Fichier engendré depuis `packages/database/src/registre/sources.ts`. Ne pas le modifier à la main.**')
    l.push('> `bun run doc:connecteurs` le régénère ; l\'intégration continue échoue s\'il diverge.')
    l.push('')
    l.push("Ce que chaque type de source demande pour fonctionner. Tout se saisit dans l'écran")
    l.push("**Sources**, rien ne se met dans un fichier de configuration.")
    l.push('')
    l.push('Deux natures, et la différence est de fond :')
    l.push('')
    l.push('| Nature | Ce qui se passe |')
    l.push('|---|---|')
    l.push('| `index` | les documents sont découpés et rangés dans l\'index, puis cherchés |')
    l.push('| `donnees` | la source est interrogée **au moment de la question**, jamais indexée |')
    l.push('')
    l.push("On n'indexe pas un incident : une donnée vivante recopiée dans un index est fausse dès")
    l.push("la minute suivante, et elle a l'air aussi vraie que les autres.")
    l.push('')

    for (const d of DESCRIPTEURS) {
        l.push('---')
        l.push('')
        l.push(`## ${d.libelle}`)
        l.push('')
        l.push(`\`${d.type}\` · nature **${d.nature}** · catégorie par défaut \`${d.categorieDefaut}\``)
        l.push('')
        l.push(d.description)
        l.push('')

        if (d.secret) {
            l.push(`### ${d.secret.libelle}`)
            l.push('')
            l.push(d.secret.description)
            if (d.secret.note) { l.push(''); l.push(`> ⚠️ ${d.secret.note}`) }
            l.push('')
        }

        l.push('### Champs')
        l.push('')
        l.push('| Champ | Type | Obligatoire | Défaut |')
        l.push('|---|---|---|---|')
        for (const c of d.champs) {
            l.push(`| \`${c.cle}\` | ${TYPES[c.type]} | ${c.obligatoire ? '**oui**' : 'non'} | ${c.defaut ? '`' + c.defaut + '`' : '—'} |`)
        }
        l.push('')
        for (const c of d.champs) {
            l.push(`**${c.libelle}** — \`${c.cle}\``)
            l.push('')
            l.push(c.description ?? '')
            if (c.exemple) { l.push(''); l.push(`Exemple : \`${c.exemple}\``) }
            if (c.note) { l.push(''); l.push(`> ⚠️ ${c.note}`) }
            l.push('')
        }
    }
    return l.join('\n')
}

const attendu = engendrer()

if (process.argv.includes('--verifier')) {
    let actuel: string | null = null
    try { actuel = readFileSync(CHEMIN, 'utf-8') } catch { /* absent */ }
    if (actuel !== attendu) {
        console.error('❌ doc/Connecteurs.md diverge des descripteurs. Corrigez avec : bun run doc:connecteurs')
        process.exit(1)
    }
    console.log(`✅ doc/Connecteurs.md est à jour (${DESCRIPTEURS.length} types).`)
}
else {
    writeFileSync(CHEMIN, attendu)
    console.log(`✅ doc/Connecteurs.md engendré — ${DESCRIPTEURS.length} types de source.`)
}
