import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { auth, SSO } from "@assistants/auth";
import { reglagesRouter } from "./routers/reglages";
import { journauxRouter } from "./routers/journaux";
import { assistantRouter, lacunesAdminRouter, journalRouter } from "./routers/assistant";
import { sourcesRouter } from "./routers/sources";

// ORIGINES AUTORISÉES — la même liste que Better Auth, et pas une de plus.
//
// En production l'interface et le serveur sont derrière le même proxy, donc la question ne
// se pose pas. En développement ils sont sur deux ports, et sans ces en-têtes le navigateur
// refuse jusqu'à la connexion. Lire la liste depuis l'environnement plutôt que d'ouvrir à
// `*` : `credentials: include` avec une origine joker est refusé par les navigateurs, et
// c'est une bonne chose — un caractère générique ici ouvrirait la session à n'importe quel
// site que l'utilisateur visite par ailleurs.
const origines = process.env.TRUSTED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) ?? []

/** Renseigné à la construction de l'image — voir `apps/server/Dockerfile`. */
const VERSION = {
    ok: true,
    // `null` et non « inconnue » : c'est la convention retenue par Sniff pour la même
    // information, et trois applications de la maison qui répondent de trois façons à la
    // même question coûtent plus cher qu'un mot.
    version: process.env.GIT_COMMIT || null,
    construitLe: process.env.BUILD_DATE || null,
} as const

/**
 * LE JOURNAL D'ACCÈS — né d'un 504 qu'on n'a pas pu diagnostiquer.
 *
 * CE QUI EST JOURNALISÉ, ET CE QUI NE L'EST JAMAIS. La méthode, le chemin, le code et la
 * DURÉE — de quoi voir un dépassement de délai, une route absente, une lenteur qui s'installe.
 * Jamais le corps, jamais la question posée : l'outil des journaux ne persiste rien, pas même
 * une empreinte, et une trace d'accès qui recopierait un extrait de log applicatif viderait
 * cette promesse de son sens. Le chemin suffit à diagnostiquer ; le contenu ne servirait qu'à
 * fuir.
 */
const debuts = new WeakMap<Request, number>()

const journalAcces = new Elysia({ name: 'journal-acces' })
    .onRequest(({ request }) => { debuts.set(request, performance.now()) })
    .onAfterResponse(({ request, set }) => {
        const debut = debuts.get(request)
        const ms = debut === undefined ? '?' : `${Math.round(performance.now() - debut)}ms`
        console.log(`${request.method} ${new URL(request.url).pathname} ${set.status ?? 200} ${ms}`)
    })
    // `.as('global')` OU RIEN. Les crochets d'un greffon Elysia sont LOCAUX par défaut :
    // sans cette ligne, le journal ne trace que les routes déclarées dans le greffon
    // lui-même — c'est-à-dire aucune. Le serveur aurait démarré, la trace n'aurait jamais
    // paru, et l'on aurait conclu que le journal ne marchait pas alors qu'il ne voyait rien.
    // Défaut attrapé par l'essai, pas par le compilateur : la version fautive typait juste.
    .as('global')

const app = new Elysia()
    .use(cors({ origin: origines, credentials: true }))
    .use(journalAcces)
    .mount(auth.handler)
    // Deux chemins pour la même chose : /health est ce que sondent Docker et nginx,
    // /api/sante ce que l'interface peut appeler à travers le proxy sans règle en plus.
    // LA VERSION DÉPLOYÉE, PARCE QU'ON NE PEUT PAS LA DEVINER AUTREMENT.
    //
    // Une interface qui affiche l'ancien écran après un `git pull` ressemble exactement à
    // un défaut d'interface. Le seul moyen de trancher est de demander à l'application ce
    // qu'elle est. Nous réclamions cette information à Sniff sans l'exposer nous-mêmes.
    .get('/health', () => VERSION)
    .get('/api/sante', () => VERSION)
    // CE QUE LA PAGE DE CONNEXION A BESOIN DE SAVOIR, et elle seule peut l'apprendre ici.
    //
    // L'identifiant de fournisseur qu'elle poste doit être EXACTEMENT celui que le serveur a
    // déclaré. Le régler des deux côtés donnerait deux sources de vérité pour une valeur
    // unique, et leur divergence ne se verrait qu'à la connexion, sous la forme d'un
    // « fournisseur inconnu » qui ne dit pas lequel était attendu.
    //
    // Publique à dessein : un identifiant de client et un libellé de bouton transitent déjà
    // dans l'URL que le navigateur suit vers le fournisseur. Rien à protéger, et une route
    // authentifiée serait inatteignable depuis la page de connexion.
    .get('/api/sso', () => SSO)
    .use(reglagesRouter)
    .use(journauxRouter)
    .use(assistantRouter)
    .use(lacunesAdminRouter)
    .use(journalRouter)
    .use(sourcesRouter)
    .listen({ port: Number(process.env.PORT ?? 3000), hostname: process.env.HOST ?? '0.0.0.0' })

console.log(`assistants — serveur sur ${app.server?.hostname}:${app.server?.port}`)

export type App = typeof app
