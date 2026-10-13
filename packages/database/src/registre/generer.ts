#!/usr/bin/env bun
// ENGENDRE doc/Reglages.md DEPUIS LE REGISTRE.
//
// Le second est branché dans l'intégration continue. Sans lui, la documentation des
// réglages dériverait du code en quelques semaines, comme toute documentation tenue à la
// main — et une documentation fausse est pire qu'absente : on s'y fie.

import { readFileSync, writeFileSync } from "node:fs";
import { REGISTRE, RUBRIQUES, type Reglage } from "./index";

const CHEMIN = new URL('../../../../doc/Reglages.md', import.meta.url).pathname

const TYPES: Record<Reglage['type'], string> = {
    texte: 'texte',
    texte_long: 'texte long',
    nombre: 'nombre',
    booleen: 'oui / non',
    liste: 'liste, séparée par des virgules',
    secret: '**secret** — chiffré en base',
    modele: 'choisi dans la liste de l\'API',
}

function defautAffiche(r: Reglage): string {
    if (r.defaut === '') return '_vide_'
    return '`' + r.defaut + (r.unite ? ' ' + r.unite : '') + '`'
}

function engendrer(): string {
    const l: string[] = []

    l.push('# Réglages de l\'application')
    l.push('')
    l.push('> ⚠️ **Fichier engendré depuis `packages/database/src/registre/`. Ne pas le modifier à la main.**')
    l.push('> Pour changer un libellé ou une description, changez le registre puis lancez `bun run doc:reglages`.')
    l.push('> L\'intégration continue échoue si ce fichier diverge du registre.')
    l.push('')
    l.push('Ce que fait chaque réglage **dans l\'application**, une fois installée. Pour l\'installation')
    l.push('elle-même — fournisseur OIDC, variables d\'environnement, Docker — voir [Installation](Installation.md).')
    l.push('')
    l.push('Un réglage absent de la base **n\'est pas une valeur manquante** : c\'est le défaut du registre')
    l.push('qui s\'applique. Vider un champ revient donc à rétablir le défaut.')
    l.push('')

    // La portée « instance » mérite son propre encadré : c'est le mécanisme qui permet de
    // déployer une seconde instance sans toucher au code.
    const instance = REGISTRE.filter(r => r.portee === 'instance')
    l.push('## Ce qui distingue deux instances')
    l.push('')
    l.push('Un second déploiement — pour un autre public, par exemple — ne demande **aucune ligne de code**.')
    l.push('Seuls ces réglages changent, plus la liste des sources indexées :')
    l.push('')
    for (const r of instance) l.push(`- \`${r.cle}\` — ${r.libelle}`)
    l.push('')
    l.push('---')
    l.push('')

    for (const rubrique of RUBRIQUES) {
        l.push(`## ${rubrique}`)
        l.push('')
        l.push('| Réglage | Type | Défaut |')
        l.push('|---|---|---|')
        for (const r of REGISTRE.filter(x => x.rubrique === rubrique)) {
            l.push(`| \`${r.cle}\` | ${TYPES[r.type]} | ${defautAffiche(r)} |`)
        }
        l.push('')
        for (const r of REGISTRE.filter(x => x.rubrique === rubrique)) {
            l.push(`### ${r.libelle}`)
            l.push('')
            l.push(`\`${r.cle}\` · ${TYPES[r.type]} · défaut ${defautAffiche(r)}${r.portee === 'instance' ? ' · **portée instance**' : ''}`)
            l.push('')
            l.push(r.description)
            if (r.note) { l.push(''); l.push(`> ⚠️ ${r.note}`) }
            l.push('')
        }
    }

    return l.join('\n')
}

const attendu = engendrer()

if (process.argv.includes('--verifier')) {
    let actuel: string | null = null
    try { actuel = readFileSync(CHEMIN, 'utf-8') } catch { /* absent */ }

    if (actuel === null) {
        console.error('❌ doc/Reglages.md est absent. Lancez `bun run doc:reglages`.')
        process.exit(1)
    }
    if (actuel !== attendu) {
        console.error('❌ doc/Reglages.md diverge du registre.')
        console.error('   Un réglage a été ajouté, retiré ou décrit autrement sans régénérer la doc.')
        console.error('   Corrigez avec : bun run doc:reglages')
        process.exit(1)
    }
    console.log(`✅ doc/Reglages.md est à jour (${REGISTRE.length} réglages).`)
}
else {
    writeFileSync(CHEMIN, attendu)
    console.log(`✅ doc/Reglages.md engendré — ${REGISTRE.length} réglages, ${RUBRIQUES.length} rubriques.`)
}
