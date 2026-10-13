// LE FIL — la continuité de conversation, par reformulation explicite.
//
// « Comment j'isole ? » après une réponse sur un P1 doit s'entendre comme « comment isoler
// srv-exemple-01, une machine Debian compromise par un malware ». Deux architectures
// possibles, et le choix décide de tout ce qui suit.

import { blocNonFiable, discuter, promptSysteme, type ConfigIA } from "./ia";
import { lireNombre } from "./reglages";
import type { Reponse } from "./assistant";
import { SNIFF_TYPE } from "./questions";

/** Un tour passé : la question (comprise) et le résumé serveur de sa réponse. */
export type TourFil = { question: string, resume: string }

/**
 * Tronque le fil selon `ia.messages_gardes` — questions ET réponses confondues, donc un
 * tour en vaut deux. On garde la FIN : c'est le passé récent qui résout les pronoms.
 */
export async function tronquerFil(fil: TourFil[]): Promise<TourFil[]> {
    const gardes = await lireNombre('ia.messages_gardes')
    const tours = Math.max(1, Math.floor(gardes / 2))
    return fil.slice(-tours)
}

/**
 * Le RÉSUMÉ D'ÉTAT d'une réponse — construit en code, jamais par le modèle.
 *
 * C'est ce que le tour suivant saura du tour passé. Un résumé rédigé par le modèle pourrait
 * embellir ou inventer ; celui-ci ne contient que des faits extraits : la requête exécutée,
 * les identifiants et types rencontrés, les références citées. Court par construction —
 * il repart dans chaque requête du fil.
 */
export function construireResume(r: Pick<Reponse, 'issue' | 'citations' | 'donnees'>): string {
    const bouts: string[] = []

    if (r.donnees?.requete) {
        bouts.push(`données : ${r.donnees.requete}`)

        /**
         * L'ÉTIQUETAGE EST LA MÉMOIRE. Première version : identifiants et noms dans un
         * même sac « objets », types non filtrés. Premier essai réel : la reformulation a
         * produit « isoler les machines INC-EX01 et srv-exemple-01 » — un identifiant
         * d'incident promu machine — « de type malware et QEMU » — le type d'une VM promu
         * type d'incident. Le modèle a fidèlement restitué la bouillie qu'on lui donnait.
         *
         * Un résumé n'est utile que si chaque valeur porte sa nature : identifiant
         * d'incident, nom de machine, type d'incident (vocabulaire fermé). Ce qui ne se
         * laisse pas étiqueter ne rentre pas — une mémoire floue est pire qu'une mémoire
         * courte.
         */
        const identifiants = new Set<string>()
        /**
         * UN `id` N'EST PAS TOUJOURS UN IDENTIFIANT D'INCIDENT.
         *
         * Cette extraction étiquetait tout champ `id` « identifiant d'incident » — vrai chez
         * Sniff, où le fil est né, et faux partout ailleurs. Depuis que le Catalogue rend des
         * ventilations, une réponse porte des identifiants de COMPOSANTE, de service, de
         * département. Les faire traverser sous l'étiquette « incident » reproduirait
         * exactement le défaut qui a produit `/api/incidents/INC-04/machines` : une valeur
         * juste, sous une nature fausse.
         */
        const parAncetre = new Map<string, Set<string>>()
        const noms = new Set<string>()
        const types = new Set<string>()
        /**
         * LE SYSTÈME EST UN ATTRIBUT, ET LES ATTRIBUTS AIDENT LÀ OÙ LES IDENTIFIANTS NUISENT.
         *
         * La distinction vaut d'être notée, parce qu'elle explique aussi une panne inverse.
         * Un IDENTIFIANT — `INC-EX01`, `srv-exemple-01` — ne figure dans aucun passage du
         * corpus : il situe une question de données et DILUE une question de documents, au
         * point d'avoir écrasé la fiche INC-04 sous six en-têtes. Un ATTRIBUT — le système,
         * le type d'incident — est au contraire écrit dans les fiches, section par système :
         * il rapproche la question des gestes exacts au lieu de l'en éloigner.
         */
        const systemes = new Set<string>()
        const typesConnus = new Set<string>(SNIFF_TYPE)
        // Les incidents restent reconnus par leur ROUTE : c'est la seule chose qui distingue
        // sûrement un identifiant d'incident, et le fil s'en sert depuis le premier jour.
        const surIncidents = /incident/i.test(r.donnees.requete)
        /**
         * À LA RACINE, C'EST LA ROUTE QUI NOMME — sinon l'identifiant se perd.
         *
         * Un `id` sans ancêtre nommé, hors incidents, n'était plus retenu du tout : mieux
         * que de le baptiser « incident », mais c'était perdre ce que le tour suivant
         * demandera. `/api/serveurs?…` dit que ces identifiants sont des serveurs, et le
         * premier segment après `/api/` suffit à le lire.
         */
        const catalogueDeLaRoute = /\/api\/([a-z0-9-]+)/i.exec(r.donnees.requete)?.[1] ?? ''

        const parcourir = (n: unknown, prof: number, ancetre: string) => {
            if (prof > 5 || n === null || typeof n !== 'object') return
            if (Array.isArray(n)) { for (const x of n) parcourir(x, prof + 1, ancetre); return }
            const obj = n as Record<string, unknown>
            for (const [cle, v] of Object.entries(obj)) {
                if (cle === 'id' && typeof v === 'string') {
                    if (surIncidents && !ancetre) { if (identifiants.size < 5) identifiants.add(v) }
                    else if (ancetre || catalogueDeLaRoute) {
                        // Le couple, pas l'identifiant seul : le libellé est ce que
                        // l'utilisateur écrit, l'identifiant ce que le filtre exige.
                        const libelle = typeof obj.libelle === 'string' ? obj.libelle
                            : typeof obj.nom === 'string' ? obj.nom : null
                        const ou = ancetre || catalogueDeLaRoute
                        const vus = parAncetre.get(ou) ?? new Set<string>()
                        if (vus.size < 4) vus.add(libelle ? `${libelle} = ${v}` : v)
                        parAncetre.set(ou, vus)
                    }
                }
                else if (cle === 'nom' && typeof v === 'string' && noms.size < 5) noms.add(v)
                else if (cle === 'type' && typeof v === 'string' && typesConnus.has(v) && types.size < 4) types.add(v)
                else if (cle === 'os' && typeof v === 'string' && systemes.size < 4) systemes.add(v)
                // L'ancêtre retenu est la dernière clé NOMMÉE traversée : `lignes` ou
                // `resultats` ne disent rien, `composanteId` si.
                else parcourir(v, prof + 1, /^(lignes|resultats|rows|items)$/.test(cle) ? ancetre : cle)
            }
        }
        parcourir(r.donnees.corps, 0, '')
        if (identifiants.size) bouts.push(`identifiants d'incident : ${[...identifiants].join(', ')}`)
        for (const [ancetre, vus] of parAncetre) {
            bouts.push(`identifiants ${ancetre} (libellé = identifiant) : ${[...vus].join(', ')}`)
        }
        if (noms.size) bouts.push(`machines : ${[...noms].join(', ')}`)
        if (types.size) bouts.push(`types d'incident : ${[...types].join(', ')}`)
        // « valeurs brutes » n'est pas une précaution de style. Ces chaînes sortent de
        // l'inventaire — « Microsoft Windows 10 Professionnel 22H2 » — et le tour suivant a
        // pris l'une d'elles pour la définition de « Windows 10 ». Étiquetées comme des
        // constats, elles restent utilisables pour situer une machine sans faire autorité
        // sur le vocabulaire de la question.
        if (systemes.size) bouts.push(`systèmes des machines citées (valeurs brutes de l'inventaire) : ${[...systemes].join(', ')}`)
    }

    const refs = [...new Set(r.citations.map(c => c.reference).filter(Boolean))] as string[]
    // Les références de fiches ressemblent à des identifiants (INC-04) et n'en sont pas :
    // sans l'étiquette, la reformulation a appelé /api/incidents/INC-04/machines.
    if (refs.length) bouts.push(`fiches de procédure citées (documents, PAS des incidents) : ${refs.slice(0, 6).join(', ')}`)
    if (r.issue === 'rien_ecrit') bouts.push('sans réponse — rien dans les sources')
    if (r.issue === 'echec_source') bouts.push('la source n\'a pas répondu')

    return bouts.join(' · ').slice(0, 500)
}

/**
 * Reformule un message en QUESTION AUTONOME, à la lumière du fil.
 *
 * Sans fil, aucun appel : la question passe telle quelle, et le premier tour garde
 * exactement le comportement d'avant. La reformulation ne s'applique qu'à ce qui peut en
 * avoir besoin.
 */
export async function reformuler(
    cfg: ConfigIA, fil: TourFil[], question: string,
): Promise<{ question: string, reformulee: boolean }> {
    if (!fil.length) return { question, reformulee: false }

    const contexte = fil.map((t, i) =>
        `Q${i + 1} : ${t.question}\nR${i + 1} (résumé) : ${t.resume || '(sans résumé)'}`).join('\n')

    const consigne = [
        "Reformule le NOUVEAU MESSAGE en une question autonome et complète, compréhensible sans l'échange.",
        "- Recopie TELS QUELS les identifiants et noms nécessaires, avec leur NATURE : un identifiant d'incident reste un incident, un nom de machine reste une machine. Ne les permute jamais.",
        "- Les références de fiches (INC-xx, ANX-x, OUT-xx, QOT-xx) citées comme documents sont des PROCÉDURES : ne les présente jamais comme des incidents ou des machines.",
        "- Une question « comment faire », « comment isoler », « que faire » reste une question de PROCÉDURE : garde son verbe, ajoute le contexte (système, type d'incident) sans la transformer en demande de données.",
        // UNE HYPOTHÈSE REMPLACE, ELLE NE S'AJOUTE PAS.
        "- « Et si c'était X ? » est une HYPOTHÈSE : X REMPLACE l'attribut correspondant du contexte, il ne s'y ajoute pas. Retire alors ce que X contredit — un système supposé chasse le système constaté, et la machine précise n'a plus lieu d'être nommée.",
        /**
         * UN SUJET NOMMÉ DANS LE MESSAGE EST LE SUJET — le contexte ne peut pas le remplacer.
         *
         * La réponse était alors exacte pour la mauvaise composante, et rien ne le disait :
         * un chiffre juste, une entité fausse. C'est le mode de panne le plus coûteux du
         * fil, parce que la vérification naturelle — le chiffre est-il plausible ? — ne
         * l'attrape jamais.
         */
        "- UN NOM PROPRE ÉCRIT DANS LE NOUVEAU MESSAGE EST LE SUJET, et le contexte ne peut pas le remplacer par un autre. Si le message nomme une entité — une composante, une machine, une application — n'y substitue jamais celle du tour précédent, même si elle porte un identifiant que tu as sous la main. Le contexte complète ce que le message TAIT ; il ne corrige pas ce qu'il DIT.",
        "- N'ajoute un identifiant mémorisé que s'il désigne l'entité que le message nomme. Dans le doute, garde le nom écrit par l'utilisateur et n'ajoute aucun identifiant : une entité nommée sans identifiant se retrouve, un identifiant sur la mauvaise entité ne se voit pas.",
        /**
         * LE CONTEXTE COMPLÈTE UNE QUESTION, IL N'EN RÉTRÉCIT JAMAIS LA PORTÉE.
         *
         * C'est le défaut le plus dangereux du fil, parce qu'il ne ressemble pas à une
         * erreur : la réponse est juste, précise, et répond à côté. Un décompte rétréci ne
         * se voit pas — il n'a l'air ni vide ni aberrant, et rien dans la réponse ne dit
         * qu'on a compté un sous-ensemble.
         */
        "- LA PORTÉE APPARTIENT AU NOUVEAU MESSAGE. Une catégorie que l'utilisateur nomme lui-même — « les Windows 10 », « les serveurs », « les incidents » — se recopie TELLE QUELLE : le contexte peut ajouter un attribut qui manque, jamais remplacer cette catégorie par une valeur particulière rencontrée au tour précédent. Une chaîne d'inventaire croisée plus tôt n'est pas la définition de ce que l'utilisateur demande.",
        "- Ne réponds pas à la question. Ne commente pas. N'ajoute aucune information que l'échange ne porte pas.",
        "- Si le message est déjà autonome, rends-le inchangé.",
        'Rends UNIQUEMENT la question reformulée, sur une ligne.',
    ].join('\n')

    try {
        const r = await discuter(cfg, await promptSysteme(cfg),
            `${blocNonFiable('echange-precedent', contexte)}\n\n${blocNonFiable('nouveau-message', question)}\n\n${consigne}`)
        const propre = r.trim().split('\n')[0]?.trim().replace(/^«\s*|\s*»$/g, '') ?? ''
        // Une reformulation vide, démesurée ou identique n'apporte rien : on garde l'origine.
        if (!propre || propre.length > 500 || propre === question) return { question, reformulee: false }
        return { question: propre, reformulee: true }
    }
    catch {
        return { question, reformulee: false }
    }
}
