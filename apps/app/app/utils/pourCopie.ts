import type { Citation, Origine } from '~/composables/useApi'

// CE QU'ON EMPORTE HORS DE L'ÉCRAN.
//
// Le bouton copie du Markdown, pas le rendu — c'est ce qui a été demandé, et c'est aussi ce
// qui se recolle proprement dans un ticket, un compte rendu ou un courriel.

function ligneCitation(c: Citation): string {
    const bouts = [c.reference, c.titre, c.section].filter(Boolean).join(' — ')
    const etat = [c.statut, c.version, c.dateRevision].filter(Boolean).join(', ')
    const corps = etat ? `${bouts} (${etat})` : bouts
    return c.url ? `- [${corps}](${c.url})` : `- ${corps}`
}

export function pourCopie(r: {
    texte: string
    citations?: Citation[]
    nonIndexables?: Citation[]
    origine: Origine
}): string {
    const morceaux = [r.texte.trim()]

    if (r.citations?.length) {
        morceaux.push(`## Sources\n\n${r.citations.map(ligneCitation).join('\n')}`)
    }

    if (r.nonIndexables?.length) {
        morceaux.push(
            '## Documents trouvés mais non lisibles\n\n'
            + `${r.nonIndexables.map(ligneCitation).join('\n')}\n\n`
            + "Leur contenu n'a pas pu être extrait ; ils ne fondent aucune affirmation ci-dessus.",
        )
    }

    // En citation Markdown : visible, mais typographiquement distincte du texte, y compris
    // dans un outil qui ne rend pas le Markdown.
    morceaux.push(
        '> Texte engendré par un modèle de langage — à vérifier avant usage.\n'
        // Les étapes suivent le modèle de rédaction : un texte copié dans un dossier doit
        // dire qui l'a formé, à chaque étape qui a changé de modèle. C'est la règle 7, et
        // elle ne vaut rien si elle s'arrête à l'écran.
        + `> Modèle \`${r.origine.modele}\``
        + Object.entries(r.origine.etapes ?? {}).map(([e, m]) => ` · ${e} \`${m}\``).join('')
        + ` · consigne \`${r.origine.consigne}\` · `
        + `${new Date(r.origine.date).toLocaleString('fr-FR')}`,
    )

    return morceaux.join('\n\n')
}
