// EMBEDDINGS — moitié sémantique de la recherche, facultative par conception.
//
// Ce n'est pas un pis-aller. Le vocabulaire du corpus est très littéral — `knowledge_at`,
// `INC-03`, `DPD`, `mailmaster`, `legitimate` — et sur 482 passages la recherche lexicale
// en configuration `french` y est déjà bonne.

import { lire, lireBooleen, lireNombre, lirePlusieurs } from "./reglages";

const ROUTES = ['/api/embeddings', '/v1/embeddings', '/api/v1/embeddings']

/** La dernière route qui a répondu, pour ne pas rejouer les 404 à chaque passage. */
let routeConnue: string | null = null

/** Les vecteurs qu'on n'a pas pu calculer, et pourquoi. Vidé par `bilanVecteurs()`. */
const manques: { role: Role, taille: number, causes: string }[] = []

/**
 * Dimensions attendues par le schéma. Changer de modèle impose une réindexation.
 *
 * 1024, celles de `bge-m3`. On avait d'abord retenu 768 et `multilingual-e5-base` : le
 * chiffrage était faux, et la mesure l'a montré.
 */
export const DIMENSIONS = 1024

/**
 * Question ou passage — les modèles d'embedding ne les traitent PAS de la même façon.
 *
 * Les E5 sont entraînés avec « query: » devant une question et « passage: » devant un texte
 * indexé. Sans ces préfixes, la qualité se dégrade nettement et SILENCIEUSEMENT : les scores
 * gardent une apparence normale. C'est le pire mode de dégradation qui soit, et il ne se
 * verrait qu'en comparant des réponses sur des semaines.
 */
export type Role = 'question' | 'passage'

async function prefixer(texte: string, role: Role): Promise<string> {
    const cle = role === 'question' ? 'embeddings.prefixe_question' : 'embeddings.prefixe_passage'
    return `${await lire(cle)}${texte}`
}

/**
 * LA TRONCATURE EST SILENCIEUSE, ET C'EST CE QUI LA REND DANGEREUSE.
 *
 * Les modèles d'embedding usuels plafonnent à 512 jetons. Au-delà, le serveur tronque — sans
 * erreur, sans avertissement, en rendant un vecteur d'apparence normale qui ne représente
 * que le début du texte. La fin d'une procédure disparaîtrait de l'espace sémantique et
 * personne ne le saurait.
 */
/**
 * Le seuil DÉPEND DU MODÈLE, il ne se pose pas au jugé.
 *
 * Il se calcule maintenant depuis `embeddings.jetons_max`, à raison d'environ 3,5 caractères
 * par jeton en français — prudent, un texte technique en consomme davantage. Changer de
 * modèle change le réglage, et le seuil suit.
 */
let tronquesSignales = 0

async function longueurSansTroncature(): Promise<number> {
    return Math.round(await lireNombre('embeddings.jetons_max') * 3.5)
}

function signalerSiTropLong(texte: string, role: Role, seuil: number): void {
    if (texte.length <= seuil) return
    tronquesSignales++
    // Une ligne par passage noierait le journal d'une synchronisation complète. On dit les
    // cinq premiers, puis on compte.
    if (tronquesSignales <= 5) {
        console.warn(`embeddings: ${role} de ${texte.length} caractères, probablement TRONQUÉ par le modèle `
            + `(au-delà de la fenêtre du modèle). Sa fin ne sera pas représentée dans le vecteur. `
            + `Début : « ${texte.slice(0, 80).replace(/\s+/g, ' ')}… »`)
    }
    else if (tronquesSignales === 6) {
        console.warn('embeddings: passages trop longs suivants signalés en bloc à la fin.')
    }
}

/**
 * Ce qu'on n'a pas pu vectoriser, et pourquoi. À dire en fin de synchronisation.
 *
 * Rendre `null` en silence était le défaut : 0,8 % du corpus est resté hors de la moitié
 * sémantique sans qu'aucune ligne ne le dise. Un index à trous qui ne se plaint pas est
 * exactement le mode de panne que ce projet combat.
 */
export function bilanVecteurs(): string | null {
    if (!manques.length) return null
    const n = manques.length
    const parCause = new Map<string, number>()
    for (const m of manques) parCause.set(m.causes, (parCause.get(m.causes) ?? 0) + 1)
    const detail = [...parCause].sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([c, k]) => `${k}× ${c}`).join(' · ')
    manques.length = 0
    return `${n} passage(s) SANS VECTEUR : ${detail}. Leur moitié lexicale reste entière et ils `
        + `restent trouvables, mais ils sont absents de la recherche sémantique. `
        + `Relancer « synchro --vecteurs-manquants » les rattrapera sans tout réindexer.`
}

/** À appeler en fin de synchronisation : dit combien de passages ont pu être tronqués. */
export function bilanTroncature(): string | null {
    if (!tronquesSignales) return null
    const n = tronquesSignales
    tronquesSignales = 0
    return `${n} passage(s) dépassent la fenêtre du modèle d'embedding et ont probablement été `
        + `tronqués à la vectorisation. Leur moitié lexicale reste entière ; leur moitié sémantique `
        + `ne représente que leur début. Les découper serait le vrai remède.`
}

/**
 * L'ADRESSE DE L'EMBEDDING N'EST PAS FORCÉMENT CELLE DE LA CONVERSATION.
 *
 * Un modèle d'embedding pèse quelques centaines de mégaoctets là où un modèle d'instruction
 * en pèse des dizaines de gigaoctets : il tourne sur une petite VM sans GPU, et rien ne
 * l'oblige à partager l'hébergement du second.
 */
async function pointDEntree(): Promise<{ base: string, jeton: string } | null> {
    const v = await lirePlusieurs([
        'embeddings.base_url', 'embeddings.jeton', 'ia.base_url', 'ia.jeton',
    ])
    const propre = v['embeddings.base_url']?.replace(/\/+$/, '') ?? ''

    /**
     * UN SERVICE D'EMBEDDING N'A PAS FORCÉMENT DE JETON, et exiger le contraire refusait une
     * configuration parfaitement valable.
     *
     * `text-embeddings-inference` est un service nu : pas de comptes, pas de clés émises.
     * Sur un réseau interne, l'isolation tient lieu d'authentification, et c'est un choix
     * défendable pour un service qui ne fait que calculer des vecteurs.
     */
    if (propre) return { base: propre, jeton: v['embeddings.jeton'] || '' }

    const base = (v['ia.base_url'] || '').replace(/\/+$/, '')
    const jeton = v['ia.jeton'] || ''
    return base && jeton ? { base, jeton } : null
}

/**
 * Vecteur d'un texte, ou `null`.
 *
 * `null` couvre tous les cas où l'on ne peut pas calculer : sémantique désactivée, API
 * absente, modèle qui répond autre chose. Aucun d'eux n'est une erreur au sens où il
 * faudrait interrompre : la recherche continue en lexical.
 */
export async function calculerVecteur(texte: string, role: Role = 'question'): Promise<number[] | null> {
    if (!await lireBooleen('embeddings.actif')) return null

    const acces = await pointDEntree()
    if (!acces) return null

    const modele = await lire('embeddings.modele')
    const delai = await lireNombre('embeddings.delai_ms')
    const { base, jeton } = acces
    const entree = await prefixer(texte, role)
    if (role === 'passage') signalerSiTropLong(entree, role, await longueurSansTroncature())

    // LA ROUTE QUI MARCHE EST MÉMORISÉE.
    //
    // `/api/embeddings` rend 404 sur TEI : chaque passage faisait donc deux requêtes, dont
    // une perdue d'avance. Sur 3 196 passages, cela double le nombre d'appels et le temps
    // d'attente réseau pour rien.
    const aEssayer = routeConnue ? [routeConnue, ...ROUTES.filter(r => r !== routeConnue)] : ROUTES
    const echecs: string[] = []

    for (const route of aEssayer) {
        try {
            const r = await fetch(`${base}${route}`, {
                method: 'POST',
                // Pas d'en-tête d'autorisation quand il n'y a pas de jeton. Envoyer
                // `Bearer ` vide ferait échouer certains serveurs sur un en-tête malformé,
                // là où son absence est parfaitement licite.
                headers: {
                    'Content-Type': 'application/json',
                    ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
                },
                body: JSON.stringify({ input: entree, model: modele }),
                signal: AbortSignal.timeout(delai),
            })
            if (!r.ok) { echecs.push(`${route} → ${r.status}`); continue }
            const j = await r.json() as { data?: { embedding?: number[] }[], embedding?: number[] }
            const vecteur = j.data?.[0]?.embedding ?? j.embedding
            if (!Array.isArray(vecteur) || !vecteur.length) { echecs.push(`${route} → sans vecteur`); continue }

            // Une dimension inattendue est refusée plutôt que tronquée : mesurer la moitié
            // de l'index dans un espace et l'autre moitié dans un autre donne des scores
            // qui ont l'air normaux et ne veulent rien dire.
            if (vecteur.length !== DIMENSIONS) {
                console.error(`embeddings: ${modele} renvoie ${vecteur.length} dimensions, le schéma en attend ${DIMENSIONS}. Vecteur ignoré.`)
                return null
            }
            routeConnue = route
            return vecteur
        }
        catch (e) {
            // Le délai dépassé est la cause qu'on soupçonne, et c'était justement celle
            // qu'on ne pouvait pas distinguer. Elle se nomme désormais.
            const cause = e instanceof Error && e.name === 'TimeoutError'
                ? `délai de ${delai} ms dépassé`
                : e instanceof Error ? e.message : String(e)
            echecs.push(`${route} → ${cause}`)
        }
    }

    /**
     * UN VECTEUR MANQUANT DOIT DIRE POURQUOI.
     *
     * `null` était rendu en silence. C'est juste quand le service est ABSENT — la recherche
     * retombe en lexical, et ce n'est pas une panne. Ce ne l'est pas quand il répond et
     * échoue sur un passage précis : on se retrouve avec un index à trous qu'aucune erreur
     * ne signale, et qu'on ne découvre qu'en comptant les vecteurs après coup.
     */
    manques.push({ role, taille: texte.length, causes: echecs.join(' · ') })
    return null
}
