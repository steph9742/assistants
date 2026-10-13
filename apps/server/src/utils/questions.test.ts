import { describe, expect, it } from 'bun:test'
import { catalogueLisible, champPresent, identifiantGenerique, interpreterOrientation, mentionsDe, QUESTIONS } from './questions'
import { detailsAttendus, extraireTypesIncidents } from './assistant'
import { mentionsDeValeurs } from './valeurs'

/**
 * Le vocabulaire des domaines de `/api/lacunes`, relevé.
 *
 * L'AUTORITÉ RESTE LA RÉPONSE, pas cette constante : `lacunesApplicables()` confronte nos
 * étiquettes au champ `domainesConnus` à chaque appel, et signale celles qui n'existent pas.
 * Ce qui est vérifié ici est autre chose — qu'une faute de frappe ne parte pas en service
 * pour n'être découverte qu'à la première réponse silencieusement non confrontée.
 */
const DOMAINES_CONNUS = [
    'acces', 'certificats', 'conformite', 'connecteurs', 'edr',
    'listes-blanches', 'parc', 'rgpd', 'risques',
]

describe('domaines déclarés sur les questions', () => {
    it('emploie uniquement des domaines qui existent au Catalogue', () => {
        const inconnus = [...new Set(QUESTIONS.flatMap(q => q.domaines ?? []))]
            .filter(d => !DOMAINES_CONNUS.includes(d))
        expect(inconnus).toEqual([])
    })

    // Une question du Catalogue sans domaine n'est confrontée à aucun angle mort : elle peut
    // rendre un décompte nul rassurant sans que rien ne le tempère. `recherche_catalogue`
    // est la seule exception admise — elle cherche un libellé, elle ne mesure rien.
    it('rattache chaque question du Catalogue à au moins un domaine', () => {
        const orphelines = QUESTIONS
            .filter(q => q.source === 'catalogue' && q.cle !== 'lacunes_catalogue')
            .filter(q => !(q.domaines ?? []).length)
            .map(q => q.cle)
        expect(orphelines).toEqual(['recherche_catalogue'])
    })

    it('déclare `connecteurs` partout où la donnée dépend d\'une synchronisation', () => {
        // Ce domaine porte « GLPI n'a rien relevé depuis N jours » : il invalide plus de
        // réponses qu'un référentiel incomplet.
        for (const cle of ['couverture_edr', 'parc_expose', 'listes_blanches', 'incidents_contexte']) {
            const q = QUESTIONS.find(x => x.cle === cle)
            expect(q?.domaines).toContain('connecteurs')
        }
    })

    it('ne déclare pas deux fois la même clé de question', () => {
        const cles = QUESTIONS.map(q => q.cle)
        expect(new Set(cles).size).toBe(cles.length)
    })
})

/**
 * Les vocabulaires de Sniff, donnés par leur équipe en `72d3857`.
 *
 * Ils étaient en texte libre, et c'est ce qui a laissé partir `severity=P1` : refusé en 422,
 * puis affiché comme un trou documentaire. Ces essais existent pour qu'un paramètre de Sniff
 * ne redevienne pas ouvert par inadvertance.
 */
describe('vocabulaires fermés de Sniff', () => {
    const incidents = QUESTIONS.find(q => q.cle === 'incidents_liste')!
    const decompte = QUESTIONS.find(q => q.cle === 'decompte_incidents')!

    it('ferme type, status et severity sur les deux questions', () => {
        for (const q of [incidents, decompte]) {
            for (const cle of ['type', 'status', 'severity']) {
                const p = q.parametres.find(x => x.cle === cle)
                expect(p, `${q.cle}.${cle}`).toBeDefined()
                expect(p!.valeurs?.length, `${q.cle}.${cle} doit être fermé`).toBeGreaterThan(0)
            }
        }
    })

    it('accepte le vocabulaire de gravité, P1 à P4', () => {
        const sev = incidents.parametres.find(p => p.cle === 'severity')!.valeurs!
        for (const v of ['P1', 'P2', 'P3', 'P4']) expect(sev).toContain(v)
        for (const v of ['critical', 'high', 'medium', 'low']) expect(sev).toContain(v)
    })

    /**
     * ÉCRIT SUR LA PROPRIÉTÉ, PAS SUR L'ÉTAT — corrigé.
     *
     * La propriété qui compte est ailleurs, et elle vise une panne réelle : la liste et le
     * décompte de Sniff ont divergé avant `72d3857`, chacun recopiant son filtre. Nos deux
     * questions doivent donc déclarer EXACTEMENT le même vocabulaire — un total qui ne
     * compte pas ce que la liste montre est un mensonge discret, il a l'air d'un fait.
     */
    it('ne laisse pas la liste et le décompte diverger', () => {
        for (const cle of ['type', 'status', 'severity']) {
            const a = incidents.parametres.find(x => x.cle === cle)!.valeurs
            const b = decompte.parametres.find(x => x.cle === cle)!.valeurs
            expect(b, `${cle} diverge entre la liste et le décompte`).toEqual(a)
        }
    })
})

/**
 * Le classement par urgence — là où la question « qu'est-ce qui est le plus urgent » casse.
 *
 * Deux pièges, et le second n'est pas évident : les états sans date ne peuvent pas être
 * classés, et le retard profond n'est pas une urgence profonde.
 */
describe('échéances — ce qui ne se classe pas par le temps', () => {
    const q = QUESTIONS.find(x => x.cle === 'echeances_patrimoine')!
    const mentions = (corps: any) => mentionsDe(q, corps)

    // `estUnEtat` a migré vers la couche champ-valeur, pour valoir sur toute réponse et pas
    // seulement sur cette question. L'essai porte donc sur la garantie combinée.
    it('sépare les états sans date du classement par urgence', () => {
        const corps = { resultats: [{ estUnEtat: true, joursRestants: null }] }
        const dit = [...mentions(corps), ...mentionsDeValeurs(corps)].join(' ')
        expect(dit).toContain('SANS date')
        expect(dit).toContain("ordre d'urgence")
    })

    it('interdit de classer le dépassé par profondeur de retard', () => {
        const m = mentions({ resultats: [{ joursRestants: -400 }, { joursRestants: -2 }] })
        const dit = m.find(x => x.includes('DÉJÀ DÉPASSÉES'))
        expect(dit).toBeDefined()
        expect(dit).toContain('2 ligne(s)')
        expect(dit).toContain('400 jours')
        expect(dit).toContain('NE PAS les classer par profondeur de retard')
    })

    // Aucun seuil inventé : « dépassé de plus de N jours » serait une règle de notre cru,
    // présentée avec l'autorité du code. On rend la mesure, pas un verdict.
    it('ne pose aucun seuil de son invention', () => {
        const dit = mentions({ resultats: [{ joursRestants: -400 }] }).join(' ')
        expect(dit).not.toMatch(/plus de \d+ jours/)
    })

    it('ne dit rien du dépassé quand il n\'y en a pas', () => {
        const m = mentions({ resultats: [{ joursRestants: 12 }] })
        expect(m.some(x => x.includes('DÉJÀ DÉPASSÉES'))).toBe(false)
    })

    it('renvoie les regroupements du serveur plutôt que de faire recompter', () => {
        const m = mentions({ resultats: [], parCategorie: { vpn: 3 } })
        expect(m.some(x => x.includes('comptés par le serveur'))).toBe(true)
    })
})

/**
 * Ce qu'une réponse doit porter, et comment elle est triée.
 *
 * « Sois bref » produisait « Oui, il y a un incident P1 » : exact, et inutilisable. On ne
 * sait pas lequel, ni quand, ni où le retrouver.
 */
describe('identité des éléments cités, et ordre', () => {
    const q = (cle: string) => QUESTIONS.find(x => x.cle === cle)!

    it('exige identifiant, intitulé, dates et MACHINES sur les incidents', () => {
        const d = q('incidents_liste').detailsMinimums!.join(' ')
        expect(d).toContain("l'identifiant")
        // PAS « le titre » : Sniff n'en porte pas, mesuré par --montrer. Le réclamer
        // faisait rendre une réponse sans intitulé du tout — c'est la description qui
        // tient ce rôle, et l'exigence doit nommer un champ qui existe.
        expect(d).not.toContain('le titre —')
        // Sniff assume l'absence d'un champ titre et propose la composition — id, niveau,
        // type — plutôt qu'une description tronquée à une longueur arbitraire.
        expect(d).toContain('intitulé COMPOSÉ')
        expect(d).toContain('la description en entier')
        expect(d).toContain('DÉTECTION')
        // La machine décide de la suite : sans elle, la réponse ne dit pas sur quoi agir.
        expect(d).toContain('MACHINES CONCERNÉES')
    })

    /**
     * Sniff trie par date de MODIFICATION. « Les derniers incidents » désigne donc les
     * derniers touchés — rarement l'intention, et la post-condition ne faisait que le
     * signaler après coup. On impose l'ordre utile, le modèle peut en demander un autre.
     */
    it('trie les incidents par date de détection, pas de modification', () => {
        expect(q('incidents_liste').defauts?.sort).toBe('knowledgeAt')
        expect(q('incidents_liste').parametres.find(p => p.cle === 'sort')!.valeurs)
            .toContain('knowledgeAt')
    })

    it('exige de quoi retrouver la fiche sur les catalogues et les échéances', () => {
        for (const cle of ['catalogue_generique', 'echeances_patrimoine', 'incidents_contexte']) {
            expect(q(cle).detailsMinimums?.length, cle).toBeGreaterThan(0)
        }
    })

    // Un défaut ne doit jamais porter sur un paramètre non déclaré : il partirait dans
    // l'URL sans passer par le filtre des valeurs admises.
    it('ne pose de défaut que sur des paramètres déclarés', () => {
        for (const x of QUESTIONS) {
            for (const cle of Object.keys(x.defauts ?? {})) {
                expect(x.parametres.some(p => p.cle === cle), `${x.cle}.${cle}`).toBe(true)
            }
        }
    })
})

/**
 * Le contexte, et son pendant obligatoire.
 *
 * Un incident sans ses machines est une ligne de registre ; avec elles, c'est un fait qu'on
 * peut situer. Mais une consigne qui n'ajoute que des champs produit un mur où la réponse se
 * perd — le contraire de ce qu'on cherche, obtenu en voulant bien faire.
 */
describe('rattachements — ce qui situe un élément, et ce qui le noie', () => {
    const q = (cle: string) => QUESTIONS.find(x => x.cle === cle)!

    it('rattache un incident à ses machines', () => {
        // Écrit sur ce qui est RENDU au modèle, pas sur le champ de déclaration qui le
        // porte : les machines ont migré du contexte (« quand ils figurent ») vers les
        // exigences, parce qu'une réponse P1 sans sa machine a déjà été rendue deux fois.
        expect(detailsAttendus({ cle: 'incidents_liste', requete: '', corps: null, mentions: [] }))
            .toContain('MACHINES CONCERNÉES')
        expect(q('incidents_contexte').contexte!.join(' ')).toContain('criticité')
    })

    it('rattache une fiche du Catalogue à sa chaîne d\'entités', () => {
        const c = q('catalogue_generique').contexte!.join(' ')
        for (const e of ['entité', 'composante', 'département', 'service', 'lieu']) {
            expect(c).toContain(e)
        }
    })

    it('rattache une application à sa composante et à ses responsables', () => {
        const c = q('dossier_application').contexte!.join(' ')
        expect(c).toContain('composante')
        expect(c).toContain('responsables')
    })

    /**
     * La contrepartie. Toute question qui déclare des rattachements doit dire ce qu'elle
     * tait — sinon on a ajouté du volume sans ajouter de lisibilité.
     */
    it('exige un « à taire » sur les questions les plus bavardes', () => {
        for (const cle of ['catalogue_generique', 'dossier_application', 'incident_detail']) {
            expect(q(cle).aOmettre?.length, cle).toBeGreaterThan(0)
        }
    })

    /**
     * Le contexte ne s'invente jamais. Il est soit porté par la réponse, soit rapporté par
     * une SUITE DÉCLARÉE — une seconde lecture, plafonnée et affichée. Ce qui reste interdit
     * est de le DEVINER.
     *
     * La réserve vit dans la consigne générale et non dans chaque question, sans quoi il
     * faudrait la répéter trente fois et l'oublier une fois. C'est donc là qu'on la vérifie.
     */
    it("subordonne le contexte à sa présence dans les données, et interdit de le deviner", () => {
        const dit = detailsAttendus({
            cle: 'incidents_contexte', requete: '', corps: null, mentions: [],
        })
        expect(dit).toContain('quand ils figurent dans les données')
        expect(dit).toContain('ne jamais les deviner')
    })
})

/**
 * LA JOINTURE APPARTIENT AU SERVEUR.
 */
describe('machines des incidents — jointure et non parcours', () => {
    const q = (cle: string) => QUESTIONS.find(x => x.cle === cle)!

    it('demande la jointure par défaut, et laisse la refuser', () => {
        expect(q('incidents_liste').defauts?.avecMachines).toBe('true')
        expect(q('incidents_liste').parametres.find(p => p.cle === 'avecMachines')!.valeurs)
            .toEqual(['true', 'false'])
    })

    it('ne parcourt plus incident par incident', () => {
        expect(QUESTIONS.some(x => 'suite' in x)).toBe(false)
    })

    /**
     * ABSENT N'EST PAS VIDE, et aucune règle champ-valeur ne peut le dire : elles portent
     * sur un champ ET sa valeur, or un champ absent n'a pas de valeur. C'est la limite exacte
     * du mécanisme, et elle se comble par une post-condition.
     */
    /**
     * « MACHINES SUPPORTÉES : 154 » — un numérateur sans dénominateur, signalé à la lecture.
     *
     * Les cinq catégories du résumé s'alignent comme une répartition du parc. Elles ne
     * répartissent que les machines rapprochées d'un système connu ; celles dont la clé
     * n'est pas calculée n'y sont pas. Sans population citée, « 154 » se lit « seulement
     * 154 de nos machines sont à jour ».
     */
    it('donne la population que les décomptes de fin de vie répartissent', () => {
        const dit = (corps: any) => mentionsDe(q('fins_de_vie'), corps).join(' ')
        const lignes = [{ os: 'A', machines: 100, finDeVie: '2020-01-01', eolStatut: 'depasse' },
                        { os: 'B', machines: 54, finDeVie: '2030-01-01', eolStatut: 'supporte' }]

        // Lignes complètes : la population se calcule et doit être citée.
        // PROPRIÉTÉ, PAS PHRASE : la mention offre la population calculée (100 + 54). Ce qui
        // est tenu ici, c'est la DÉCISION et son chiffre — la tournure peut être réécrite.
        const complet = dit({ lignes, resume: { osDistincts: 2, machinesDepassees: 100 } })
        expect(complet).toContain('154')

        // Lignes tronquées : on se tait, ET on interdit la somme — c'est par elle qu'un
        // facteur trente-cinq se fabrique.
        // Propriété inverse : AUCUNE population n'est offerte, et la mention dit sur quelle
        // fraction des systèmes elle porte.
        const borne = dit({ lignes, resume: { osDistincts: 87, machinesDepassees: 100 } })
        expect(borne).not.toContain('154')
        expect(borne).toMatch(/\b2\b.*\b87\b/)

        // « 2 des undefined systèmes » : le défaut « 3 sur null », deux jours plus tard et
        // dans notre propre mise en garde. Un nombre absent ne se rend pas en toutes lettres.
        const sansTotal = dit({ lignes, resume: { machinesDepassees: 100 } })
        expect(sansTotal).not.toContain('undefined')
        expect(sansTotal).not.toContain('154')

        // Pas de lignes, pas de population : la mise en garde ne se fabrique pas.
        expect(dit({ lignes: [], resume: { osDistincts: 0 } })).not.toContain('Population')
    })

    /**
     * LE DÉFAUT QUI NE SE VOIT PAS À LA RELECTURE : une valeur juste sous un nom inventé.
     * « Machines supportées : 154 » était une étiquette du modèle, pas de la source. Le
     * recensement se recopie donc au lieu de se transcrire.
     */
    /**
     * LA VRAIE CAUSE DU « 154 », établie après une première explication fausse : `ok` et
     * `supporte` disent tous deux « ça va », le résumé les sépare, l'interface du Catalogue
     * les additionne, et la catégorie la plus nombreuse est tombée en silence.
     */
    it('distingue les deux états sains, dont les noms ne le laissent pas deviner', () => {
        const dit = (corps: any) => mentionsDe(q('fins_de_vie'), corps).join(' ')
        const avecLesDeux = dit({ lignes: [{ os: 'A', machines: 5326, eolStatut: 'ok' },
                                            { os: 'B', machines: 154, eolStatut: 'supporte' }] })
        expect(avecLesDeux).toContain('`supporte` un système maintenu SANS date connue')
        expect(avecLesDeux).toContain('le petit des deux')

        // Un seul des deux états : rien à distinguer, et une mise en garde bavarde use les autres.
        expect(dit({ lignes: [{ os: 'A', machines: 5326, eolStatut: 'ok' }] })).not.toContain('le petit des deux')
    })

    /**
     * LE CHAMP FANTÔME QUI SE REND VISIBLE. La réponse a rendu une colonne « Version »
     * remplie de `null` : il n'y a pas de champ `version` sur cette route. Un champ
     * inexistant déguisé en donnée absente envoie corriger une saisie qui n'existe pas.
     */
    it('interdit la colonne « version », qui n\'existe pas sur cette route', () => {
        const fdv = q('fins_de_vie')
        expect(fdv.attendChamps?.some(c => /version/i.test(c))).toBe(false)
        expect(fdv.aOmettre?.join(' ')).toContain('version')
    })

    it('refuse toute fin de vie tirée de machinesParOs', () => {
        const dit = (corps: any) => mentionsDe(q('parc_technologique'), corps).join(' ')
        const avec = dit({ resultats: [], machinesParOs: [{ os: 'Microsoft Windows 11 Professionnel', total: 4757 }] })
        // PROPRIÉTÉS : la mention nomme le champ piégé et la route qui répond vraiment.
        expect(avec).toContain('machinesParOs')
        expect(avec).toContain('/api/eol/etat')

        // Pas de bloc, pas de mise en garde : une bavarde use les autres.
        expect(dit({ resultats: [] })).not.toContain('machinesParOs')
        expect(dit({ resultats: [], machinesParOs: [] })).not.toContain('machinesParOs')
    })

    /**
     * LA ROUTE ÉTAIT LE VRAI DÉFAUT. « Combien de machines ont un OS en fin de vie » est
     * partie sur `parc_technologique`, qui rend des lignes de TECHNOLOGIE. Les deux
     * intitulés doivent se repousser au lieu de se ressembler.
     */
    it('sépare compter des machines de lister des technologies', () => {
        expect(q('fins_de_vie').intitule).toContain('Combien de machines')
        // L'intitulé qui repousse doit NOMMER où aller, sinon il ne fait que refuser. C'est
        // la propriété — le reste de la tournure appartient à qui la réécrira.
        expect(q('parc_technologique').intitule).toContain('fins_de_vie')
    })

    it("nomme l'état que le résumé ne compte pas", () => {
        const dit = (corps: any) => mentionsDe(q('fins_de_vie'), corps).join(' ')
        const lignes = [{ os: 'A', machines: 5481, eolStatut: 'ok' },
                        { os: 'B', machines: 610, eolStatut: 'depasse' }]
        const m = dit({ lignes, resume: { osDistincts: 2, machinesDepassees: 610 } })
        // PROPRIÉTÉS : l'état absent est nommé avec son décompte, l'état couvert se tait.
        expect(m).toContain('`ok` (5481 machines)')
        expect(m).not.toContain('`depasse` (610')
    })

    it('se tait quand le résumé couvre tous les états', () => {
        const dit = (corps: any) => mentionsDe(q('fins_de_vie'), corps).join(' ')
        const m = dit({
            lignes: [{ os: 'A', machines: 5481, eolStatut: 'ok' }, { os: 'B', machines: 610, eolStatut: 'depasse' }],
            resume: { osDistincts: 2, machinesOk: 5481, machinesDepassees: 610 },
        })
        expect(m).not.toContain('`ok`')
    })

    it("ne conclut rien sur les états quand les lignes sont tronquées", () => {
        // Un état « absent » calculé sur un extrait serait une accusation infondée : la
        // ligne manquante est peut-être simplement hors du bornage.
        const dit = (corps: any) => mentionsDe(q('fins_de_vie'), corps).join(' ')
        const m = dit({ lignes: [{ os: 'A', machines: 5481, eolStatut: 'ok' }], resume: { osDistincts: 148 } })
        expect(m).not.toContain('`ok` (5481 machines)')
    })

    /**
     * LE TROISIÈME COUPLE DE FAUX JUMEAUX. La réponse a titré « sans date de fin de vie
     * connue : 27 » puis rangé sous ce titre un tableau totalisant 132 machines : deux
     * catégories fondues, et le décompte annoncé appartenait à l'autre. `inconnu` et
     * `supporte` n'ont l'un comme l'autre aucune date — ce qui les sépare est ce qu'on sait
     * de cette absence.
     */
    it('sépare les deux états sans date', () => {
        const dit = (corps: any) => mentionsDe(q('fins_de_vie'), corps).join(' ')
        const m = dit({ lignes: [{ os: 'A', machines: 27, eolStatut: 'inconnu' },
                                 { os: 'B', machines: 132, eolStatut: 'supporte' }] })
        expect(m).toContain('`inconnu`')
        expect(m).toContain('`supporte`')

        // Un seul des deux : rien à séparer, et une bavarde use les autres.
        expect(dit({ lignes: [{ os: 'A', machines: 27, eolStatut: 'inconnu' }] }))
            .not.toContain('pas le même manque')
    })

    /**
     * LA SOURCE PORTE MAINTENANT SON PROPRE TOTAL. Répéter le nôtre dirait le même nombre
     * dans d'autres mots deux lignes plus loin — et une règle écrite deux fois finit par
     * diverger.
     */
    it('ne redit pas un total que le recensement porte déjà', () => {
        const dit = (corps: any) => mentionsDe(q('fins_de_vie'), corps).join(' ')
        const lignes = [{ os: 'A', machines: 100, eolStatut: 'depasse' },
                        { os: 'B', machines: 54, eolStatut: 'ok' }]

        // Sans total publié : nous le calculons et le donnons.
        expect(dit({ lignes, resume: { osDistincts: 2, machinesDepassees: 100, machinesOk: 54 } }))
            .toContain('154')
        // Avec un total publié qui vaut le nôtre : on renvoie au recensement, sans le répéter.
        const avecTotal = dit({ lignes, resume: { osDistincts: 2, machinesTotal: 154, machinesDepassees: 100, machinesOk: 54 } })
        expect(avecTotal.split('154').length - 1).toBe(1)  // une seule fois : dans le recensement
    })

    /**
     * « ET COMBIEN DE WINDOWS 10 ? » a rendu onze lignes et aucun total, en omettant les
     * variantes en `ok`. Ce que la question exige tient en trois substances : un total, une
     * ventilation qui y mène, et tous les états — pas une tournure.
     */
    it('exige un total, sa ventilation et tous les états sur une famille de produits', () => {
        const ctx = q('fins_de_vie').contexte?.join(' ') ?? ''
        // PROPRIÉTÉ : un total est exigé, et il doit être le résultat d'une addition ÉCRITE.
        // Une somme posée se recompte ; un total nu se croit.
        // PROPRIÉTÉ : un décompte publié passe avant toute addition, et l'addition posée ne
        // reste qu'en repli. Le modèle a écrit « 744 » pour 743 et omis quatre lignes sur
        // seize — une somme recopiée est fausse dès qu'un chiffre l'est, sans signal.
        expect(ctx).toContain('total')
        expect(ctx).toContain('décompte PAR FAMILLE')
        expect(ctx).toContain('à DÉFAUT')
        expect(ctx).toContain("POSANT L'ADDITION")
        expect(ctx).toContain('ventilation')
        // Et aucun total ne peut être emprunté au recensement.
        expect(ctx).toContain('recensement ne peut servir de total')
        expect(ctx).toContain('ok et supporte')
        // La somme demandée rend une ligne dupliquée arithmétiquement fausse, plus seulement
        // inélégante.
        expect(ctx).toContain('répéter une ligne')
    })

    /**
     * « ET COMBIEN DE WINDOWS 10 ? » est arrivé sur l'inventaire des machines, avec une
     * recherche en texte libre, et a rendu 1 132 « Windows 10 Professionnel 22H2 ». Le
     * nombre mesure une correspondance de texte que le lecteur ne voit pas.
     */
    it("dit qu'une recherche en texte libre n'est pas un recensement", () => {
        const dit = (params: any) => mentionsDe(q('inventaire_machines'), { rows: [], total: 1132 }, params).join(' ')
        const m = dit({ catalogue: 'postes-travail', q: 'Windows 10' })
        expect(m).toContain('Windows 10')
        expect(m).toContain('/api/eol/etat')
        // Sans recherche libre, le total porte sur la nature demandée : rien à dire.
        expect(dit({ catalogue: 'postes-travail' })).not.toContain('/api/eol/etat')
    })

    it("renvoie un décompte par système vers la route qui le porte", () => {
        expect(q('inventaire_machines').intitule).toContain('fins_de_vie')
        expect(q('fins_de_vie').intitule).toContain('Combien de machines')
    })

    it("borne l'interdit d'agréger aux entrées du recensement", () => {
        const dit = (corps: any) => mentionsDe(q('fins_de_vie'), corps).join(' ')
        const m = dit({ lignes: [{ os: 'A', machines: 1 }], resume: { machinesEtendues: 1420, osDistincts: 1 } })
        // L'interdit est nommé ET borné : ce qui reste permis est dit dans la même phrase.
        // Depuis que le Catalogue publie les familles, ce qui reste permis n'est plus une
        // addition mais une LECTURE — la prescription doit y renvoyer, pas au tableau.
        expect(m).toContain('CES entrées-là')
        expect(m).toContain('décompte PAR FAMILLE')
        expect(m).not.toContain('additionnant les LIGNES')
    })

    /**
     * UNE DATE ENTIÈREMENT INVENTÉE.
     * `referentielConstruit` vaut `true` : c'est un booléen. Notre exigence l'appelait « la
     * date de construction du référentiel », et le modèle, sommé de citer une date qui
     * n'existe pas, en a fabriqué une.
     *
     * L'essai tient donc l'inverse de ce qu'il tenait il y a une heure : rien ne doit être
     * dit de ce champ, et surtout aucun âge calculé — `new Date(true)` étant invalide, le
     * contrôle écrit pour cela ne se serait jamais déclenché.
     */
    it("n'invente aucune date à partir de referentielConstruit", () => {
        const dit = (corps: any) => mentionsDe(q('fins_de_vie'), corps).join(' ')
        const m = dit({ lignes: [{ os: 'A', machines: 1 }], resume: { referentielConstruit: true } })
        expect(m).not.toContain('référentiel de fin de vie date')
        expect(m).not.toContain('jours (')
        // Et plus aucune exigence de rédaction ne réclame cette date.
        expect(q('fins_de_vie').contexte?.join(' ') ?? '').not.toContain('referentielConstruit')
    })

    /**
     * LE CONTRÔLE QUI MANQUAIT. Nos quatre champs fantômes étaient ABSENTS et l'exigence
     * mourait en silence. Celui-ci est présent, et c'est son TYPE qui était supposé : le
     * contrôle passait au vert et l'exigence fabriquait une valeur.
     */
    it('déclare le type des champs dont une exigence dépend', () => {
        const attendus = q('fins_de_vie').attendChamps ?? []
        expect(attendus).toContain('resume.referentielConstruit:boolean')
        // Un type déclaré doit être l'un de ceux que le harnais sait confronter.
        for (const a of attendus) {
            const t = a.split(':')[1]
            if (t) expect(['string', 'number', 'boolean', 'array', 'object']).toContain(t)
        }
    })

    /**
     * DEUX DE NOS MISES EN GARDE SE CONTREDISAIENT dans la même réponse : « sans date = 
     * inconnu, pas maintenue » d'un côté, « supporte = maintenu SANS date connue » de
     * l'autre. La première datait d'avant la découverte de `supporte` et était juste alors.
     * C'est le mode de panne propre aux règles accumulées.
     */
    it('ne dit plus qu\'une absence de date signifie « inconnu »', () => {
        const m = mentionsDe(q('fins_de_vie'), {
            lignes: [{ os: 'macOS 26', machines: 110, finDeVie: null, eolStatut: 'supporte' },
                     { os: 'X', machines: 1, finDeVie: null, eolStatut: 'inconnu' }],
        }).join(' ')
        expect(m).not.toContain('est `inconnu`, pas « maintenue »')
        // Les deux cas restent dits, et distingués.
        expect(m).toContain('`supporte`')
        expect(m).toContain('`inconnu`')
    })

    /**
     * TREIZE PARTITIONS DÉCLARÉES SUR DES ROUTES QU'AUCUNE QUESTION N'INTERROGEAIT. Des
     * décomptes exacts, publiés, documentés, et inatteignables : la source savait répondre,
     * personne ne pouvait poser la question.
     */
    it('expose les quatre résumés que personne ne pouvait demander', () => {
        for (const [cle, chemin] of [
            ['parc_resume', '/api/parc/resume'],
            ['applications_resume', '/api/applications/resume'],
            ['certificats_resume', '/api/certificats/resume'],
            ['listes_blanches_resume', '/api/whitelists/resume'],
        ] as const) {
            const x = q(cle)
            expect(x.chemin).toBe(chemin)
            expect(x.attendChamps?.length).toBeGreaterThan(0)
            // L'intitulé décide de la route : il doit dire que c'est un DÉCOMPTE, pour ne
            // pas capter les questions de liste qui vivent sur les routes voisines.
            expect(x.intitule.toLowerCase()).toContain('décompte')
        }
    })

    /**
     * SIX PARTITIONS CÔTE À CÔTE DONNENT L'ILLUSION DE SE CROISER. Elles partitionnent la
     * même population sous six angles : « exposée sur Internet ET confidentielle » demande
     * de savoir quelles applications sont dans les deux, ce qu'aucun de ces nombres ne dit.
     */
    it('refuse de croiser deux décomptes de la même population', () => {
        const dit = (corps: any) => mentionsDe(q('applications_resume'), corps).join(' ')
        const m = dit({ parExposition: { internet: 12 }, parSensibilite: { confidentielle: 8 } })
        expect(m).toContain('MÊME population')
        expect(m).toContain('jamais additionner ni multiplier')
        // Un seul angle : rien à croiser, et une bavarde use les autres.
        expect(dit({ parExposition: { internet: 12 } })).not.toContain('MÊME population')
    })

    /**
     * DEUX FAMILLES DE COMPTEURS DANS LE MÊME BLOC, ET UNE SEULE SOMME AU TOTAL. Un
     * certificat peut être expiré ET injoignable ; les additionner rend un nombre supérieur
     * au parc surveillé.
     */
    it('dit que les indicateurs voisins des certificats se recoupent', () => {
        const dit = (corps: any) => mentionsDe(q('certificats_resume'), corps).join(' ')
        expect(dit({ parStatut: { ok: 40 }, expires: 3, invalides: 2, injoignables: 1 }))
            .toContain('SE RECOUPENT')
        // Sans partition à leur opposer, rien à dire ; un seul voisin ne se recoupe avec rien.
        expect(dit({ expires: 3, invalides: 2 })).not.toContain('SE RECOUPENT')
        expect(dit({ parStatut: { ok: 40 }, expires: 3 })).not.toContain('SE RECOUPENT')
    })

    /**
     * CINQUANTE FAMILLES, VINGT GROUPES. « Combien de Windows 10 » se lit dans la famille,
     * « combien de Debian toutes versions » dans le groupe. Se tromper de niveau rend un
     * nombre juste à une question qu'on n'a pas posée.
     */
    it('distingue le niveau famille du niveau groupe', () => {
        const ctx = q('fins_de_vie').contexte?.join(' ') ?? ''
        expect(ctx).toContain('PAR FAMILLE')
        expect(ctx).toContain('PAR GROUPE')
        expect(ctx).toContain('famillesDuGroupe')
        // Le champ dont l'exigence dépend est vérifié — sinon elle meurt en silence.
        expect(q('fins_de_vie').attendChamps).toContain('resume.famillesDuGroupe:object')
    })

    /**
     * `autre` EST INSPECTABLE. Un compteur seul ne disait pas s'il fallait ajouter une
     * famille au référentiel ou corriger l'inventaire — vingt et une machines sous AS/400
     * appellent une décision, vingt et une machines mal saisies en appellent une autre.
     */
    it('nomme ce que « autre » contient, et dit quand la liste est tronquée', () => {
        const dit = (nr: any) => mentionsDe(q('fins_de_vie'), { resume: { famillesNonReconnues: nr } }).join(' ')
        const m = dit({ systemes: 4, machines: 34, cles: [{ cle: 'AS/400 V7R4', machines: 21 }], tronque: false })
        expect(m).toContain('AS/400 V7R4 (21)')
        expect(m).toContain('34 machine(s) sur 4 système(s)')
        expect(m).not.toContain('TRONQUÉE')

        expect(dit({ systemes: 40, machines: 300, cles: [{ cle: 'X', machines: 1 }], tronque: true }))
            .toContain('TRONQUÉE')
        // Rien à dire quand rien n'échappe au classement.
        expect(dit({ systemes: 0, machines: 0, cles: [], tronque: false })).not.toContain('« autre »')
    })

    /**
     * « COMBIEN DE SERVEURS DANS CHRONO-ENVIRONNEMENT » rendait « le bloc est vide ».
     * Honnête, et faux comme diagnostic : le parc EST rattaché à des composantes, nous
     * n'avions aucun moyen de le demander. Un outil qui répond « pas d'information » là où
     * il faut répondre « je ne sais pas poser cette question » déplace le manque sur la
     * donnée.
     */
    it('sait interroger un catalogue par axe de filtre', () => {
        const x = q('resume_par_axe')
        expect(x.chemin).toBe('/api/{catalogue}/resume')
        expect(x.parametres[0]!.valeurs).toContain('serveurs')
        expect(x.parametres[0]!.obligatoire).toBe(true)
    })

    /**
     * UN AXE ABSENT N'EST PAS UN AXE VIDE — un poste de travail n'a pas d'environnement.
     * Confondre les deux enverrait remplir une colonne qui n'existe pas.
     */
    it("distingue un axe que la table ne porte pas d'un axe non renseigné", () => {
        const dit = (corps: any) => mentionsDe(q('resume_par_axe'), corps).join(' ')
        const m = dit({ axes: { partitions: ['statut', 'environnement'], ventilations: ['composanteId'] } })
        expect(m).toContain('EUX SEULS')
        expect(m).toContain('statut, environnement')
        expect(m).toContain("PAS un axe dont les valeurs seraient vides")
    })

    /**
     * LE CROISEMENT EST LE PIÈGE LE PLUS TENTANT : les deux nombres sont côte à côte, et
     * leur produit a l'air d'une estimation raisonnable. Il ne l'est pas — une composante
     * peut n'avoir que de la production, une autre que de la recette.
     */
    it('refuse de croiser deux axes de filtre', () => {
        const dit = (corps: any) => mentionsDe(q('resume_par_axe'), corps).join(' ')
        const m = dit({ partitions: { statut: { en_service: 811 } }, ventilations: { composanteId: { total: 912 } } })
        expect(m).toContain('ne se croisent pas DANS CE BLOC')
        expect(m).toContain('supposerait les axes indépendants')
        // ET SURTOUT : ne pas déclarer impossible ce qui existe ailleurs. Le croisement
        // s'obtient par filtres combinés ; renoncer est une chose, faire croire que c'est
        // impossible en est une autre.
        expect(m).toContain('le décompte exact existe')
        // Un seul axe : rien à croiser.
        expect(dit({ partitions: { statut: { en_service: 811 } } })).not.toContain('DANS CE BLOC')
    })

    /**
     * `sansRattachement` empêche la répartition de perdre des objets en silence — le
     * `machinesOk` manquant, prévenu cette fois.
     */
    it('cite les objets sans rattachement avec la ventilation', () => {
        const dit = (corps: any) => mentionsDe(q('resume_par_axe'), corps).join(' ')
        expect(dit({ ventilations: { composanteId: { total: 912, sansRattachement: 41 } } }))
            .toContain("41 sur l'axe `composanteId`")
        // Aucun orphelin : rien à dire.
        expect(dit({ ventilations: { composanteId: { total: 912, sansRattachement: 0 } } }))
            .not.toContain('sans rattachement')
    })

    /**
     * UN TOTAL FILTRÉ ET UN TOTAL COMPLET SE RESSEMBLENT PARFAITEMENT. « 47 » répond à
     * « combien de serveurs critiques » comme à « combien de serveurs » : c'est la phrase
     * qui l'accompagne qui décide de sa justesse.
     */
    it('nomme la restriction avec le total filtré', () => {
        const dit = (params: any) => mentionsDe(q('inventaire_machines'), { rows: [], total: 47 }, params).join(' ')
        const m = dit({ catalogue: 'serveurs', criticite: 'critique' })
        expect(m).toContain('criticite=critique')
        expect(m).toContain('pas sur le catalogue entier')
        // Sans filtre, le total EST celui du catalogue : rien à préciser.
        expect(dit({ catalogue: 'serveurs' })).not.toContain('pas sur le catalogue entier')
    })

    /**
     * LES FILTRES SE MONTRENT, SINON ILS N'EXISTENT PAS. Valider un filtre reçu ne sert à
     * rien si le modèle ignore qu'il peut le poser.
     */
    it('montre les filtres publiés des catalogues que la question déclare', () => {
        const rendu = catalogueLisible([
            { catalogue: 'serveurs', filtres: [
                { champ: 'environnement', nature: 'vocabulaire', valeurs: ['production', 'recette'] },
                { champ: 'composanteId', nature: 'referentiel' },
            ] },
            // Un catalogue que la question NE déclare pas ne doit pas entrer : c'est ce qui
            // empêche 649 filtres de tomber dans une consigne qui a déjà un budget.
            { catalogue: 'clauses-iso27001', filtres: [{ champ: 'conformite', nature: 'vocabulaire', valeurs: ['ok'] }] },
        ])
        expect(rendu).toContain('environnement=production|recette')
        expect(rendu).toContain('composanteId')
        expect(rendu).toContain('combinables en ET')
        expect(rendu).not.toContain('clauses-iso27001 :')

        // LE TEXTE LIBRE N'EST PAS PROPOSÉ : son total compte une correspondance de chaîne,
        // variable avec la formulation, et se lit comme un recensement. Il reste accepté
        // s'il est demandé — on cesse d'y pousser, on ne retire pas la capacité.
        const avecBruit = catalogueLisible([{ catalogue: 'serveurs', filtres: [
            { champ: 'environnement', nature: 'vocabulaire', valeurs: ['production'] },
            { champ: 'notes', nature: 'texte' },
        ] }])
        expect(avecBruit).toContain('environnement=production')
        // Sur la LIGNE DE FILTRES, pas dans tout le rendu : « notes » figure aussi dans
        // l'intitulé d'une autre question, et une assertion trop large échoue sur un mot
        // parfaitement légitime.
        const ligne = avecBruit.split('\n').find(l => l.trim().startsWith('serveurs :')) ?? ''
        expect(ligne).toContain('environnement')
        expect(ligne).not.toContain('notes')

        // Ce que la source dit du croisement se relaie : c'est elle qui sait.
        const avecGarde = catalogueLisible([{ catalogue: 'serveurs',
            filtres: [{ champ: 'environnement', nature: 'vocabulaire', valeurs: ['production'] }],
            commentCroiser: 'Combiner en ET dans un seul appel.',
            neJamaisFaire: 'Ne pas multiplier deux proportions.' }])
        expect(avecGarde).toContain('Combiner en ET dans un seul appel')
        expect(avecGarde).toContain('Ne pas multiplier deux proportions')
    })

    it('ne montre aucun filtre quand la source n\'en publie pas', () => {
        expect(catalogueLisible()).not.toContain('combinables en ET')
    })

    it('déclare les deux filtres croisables demandés', () => {
        // LA COMBINAISON EST UNE SEULE REQUÊTE : les filtres se combinent en ET et `total`
        // est le croisement compté par la base. Deux tours ne servent qu'à OBTENIR
        // l'identifiant de composante, jamais à croiser.
        const ctx = q('inventaire_machines').contexte?.join(' ') ?? ''
        expect(ctx).toContain('MÊME appel')
        expect(ctx).toContain('décompte exact du croisement')
        expect(ctx).toContain("l'identifiant de composante ne s'invente pas")
        // Les accents graves désignent des CHAMPS : une clé de question s'écrit sans, sinon
        // le contrôle des champs fantômes la réclame en champ attendu.
        expect(ctx).not.toContain('`resume_par_axe`')
        const p = q('inventaire_machines').parametres
        expect(p.find(x => x.cle === 'criticite')?.valeurs).toContain('critique')
        // `composanteId` attend un identifiant : le libellé ne rend rien, et le libellé est
        // ce qu'un utilisateur écrit. Le dire dans l'intitulé du paramètre.
        expect(p.find(x => x.cle === 'composanteId')?.libelle).toContain('PAS son libellé')
    })

    it('énumère le recensement sous les noms de la source', () => {
        const dit = (corps: any) => mentionsDe(q('fins_de_vie'), corps).join(' ')
        const m = dit({ lignes: [{ os: 'A', machines: 1 }],
                        resume: { machinesDepassees: 610, machinesSupportees: 5480, referentielConstruit: '2026-08-30' } })
        expect(m).toContain('machinesDepassees = 610')
        // « Nombre total de COMPTES ... : 51 » — `osDistincts` rendu dans l'unité la plus
        // dangereuse de notre domaine. Le préfixe porte l'unité, et se lit.
        expect(dit({ lignes: [{ os: 'A', machines: 1 }], resume: { osDistincts: 51, machinesDepassees: 610 } }))
            .toContain('osDistincts = 51 (systèmes distincts, PAS des machines)')
        expect(dit({ lignes: [{ os: 'A', machines: 1 }], resume: { machinesDepassees: 610 } }))
            .toContain('machinesDepassees = 610 (machines)')
        expect(m).toContain('machinesSupportees = 5480')
        // Une entrée non numérique n'est pas un décompte : elle ne rentre pas au recensement.
        expect(m).not.toContain('referentielConstruit =')
    })

    it('distingue des machines non demandées de machines absentes', () => {
        const dit = (corps: any) => mentionsDe(q('incidents_liste'), corps).join(' ')
        expect(dit({ resultats: [{ id: 'A' }] })).toContain("n'ont PAS été demandées")
        expect(dit({ resultats: [{ id: 'A', machines: [] }] })).not.toContain("n'ont PAS été demandées")
        // Une liste vide ne doit rien déclencher : il n'y a aucun incident, pas des
        // incidents sans machines.
        expect(dit({ resultats: [] })).not.toContain("n'ont PAS été demandées")
    })

    it('attend le niveau P1–P4, que Sniff porte désormais à côté de `severity`', () => {
        expect(q('incidents_liste').detailsMinimums!.join(' ')).toContain('`niveau`')
    })

    it('attend le rattachement de chaque machine', () => {
        const c = q('incidents_liste').contexte!.join(' ')
        for (const x of ['entité', 'groupe', 'lieu', 'critique']) expect(c).toContain(x)
    })
})

/**
 * Le vérificateur de forme — la moitié pure du harnais des données.
 *
 * « présent » signifie « la clé existe », valeur nulle comprise : c'est le contrat des
 * sources, où `null` PORTE un sens. Et une liste vide rend « indécidable », jamais faux —
 * conclure sur une liste vide fabriquerait une fausse alerte à chaque référentiel calme.
 */
/**
 * TOUT CHAMP DONT UNE EXIGENCE DÉPEND EST VÉRIFIÉ PAR LE HARNAIS.
 *
 * Le défaut qui a motivé ce contrôle : `titre` était exigé sur les incidents et n'existe
 * pas chez Sniff. Rien ne rougissait — une exigence n'est pas une post-condition, elle ne
 * lit pas la charge utile — et la réponse sortait simplement sans intitulé. Une exigence
 * morte s'installe en silence, comme une post-condition morte, mais sans le harnais pour
 * la trahir.
 */
describe('les champs exigés sont ceux que le harnais vérifie', () => {
    // Des littéraux de VALEUR, pas des noms de champ : `conformite: null` parle de la
    // valeur nulle, pas d'un champ nommé « null ».
    const VALEURS = new Set(['null', 'true', 'false'])

    it('ne nomme aucun champ que `attendChamps` ne couvre pas', () => {
        const orphelins: string[] = []
        for (const q of QUESTIONS) {
            const texte = [...(q.detailsMinimums ?? []), ...(q.contexte ?? []), ...(q.aOmettre ?? [])].join(' ')
            const cites = [...texte.matchAll(/`([A-Za-z][A-Za-z0-9_.]*)`/g)].map(m => m[1]!)
            // LE TYPE DÉCLARÉ NE DOIT PAS ÉTEINDRE CE CONTRÔLE. `resume.referentielConstruit:boolean`
            // rendait `referentielConstruit:boolean` par `pop()`, qui n'égale aucun nom cité :
            // le champ passait pour non vérifié, et l'orphelin était signalé à tort — ou, pire,
            // un champ réellement orphelin aurait pu se cacher derrière un suffixe. Un ajout
            // qui désarme une protection est la forme la plus discrète de régression, et
            // c'est la seconde fois cette semaine, dans les deux équipes.
            const verifies = (q.attendChamps ?? []).map(c => c.split(':')[0]!.split('.').pop())
            for (const c of new Set(cites)) {
                if (!VALEURS.has(c) && !verifies.includes(c)) orphelins.push(`${q.cle}.${c}`)
            }
        }
        expect(orphelins).toEqual([])
    })
})

describe('champPresent', () => {
    it('trouve un champ plat, et un champ à null', () => {
        expect(champPresent({ total: 4 }, 'total')).toBe('present')
        expect(champPresent({ nis2: null }, 'nis2')).toBe('present')
    })

    it('descend dans les objets par la notation pointée', () => {
        expect(champPresent({ source: { dernierAccesAt: 'x' } }, 'source.dernierAccesAt')).toBe('present')
        expect(champPresent({ source: {} }, 'source.dernierAccesAt')).toBe('absent')
    })

    it('vérifie un tableau sur son premier élément', () => {
        expect(champPresent({ resultats: [{ niveau: 'P1' }] }, 'resultats.niveau')).toBe('present')
        expect(champPresent({ resultats: [{ severity: 'critical' }] }, 'resultats.niveau')).toBe('absent')
    })

    it('rend indécidable sur une liste vide plutôt que faux', () => {
        expect(champPresent({ resultats: [] }, 'resultats.niveau')).toBe('indecidable')
    })

    it('dit absent quand la clé a disparu', () => {
        expect(champPresent({ rows: [] }, 'resultats')).toBe('absent')
        expect(champPresent(null, 'total')).toBe('absent')
    })

    /**
     * UN BLOC `null` NE PARLE PAS DE SES ENFANTS. `/api/conformite/resume` rend
     * `nis2: null` quand l'appelant n'a pas le droit de lire ce cadre : ni un cadre vide,
     * ni un champ disparu — une portée. Le signaler comme absent ferait rougir le harnais
     * sur nos propres droits, et la fois d'après on cesse de croire le rouge.
     */
    it("rend indécidable sous un bloc nul, et absent sur un corps nul", () => {
        expect(champPresent({ nis2: null }, 'nis2')).toBe('present')
        expect(champPresent({ nis2: null }, 'nis2.parConformite')).toBe('indecidable')
        expect(champPresent({ nis2: { parConformite: { fait: 0 } } }, 'nis2.parConformite')).toBe('present')
        expect(champPresent({ nis2: {} }, 'nis2.parConformite')).toBe('absent')
        // Le corps entier nul n'est pas une portée : la source n'a rien rendu.
        expect(champPresent(null, 'nis2.parConformite')).toBe('absent')
    })

    // Chaque essai déclaré doit porter les valeurs de ses paramètres obligatoires à
    // valeurs fermées — sinon `executer()` les écarterait et l'appel changerait de sens.
    it('les valeurs d\'essai respectent les valeurs fermées des paramètres', () => {
        for (const q of QUESTIONS) {
            for (const [cle, v] of Object.entries(q.essai ?? {})) {
                const p = q.parametres.find(x => x.cle === cle)
                expect(p, `${q.cle}.${cle}`).toBeDefined()
                if (p!.valeurs?.length) expect(p!.valeurs, `${q.cle}.${cle}`).toContain(v)
            }
        }
    })
})

/**
 * Le pont données → procédure : l'extraction des types d'incident.
 *
 * La correspondance type → fiche est déclarée par la rédaction (`type_sniff:`), jamais
 * devinée. Cette extraction est le seul maillon calculé, et elle ne reconnaît que le
 * vocabulaire fermé de Sniff — un champ `type` qui porte autre chose n'est pas un incident.
 */
describe('extraireTypesIncidents', () => {
    it('trouve les types dans une liste d\'incidents', () => {
        expect(extraireTypesIncidents({ resultats: [{ type: 'malware' }, { type: 'ransomware' }] }).sort())
            .toEqual(['malware', 'ransomware'])
    })

    it('ignore un champ `type` hors du vocabulaire de Sniff', () => {
        // Le Catalogue emploie `type` partout — types d'échéance, d'alerte, d'entité. Sans
        // le filtre du vocabulaire, une réponse d'échéances déclencherait le pont.
        expect(extraireTypesIncidents({ resultats: [{ type: 'certificat' }, { type: 'vpn' }] }))
            .toEqual([])
    })

    it('dédoublonne et descend dans les structures', () => {
        expect(extraireTypesIncidents({ r: [{ incidents: [{ type: 'phishing' }, { type: 'phishing' }] }] }))
            .toEqual(['phishing'])
    })

    it('résiste au vide et aux cycles', () => {
        const a: any = { type: 'malware' }
        a.soi = a
        expect(() => extraireTypesIncidents(a)).not.toThrow()
        expect(extraireTypesIncidents(null)).toEqual([])
    })
})

describe('interpreterOrientation — le veto de nature', () => {
    const cleValide = QUESTIONS[0]!.cle

    it('annule une clé choisie quand la nature est « conduite »', () => {
        expect(interpreterOrientation({ nature: 'conduite', cle: cleValide, params: {} }))
            .toBeNull()
    })

    it('laisse passer une clé quand la nature est « etat »', () => {
        expect(interpreterOrientation({ nature: 'etat', cle: cleValide, params: { severity: 'P1' } }))
            .toEqual({ cle: cleValide, params: { severity: 'P1' } })
    })

    it('laisse passer quand la nature manque — le champ absent n\'éteint pas le chemin données', () => {
        expect(interpreterOrientation({ cle: cleValide }))
            .toEqual({ cle: cleValide, params: {} })
    })

    it('refuse une clé inconnue, une clé nulle, et une réponse vide', () => {
        expect(interpreterOrientation({ nature: 'etat', cle: 'question_inventee' })).toBeNull()
        expect(interpreterOrientation({ nature: 'etat', cle: null })).toBeNull()
        expect(interpreterOrientation(null)).toBeNull()
    })
})

/**
 * LA FAÇADE INTERNET, que nous ne savions pas interroger. Un service exposé, sa pile
 * logicielle, son certificat : le domaine le plus directement SSI du Catalogue, et il
 * n'était accessible par aucune question.
 */
describe('les sites et services exposés', () => {
    // `q` est local à un autre describe : on le redéclare plutôt que d'élargir sa portée.
    const q = (cle: string) => QUESTIONS.find(x => x.cle === cle)!
    const dit = (corps: any) => mentionsDe(q('services_exposes'), corps).join(' ')

    it('refuse de lire `support: null` comme « supporté »', () => {
        // Un service dont on ne sait rien est le plus inquiétant, pas le plus rassurant.
        const m = dit({ resultats: [{ support: null }, { support: 'ok' }] })
        expect(m).toContain('AUCUNE de leurs technologies')
        expect(m).toContain("Ce n'est PAS « supporté »")
        expect(dit({ resultats: [{ support: 'ok' }] })).not.toContain("Ce n'est PAS « supporté »")
    })

    it('distingue `ok` de `supporte`, comme sur les machines', () => {
        expect(dit({ resultats: [{ support: 'ok' }, { support: 'supporte' }] }))
            .toContain('deux états DISTINCTS')
        expect(dit({ resultats: [{ support: 'ok' }] })).not.toContain('deux états DISTINCTS')
    })

    /**
     * « Version inconnue » sur un service dont deux technologies sur trois sont à jour est
     * exact et inexploitable. Et masquer sa version est une BONNE pratique côté site.
     */
    it('dit ce qui est vérifié, et ne fait pas d\'une bonne pratique une anomalie', () => {
        const m = dit({ resultats: [{ miseAJour: { partiel: true, verifiees: 2, surTechnologies: 3 } }] })
        expect(m).toContain('2/3')
        expect(m).toContain('BONNE pratique')
        expect(dit({ resultats: [{ miseAJour: { partiel: false } }] })).not.toContain('PARTIELLE')
    })

    /**
     * SUR UNE MESSAGERIE, UNE LISTE VIDE EST LE RÉSULTAT ATTENDU. Le Catalogue le publie
     * dans la lecture de `service.type`, mais ce vocabulaire est NON applicable — `type` est
     * un homonyme — donc notre couche de fraîcheur ne le relaiera jamais. Une lecture
     * publiée qu'aucun mécanisme ne peut appliquer se porte à la main.
     */
    it("ne prend pas une absence de détection normale pour un échec", () => {
        const m = dit({ resultats: [{ type: 'messagerie', technologies: [] }] })
        expect(m).toContain("C'est NORMAL")
        expect(m).toContain('détection en échec')
        // Sur un service web, une liste vide n'a rien de normal : on se tait ici, la
        // question se pose ailleurs.
        expect(dit({ resultats: [{ type: 'web', technologies: [] }] })).not.toContain("C'est NORMAL")
    })

    it('emploie les vocabulaires publiés plutôt que des paramètres libres', () => {
        const p = q('services_exposes').parametres
        expect(p.find(x => x.cle === 'miseAJour')?.valeurs).toContain('non_maintenue')
        expect(p.find(x => x.cle === 'type')?.valeurs).toContain('messagerie')
        // `support` reste LIBRE : ses valeurs ne sont pas publiées, et une liste fermée
        // incomplète écarterait silencieusement les autres.
        expect(p.find(x => x.cle === 'support')?.valeurs).toBeUndefined()
    })

    it('sait conclure à la validité, et par le bon champ', () => {
        const m = mentionsDe(q('service_expose_detail'), { etat: { certificat: 'expire' } }).join(' ')
        expect(m).toContain('état DÉRIVÉ')
        expect(m).toContain('dernierStatut')
        // Le vocabulaire du certificat est celui de la source, complet.
        expect(q('services_exposes').parametres.find(x => x.cle === 'certificat')?.valeurs)
            .toContain('jamais_releve')
    })
})
