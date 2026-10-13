// LECTURE D'UN FLUX D'ÉVÉNEMENTS.
//
// Le réseau ne livre pas des messages, il livre des octets : un événement peut arriver
// coupé en deux paquets, et deux événements peuvent arriver dans le même. Un découpage naïf
// perd le premier cas en silence — l'étape n'apparaît jamais, et rien ne dit pourquoi.

/** Recolle les trames `data: …` d'un flux d'événements, en gardant le reste pour la suite. */
export function decouperTrames(tampon: string): { evenements: unknown[], reste: string } {
    const blocs = tampon.split('\n\n')
    // Le dernier morceau n'est pas terminé par une ligne vide : il attend le paquet suivant.
    const reste = blocs.pop() ?? ''
    const evenements: unknown[] = []

    for (const bloc of blocs) {
        const ligne = bloc.split('\n').find(l => l.startsWith('data: '))
        if (!ligne) continue
        // Une trame illisible ne doit pas interrompre le flux : la réponse arrive après.
        try { evenements.push(JSON.parse(ligne.slice(6))) }
        catch { /* trame ignorée */ }
    }
    return { evenements, reste }
}
