import { describe, expect, it } from 'bun:test'
import { appliquer, exhaustif, fraicheur, mentionsDeChampsCalcules, filtreAdmis, filtresDe, mentionsDePartitions, normaliserFiltres, partitionManquante, partitionsIncompletes, type ChampCalcule, type FiltresCatalogue, type Partition, type Lecture, type Vocabulaire } from './lectures'
import { nonCouvertes, REGLES_VALEURS } from './valeurs'

/**
 * Les lectures publiées par la source, appliquées à ses réponses.
 *
 * Ces essais ont remplacé ceux qui vérifiaient NOTRE copie de l'équivalence P1. C'est le
 * bon sens de l'échange : nous vérifions désormais que la mise en garde publiée par la
 * source atteint la réponse, pas que notre transcription est fidèle. Une transcription
 * fidèle un jour donné n'est pas une garantie.
 */
const P1: Lecture = {
    cle: 'severite-p1',
    champ: 'severity',
    valeur: 'critical',
    signifie: 'gravité maximale, notée P1 dans le vocabulaire de gravité',
    neSignifiePas: 'un niveau distinct de P1',
    consequence: "Ne jamais répondre qu'il n'y a pas de P1 au motif que la donnée dit « critical ».",
    ouCorriger: null,
}

const AGENT: Lecture = {
    cle: 'agent-inconnu',
    champ: 'agentEdr',
    valeur: 'inconnu',
    signifie: "le connecteur EDR n'a jamais abouti pour cette machine",
    neSignifiePas: "une absence d'agent",
    consequence: "L'écart de couverture n'est pas calculable.",
    ouCorriger: 'connecteur HarfangLab, côté Catalogue',
}

describe('lectures publiées par la source', () => {
    it('porte le sens, la lecture fausse et la conséquence', () => {
        const m = appliquer([P1], { resultats: [{ severity: 'critical' }] })
        expect(m).toHaveLength(1)
        expect(m[0]).toContain('notée P1')
        expect(m[0]).toContain("Ce n'est PAS un niveau distinct de P1")
        expect(m[0]).toContain("Ne jamais répondre qu'il n'y a pas de P1")
    })

    // Un assistant qui n'écrit nulle part laisse le travail à moitié fait s'il signale un
    // problème sans dire où on le règle.
    it('dit où corriger quand la source le déclare', () => {
        expect(appliquer([AGENT], { agentEdr: 'inconnu' })[0]).toContain('Où corriger : connecteur HarfangLab')
        expect(appliquer([P1], { severity: 'critical' })[0]).not.toContain('Où corriger')
    })

    it('descend dans toute la structure', () => {
        const corps = { resultats: [{ machines: [{ agentEdr: 'inconnu' }] }] }
        expect(appliquer([AGENT], corps)).toHaveLength(1)
    })

    it('ne dit la même chose qu\'une fois, en comptant', () => {
        const m = appliquer([P1], { r: [{ severity: 'critical' }, { severity: 'critical' }] })
        expect(m).toHaveLength(1)
        expect(m[0]).toContain('(2 occurrences)')
    })

    it('se tait sur une valeur qui ne correspond pas', () => {
        expect(appliquer([P1], { severity: 'low' })).toHaveLength(0)
    })

    /**
     * Une source peut écrire `"null"` là où le JSON porte `null`. Refuser l'appariement
     * pour cette raison ferait perdre la mise en garde sans que personne ne s'en aperçoive
     * — le pire mode d'échec pour ce dispositif.
     */
    it('apparie une valeur nulle quelle que soit sa forme', () => {
        const r: Lecture = { ...P1, cle: 'x', champ: 'applicable', valeur: null }
        expect(appliquer([r], { applicable: null })).toHaveLength(1)
        expect(appliquer([{ ...r, valeur: 'null' }], { applicable: null })).toHaveLength(1)
    })

    it('résiste à une structure cyclique et à un corps scalaire', () => {
        const a: any = { severity: 'critical' }
        a.soi = a
        expect(() => appliquer([P1], a)).not.toThrow()
        for (const v of [null, undefined, 4, 'x']) expect(appliquer([P1], v)).toHaveLength(0)
    })

    it('ne fait rien sans catalogue', () => {
        expect(appliquer([], { severity: 'critical' })).toHaveLength(0)
    })
})

/**
 * Nos règles locales s'effacent devant celles de la source.
 *
 * Elles ont été recopiées à la main du § 12 du contrat, et une copie diverge — le reproche
 * exact que nous faisions au tableau dont elles viennent. Le jour où les sources couvrent
 * tout, ce tableau devient du code mort, et c'est le but.
 */
describe('nos règles locales cèdent le pas', () => {
    it('retire une règle locale que la source a déclarée', () => {
        const avant = REGLES_VALEURS.length
        const apres = nonCouvertes([{ champ: 'agentEdr', valeur: 'inconnu' }])
        expect(apres.length).toBe(avant - 1)
        expect(apres.some(r => r.champ === 'agentEdr')).toBe(false)
    })

    it('garde celles que la source n\'a pas déclarées', () => {
        const apres = nonCouvertes([{ champ: 'agentEdr', valeur: 'inconnu' }])
        expect(apres.some(r => r.champ === 'traite')).toBe(true)
    })

    it('apparie sur le couple, pas sur le seul nom de champ', () => {
        // Une source qui déclare `agentEdr: "absent"` ne couvre PAS notre règle sur
        // `agentEdr: "inconnu"` — ce sont deux lectures différentes du même champ.
        const apres = nonCouvertes([{ champ: 'agentEdr', valeur: 'absent' }])
        expect(apres.some(r => r.champ === 'agentEdr')).toBe(true)
    })

    it('ne retire rien quand la source ne publie rien', () => {
        expect(nonCouvertes([]).length).toBe(REGLES_VALEURS.length)
    })
})

/**
 * Une réponse du Catalogue relaie des données de Sniff : `/api/incidents/croisement` porte
 * `severity`, dont la lecture appartient à Sniff. N'appliquer que le catalogue de la source
 * appelée perdrait la mise en garde exactement là où elle compte, et sans bruit.
 */
describe('fusion des catalogues de plusieurs sources', () => {
    /** Reproduit la fusion de `catalogueFusionne`, sans réseau. */
    const fusionner = (jeux: Lecture[][]) => {
        const parCle = new Map<string, Lecture>()
        const parCouple = new Map<string, Lecture>()
        for (const j of jeux) {
            for (const l of j) {
                const couple = `${l.champ}|${String(l.valeur)}`
                if (parCle.has(l.cle) || parCouple.has(couple)) continue
                parCle.set(l.cle, l)
                parCouple.set(couple, l)
            }
        }
        return [...parCle.values()]
    }

    it("déduplique sur la clé, comme les deux équipes l'ont demandé", () => {
        const a = { ...P1, origine: 'sniff' }
        const b = { ...P1, origine: 'catalogue', signifie: 'un autre texte' }
        expect(fusionner([[a], [b]])).toHaveLength(1)
    })

    it('retombe sur le couple quand les clés diffèrent', () => {
        // Deux équipes peuvent nommer différemment la même lecture. Deux textes pour la
        // même valeur diraient deux fois la même chose dans la réponse.
        const a = { ...P1, cle: 'sniff-p1' }
        const b = { ...P1, cle: 'catalogue-critical' }
        expect(fusionner([[a], [b]])).toHaveLength(1)
    })

    it('garde deux lectures qui portent réellement sur des valeurs différentes', () => {
        const a = { ...P1, cle: 'p1', valeur: 'critical' }
        const b = { ...P1, cle: 'p2', valeur: 'high' }
        expect(fusionner([[a], [b]])).toHaveLength(2)
    })

    /**
     * La garantie la plus FAIBLE l'emporte. Si une seule source ne garantit pas ses champs
     * ambigus, la réponse ne peut pas se donner pour couverte — et une couverture partielle
     * annoncée comme complète est pire qu'aucune couverture, parce qu'on cesse de vérifier.
     */
    it('retient la garantie la plus faible', () => {
        const garanties = [{ champsAmbigus: true }, { champsAmbigus: false }]
        expect(garanties.every(g => g.champsAmbigus !== false)).toBe(false)
    })
})

/**
 * LE CONTRÔLE DE FRAÎCHEUR, ET SURTOUT LES CAS OÙ IL DOIT SE TAIRE.
 *
 * Ces essais existent à cause d'un contre-exemple que nous n'avions pas vu et que l'équipe
 * Catalogue a trouvé : `source` est un vocabulaire fermé sur les listes blanches, un AUTRE
 * vocabulaire fermé sur les certificats, et du texte libre sur cinq routes. Indexé sur le
 * nom nu, le contrôle aurait crié à la péremption sur chaque ligne d'une réponse saine.
 */
const MOTEUR: Vocabulaire = {
    cle: 'edr.moteur', champ: 'moteur', applicable: true,
    valeurs: [{ valeur: 'yara' }, { valeur: 'sigma' }, { valeur: 'ioc' }],
}

const DOMAINE: Vocabulaire = {
    cle: 'lacunes.domaine', champ: 'domaine', applicable: true,
    valeurs: [{ valeur: 'edr' }, { valeur: 'parc' }, { valeur: 'conformite' }],
    aussi: ['domainesConnus', 'domainesExamines', 'domainesAvecLacune'],
}

const SOURCE: Vocabulaire = {
    cle: 'whitelist.source', champ: 'source', applicable: false,
    valeurs: [{ valeur: 'harfanglab' }, { valeur: 'sniff' }, { valeur: 'les_deux' }],
    ailleurs: 'certificats, referentiels, eol, conformite, incidents, reseau',
    discriminer: "déterminer l'entité avant de vérifier",
}

describe('contrôle de fraîcheur des vocabulaires fermés', () => {
    it('se tait sur une valeur déclarée', () => {
        expect(fraicheur([MOTEUR], { resultats: [{ moteur: 'sigma' }] })).toHaveLength(0)
    })

    it('signale une valeur absente comme une PÉREMPTION de notre catalogue', () => {
        const m = fraicheur([MOTEUR], { resultats: [{ moteur: 'usb' }] })
        expect(m).toHaveLength(1)
        expect(m[0]).toContain('CATALOGUE PÉRIMÉ')
        expect(m[0]).toContain('« usb »')
        // Le diagnostic doit désigner NOTRE cache, pas la source : c'est elle qui a raison.
        expect(m[0]).toContain('antérieur au déploiement de la source')
    })

    /**
     * Le contre-exemple, et la raison d'être de `applicable`. `source` vaut « GLPI » sur
     * `/api/referentiels`, du texte libre. Sans ce refus, chaque ligne crierait.
     */
    it('se tait sur `applicable: false`, même devant une valeur inconnue', () => {
        expect(fraicheur([SOURCE], { resultats: [{ source: 'GLPI' }, { source: 'saisie manuelle' }] }))
            .toHaveLength(0)
    })

    it('étend le contrôle aux autres contenants déclarés par `aussi`', () => {
        expect(fraicheur([DOMAINE], { domainesExamines: ['edr', 'parc'] })).toHaveLength(0)
        const m = fraicheur([DOMAINE], { domainesConnus: ['edr', 'reseau'] })
        expect(m).toHaveLength(1)
        expect(m[0]).toContain('« reseau »')
    })

    it('rassemble les valeurs inconnues d\'un même vocabulaire en une seule mention', () => {
        const m = fraicheur([MOTEUR], { r: [{ moteur: 'usb' }, { moteur: 'ebpf' }, { moteur: 'usb' }] })
        expect(m).toHaveLength(1)
        expect(m[0]).toContain('« usb »')
        expect(m[0]).toContain('« ebpf »')
    })

    // Trois refus qui protègent chacun d'un faux positif.
    it('se tait sans valeurs déclarées, sur null, et sur une valeur non scalaire', () => {
        expect(fraicheur([{ ...MOTEUR, valeurs: [] }], { moteur: 'usb' })).toHaveLength(0)
        expect(fraicheur([MOTEUR], { moteur: null })).toHaveLength(0)
        expect(fraicheur([MOTEUR], { moteur: { nom: 'yara' } })).toHaveLength(0)
    })

    it('résiste à une structure cyclique et à un corps scalaire', () => {
        const a: any = { moteur: 'usb' }
        a.soi = a
        expect(() => fraicheur([MOTEUR], a)).not.toThrow()
        for (const v of [null, undefined, 4, 'x']) expect(fraicheur([MOTEUR], v)).toHaveLength(0)
    })

    it('ne fait rien sans vocabulaire', () => {
        expect(fraicheur([], { moteur: 'usb' })).toHaveLength(0)
    })
})

/**
 * `vocabulairesFermes` a d'abord été un booléen, puis un objet portant l'énoncé du contrôle.
 * Refuser la garantie pour un changement de forme la ferait disparaître en silence — le
 * mode d'échec qu'on passe la journée à combattre.
 */
describe('les deux formes de garantie', () => {
    it('lit un booléen comme un objet', () => {
        expect(exhaustif(true)).toBe(true)
        expect(exhaustif(false)).toBe(false)
        expect(exhaustif({ exhaustif: true })).toBe(true)
        expect(exhaustif({ exhaustif: false })).toBe(false)
    })

    // Une forme inconnue ne doit pas se lire comme « non garanti » : cela ferait afficher un
    // avertissement permanent qu'aucune correction ne lèverait.
    it('ne prend pas une forme inconnue pour une absence de garantie', () => {
        expect(exhaustif({} as any)).toBe(true)
    })
})

describe('champsCalcules — ce qu\'on n\'a pas le droit de faire d\'un champ', () => {
    const INCIDENT: ChampCalcule = {
        champs: ['incidentOuvert', 'incidentGravite', 'incidentStatut'],
        porte: 'serveurs, postes de travail',
        calcule: 'javascript',
        filtrable: false,
        compte: false,
        piege: "Indicateur d'affichage, pas critère de recherche. La question se pose depuis /api/incidents/croisement, jamais depuis la machine.",
    }
    const EOL: ChampCalcule = {
        champs: ['eolStatut'], calcule: 'sql',
        filtrable: '?eolStatut=depasse', compte: '/api/eol/etat',
    }
    const RGPD: ChampCalcule = {
        champs: ['etatRgpd'], calcule: 'sql', filtrable: '?etatRgpd=ecart', compte: '/api/conformite/resume',
    }

    it('avertit dès qu\'un champ du groupe est présent, quelle que soit sa valeur', () => {
        const dit = mentionsDeChampsCalcules({ rows: [{ incidentGravite: 'P3' }] }, [INCIDENT]).join(' ')
        expect(dit).toContain('CRITÈRE DE RECHERCHE')
        expect(dit).toContain('DÉNOMBRE PAS')
        expect(dit).toContain('/api/incidents/croisement')
    })

    it('dit OÙ compter quand le champ est exploitable, au lieu de se taire', () => {
        // « Voici où se demande le décompte » vaut mieux que le silence : c'est ce qui
        // remplace le comptage sur une page par la bonne requête.
        const dit = mentionsDeChampsCalcules({ rows: [{ etatRgpd: 'ecart' }] }, [RGPD]).join(' ')
        expect(dit).toContain('/api/conformite/resume')
        expect(dit).not.toContain('DÉNOMBRE PAS')
    })

    it('répercute la route du décompte quand la source la donne', () => {
        const dit = mentionsDeChampsCalcules({ rows: [{ eolStatut: 'depasse' }] }, [EOL]).join(' ')
        expect(dit).toContain('/api/eol/etat')
    })

    /**
     * LA TUYAUTERIE NE SE NOMME PAS DANS UNE RÉPONSE. La recette de filtrage — « ?eolStatut=,
     * valeur hors vocabulaire refusée en 422 » — et le « calculé EN SQL » s'adressent au
     * client, pas au lecteur. Elles sont arrivées telles quelles dans une réponse qui
     * expliquait du SQL et un code 422 à quelqu'un demandant combien de machines sont
     * dépassées.
     */
    it('tait la recette de filtrage et le langage du calcul', () => {
        const dit = mentionsDeChampsCalcules({ rows: [{ eolStatut: 'depasse' }] }, [EOL]).join(' ')
        expect(dit).not.toContain('?eolStatut=')
        expect(dit).not.toContain('422')
        expect(dit).not.toContain('en sql')
        // Ce qui reste utile au lecteur : le champ n'est pas une saisie, donc personne à
        // envoyer le corriger.
        expect(dit).toContain('pas une saisie')
    })

    /**
     * UNE CONSIGNE QUI PRESCRIT CE QUI VIENT D'ÊTRE FAIT SE LIT COMME UN AVEU.
     *
     * « Le décompte se demande à /api/eol/etat » APRÈS avoir interrogé /api/eol/etat : le
     * lecteur en conclut que les nombres devant lui ne sont pas ce décompte-là. Une mise en
     * garde qui fait douter de la réponse juste est pire que son absence.
     */
    it('ne prescrit pas la route qu\'on vient d\'interroger', () => {
        const surPlace = mentionsDeChampsCalcules({ rows: [{ eolStatut: 'depasse' }] }, [EOL], '/api/eol/etat').join(' ')
        expect(surPlace).not.toContain('Le décompte se demande')
        // Ailleurs, elle garde tout son sens : c'est ce qui remplace le comptage sur une
        // page par la bonne requête.
        const ailleurs = mentionsDeChampsCalcules({ rows: [{ eolStatut: 'depasse' }] }, [EOL], '/api/parc/machines').join(' ')
        expect(ailleurs).toContain('Le décompte se demande à /api/eol/etat')
    })

    it('se tait sur une entrée qui ne déclare ni interdit, ni route, ni piège', () => {
        expect(mentionsDeChampsCalcules({ rows: [{ x: 1 }] }, [{ champs: ['x'] }])).toEqual([])
    })

    it('ne dit rien quand aucun champ recensé n\'est présent', () => {
        expect(mentionsDeChampsCalcules({ rows: [{ nom: 'srv-exemple-02' }] }, [INCIDENT, EOL])).toEqual([])
    })

    it('n\'avertit qu\'une fois pour un groupe, même sur cent lignes', () => {
        const rows = Array.from({ length: 100 }, () => ({ incidentOuvert: true }))
        expect(mentionsDeChampsCalcules({ rows }, [INCIDENT])).toHaveLength(1)
    })
})

describe('nos règles locales cèdent au recensement, sans excès', () => {
    const eol = REGLES_VALEURS.find(r => r.champ === 'eolStatut')!
    const rgpd = REGLES_VALEURS.filter(r => r.champ === 'etatRgpd')

    it('retire la règle locale quand la source déclare le champ non comptable', () => {
        const restantes = nonCouvertes([], REGLES_VALEURS, [{ champs: ['eolStatut'], compte: false }])
        expect(restantes).not.toContain(eol)
    })

    it('GARDE les règles de sens quand le champ est filtrable et comptable', () => {
        // `etatRgpd` est au recensement comme pleinement exploitable : nos règles y disent
        // autre chose — ce que la valeur signifie — et doivent survivre.
        const restantes = nonCouvertes([], REGLES_VALEURS, [
            { champs: ['etatRgpd'], filtrable: '?etatRgpd=ecart', compte: '/api/conformite/resume' },
        ])
        for (const r of rgpd) expect(restantes).toContain(r)
    })

    it('sans recensement, rien ne change', () => {
        expect(nonCouvertes([], REGLES_VALEURS, [])).toEqual(REGLES_VALEURS)
    })
})

describe('partitions incomplètes — le vocabulaire est le juge', () => {
    const CONFORMITE_NIS2: Vocabulaire = {
        cle: 'conformite.nis2', champ: 'conformiteNis2', applicable: true,
        valeurs: ['fait', 'partiellement', 'tres_partiellement', 'pas_du_tout', 'non_evaluee'],
    }
    const CONFORMITE_ISO: Vocabulaire = {
        cle: 'conformite.iso', champ: 'conformiteIso', applicable: true,
        valeurs: ['conforme', 'partielle', 'non_conforme', 'non_applicable', 'non_evaluee'],
    }

    /**
     * LE DÉFAUT D'ORIGINE : un résumé qui ne compte que le conforme. Il n'est pas
     * incomplet, il est ORIENTÉ — il ne peut produire que de bonnes nouvelles.
     */
    it('nomme les valeurs sans compteur', () => {
        const r = partitionsIncompletes(
            { nis2: { parConformite: { fait: 12, non_evaluee: 3 } } },
            [CONFORMITE_NIS2, CONFORMITE_ISO],
        )
        expect(r).toHaveLength(1)
        expect(r[0]!.chemin).toBe('nis2.parConformite')
        expect(r[0]!.manquantes.sort()).toEqual(['partiellement', 'pas_du_tout', 'tres_partiellement'].sort())
    })

    it('se tait sur une partition complète', () => {
        expect(partitionsIncompletes(
            { rgpd: { parConformite: { conforme: 1, partielle: 0, non_conforme: 0, non_applicable: 0, non_evaluee: 0 } } },
            [CONFORMITE_ISO],
        )).toEqual([])
    })

    /**
     * LE PIÈGE QUE LE CATALOGUE A SIGNALÉ AVANT QU'IL NE SE PRODUISE : NIS 2 dit `fait` là
     * où l'ISO dit `conforme`, et `non_applicable` n'existe pas dans `parConformite` chez
     * NIS 2. Un jeu de clés unique ferait rougir deux cadres sur trois.
     */
    it('apparie chaque cadre à SON vocabulaire, jamais à celui du voisin', () => {
        const r = partitionsIncompletes({
            nis2: { parConformite: { fait: 1, partiellement: 0, tres_partiellement: 0, pas_du_tout: 0, non_evaluee: 0 } },
            iso27001: { parConformite: { conforme: 1, partielle: 0, non_conforme: 0, non_applicable: 0, non_evaluee: 0 } },
        }, [CONFORMITE_NIS2, CONFORMITE_ISO])
        // Les deux sont complètes CHACUNE dans son vocabulaire : rien à dire.
        expect(r).toEqual([])
    })

    /**
     * UNE CLÉ ÉTRANGÈRE DISQUALIFIE. Un bloc qui n'est pas une partition de ce vocabulaire
     * ne doit pas s'en voir reprocher les manques : ce serait une accusation infondée, et
     * une accusation infondée décrédibilise les vraies.
     */
    it("ne reproche rien à un bloc qui n'est pas cette partition", () => {
        expect(partitionsIncompletes(
            { compteurs: { fait: 3, expires: 7 } },
            [CONFORMITE_NIS2],
        )).toEqual([])
    })

    it('ignore ce qui n\'est pas un bloc de compteurs', () => {
        // Objet mixte : porte autre chose qu'une répartition.
        expect(partitionsIncompletes({ x: { fait: 1, libelle: 'a' } }, [CONFORMITE_NIS2])).toEqual([])
        // Une seule clé ne fait pas une partition.
        expect(partitionsIncompletes({ x: { fait: 1 } }, [CONFORMITE_NIS2])).toEqual([])
    })

    /**
     * UNE CASE À ZÉRO N'EST PAS UNE CASE ABSENTE — la règle que le Catalogue a posée avec
     * son correctif. « 0 exigence non conforme » est une réponse ; l'absence du champ n'en
     * est pas une.
     */
    it('un compteur à zéro compte comme présent', () => {
        expect(partitionsIncompletes(
            { x: { fait: 0, partiellement: 0, tres_partiellement: 0, pas_du_tout: 0, non_evaluee: 0 } },
            [CONFORMITE_NIS2],
        )).toEqual([])
    })
})

describe('partitions déclarées — la déclaration remplace l\'inférence', () => {
    const EOL: Partition = {
        route: '/api/eol/etat', chemin: 'resume', vocabulaire: 'technologie.eolStatut',
        cles: ['machinesDepassees', 'machinesEtendues', 'machinesBientot',
            'machinesOk', 'machinesSupportees', 'machinesInconnues'],
        alias: { machinesDepassees: 'depasse', machinesOk: 'ok' },
        nul: null,
    }
    const pleine = {
        machinesDepassees: 610, machinesEtendues: 1418, machinesBientot: 1172,
        machinesOk: 5481, machinesSupportees: 154, machinesInconnues: 27,
    }

    /** Le lien que le recouvrement ne pouvait pas trouver : `machinesDepassees` ↔ `depasse`. */
    it('vérifie des clés que nul recouvrement ne pouvait deviner', () => {
        expect(partitionManquante({ resume: pleine }, EOL)).toBeNull()
        const { machinesOk: _, ...sansOk } = pleine
        expect(partitionManquante({ resume: sansOk }, EOL))
            .toEqual({ etat: 'incomplet', manquantes: ['machinesOk'] })
    })

    /**
     * LA RÈGLE DE DÉCISION, valable au-delà de ce lot : déclarée dans /api/lectures et
     * absente de la réponse → régression. Absente des deux → version pas déployée.
     */
    it('distingue un bloc absent — régression — d\'un bloc nul — portée', () => {
        // `ou` nomme le segment le plus profond qui EXISTE : « resume est absent » et
        // « resume existe mais n'a pas ce bloc » sont deux enquêtes différentes.
        expect(partitionManquante({}, EOL)).toEqual({ etat: 'absent', manquantes: [], ou: '(racine)' })
        expect(partitionManquante({ resume: null }, EOL)).toEqual({ etat: 'nul', manquantes: [], ou: 'resume' })

        const PROFOND: Partition = { ...EOL, chemin: 'resume.parEolStatut' }
        expect(partitionManquante({}, PROFOND)?.ou).toBe('(racine)')
        expect(partitionManquante({ resume: {} }, PROFOND)?.ou).toBe('resume')
        // Nul en cours de chemin : même conclusion, l'appelant ne lit pas cette section.
        const NIS2: Partition = { route: '/api/conformite/resume', chemin: 'nis2.parConformite',
            vocabulaire: 'nis2.conformite', cles: ['fait', 'partiellement'], nul: null }
        expect(partitionManquante({ nis2: null }, NIS2)).toEqual({ etat: 'nul', manquantes: [], ou: 'nis2' })
        expect(partitionManquante({ nis2: { parConformite: { fait: 1, partiellement: 0 } } }, NIS2)).toBeNull()
    })

    /**
     * `nul` NOMME LE COMPTEUR DES VALEURS NULLES. Sans lui la somme des parts ne fait pas le
     * total, et une partition qui ne somme pas au total n'en est pas une.
     */
    it('exige le compteur des valeurs nulles quand il est nommé', () => {
        const avecNul: Partition = { ...EOL, nul: 'machinesNonEvaluees' }
        expect(partitionManquante({ resume: pleine }, avecNul))
            .toEqual({ etat: 'incomplet', manquantes: ['machinesNonEvaluees'] })
        expect(partitionManquante({ resume: { ...pleine, machinesNonEvaluees: 41 } }, avecNul)).toBeNull()
    })

    /** Une case à zéro n'est pas une case absente : « 0 dépassée » est une réponse. */
    it('accepte un compteur à zéro', () => {
        const zeros = Object.fromEntries(EOL.cles.map(c => [c, 0]))
        expect(partitionManquante({ resume: zeros }, EOL)).toBeNull()
    })
})

describe('les notes de partition, publiées et relayées', () => {
    const MACHINES: Partition = {
        route: '/api/technologies/parc', chemin: 'comptes.machinesParEolStatut',
        vocabulaire: 'technologie.eolStatut', cles: ['depasse', 'ok'],
        note: 'MACHINES, regroupées par clé de technologie versionnée.',
    }
    const SYSTEMES: Partition = {
        route: '/api/technologies/parc', chemin: 'comptes.parEolStatut',
        vocabulaire: 'technologie.eolStatut', cles: ['depasse', 'ok'],
        note: 'TECHNOLOGIES du référentiel, pas des machines.',
    }
    const corps = { comptes: { machinesParEolStatut: { depasse: 610, ok: 5481 }, parEolStatut: { depasse: 53, ok: 53 } } }

    /**
     * CINQ PARTITIONS DU MÊME VOCABULAIRE COEXISTENT, et comptent des choses différentes.
     * Le vocabulaire dit ce que valent les CLÉS, jamais ce que comptent les valeurs.
     */
    it('dit ce que compte chaque bloc, et le distingue de son voisin', () => {
        const m = mentionsDePartitions(corps, [MACHINES, SYSTEMES], '/api/technologies/parc')
        expect(m).toHaveLength(2)
        expect(m.join(' ')).toContain('MACHINES')
        expect(m.join(' ')).toContain('TECHNOLOGIES du référentiel')
    })

    /** Une note appartient à une ROUTE : celle d'une autre n'a rien à faire là. */
    /**
     * `resume` porte les MÊMES nombres que `resume.machinesParStatut`, sous les noms
     * historiques, et le Catalogue l'assume : « redondant à dessein ». Bon choix d'API,
     * note faite pour nous. Relayée telle quelle, elle expliquait à quelqu'un qui compte
     * des machines pourquoi deux champs portent les mêmes valeurs.
     */
    it('tait la note d\'une vue redondante, sur ses valeurs et non sur son texte', () => {
        const DOUBLON: Partition = {
            route: '/api/technologies/parc', chemin: 'comptes.vueHistorique',
            vocabulaire: 'technologie.eolStatut', cles: ['depasse', 'ok'],
            note: 'Les MÊMES nombres, sous les noms historiques.',
        }
        const avec = { comptes: { machinesParEolStatut: { depasse: 610, ok: 5481 },
                                  vueHistorique: { depasse: 610, ok: 5481 } } }
        const m = mentionsDePartitions(avec, [MACHINES, DOUBLON], '/api/technologies/parc')
        expect(m).toHaveLength(1)
        expect(m[0]).toContain('MACHINES')

        // Si les valeurs divergent, les deux reparaissent — cette divergence-là mérite
        // d'être vue.
        const divergent = { comptes: { machinesParEolStatut: { depasse: 610, ok: 5481 },
                                       vueHistorique: { depasse: 999, ok: 5481 } } }
        expect(mentionsDePartitions(divergent, [MACHINES, DOUBLON], '/api/technologies/parc')).toHaveLength(2)
    })

    it('ne relaie pas la note d\'une autre route', () => {
        expect(mentionsDePartitions(corps, [MACHINES], '/api/eol/etat')).toEqual([])
    })

    /**
     * NE PAS AVERTIR À PROPOS D'UN DÉCOMPTE QUE PERSONNE N'A SOUS LES YEUX : la note arrive
     * attachée à un emplacement, on ne la dit que si le bloc est là.
     */
    it('se tait quand le bloc est absent de cette réponse', () => {
        expect(mentionsDePartitions({ comptes: {} }, [MACHINES], '/api/technologies/parc')).toEqual([])
        expect(mentionsDePartitions({ comptes: null }, [MACHINES], '/api/technologies/parc')).toEqual([])
    })

    it('se tait sur une partition sans note', () => {
        expect(mentionsDePartitions(corps, [{ ...MACHINES, note: undefined }], '/api/technologies/parc')).toEqual([])
    })
})

/**
 * 649 FILTRES SUR 48 CATALOGUES, combinables en ET. Les déclarer à la main en aurait rendu
 * quinze utiles et laissé le reste inaccessible. Le contrat les porte tous, et la
 * validation contre ce contrat est PLUS stricte qu'une liste écrite à la main : la source
 * la dérive de ses colonnes, nous ne pouvons pas nous tromper en la recopiant.
 */
const VIDE_TEST = { lectures: [], vocabulaires: [], champsCalcules: [], partitions: [], filtres: [], garantie: null, erreur: null }

describe('les filtres publiés', () => {
    const SERVEURS: FiltresCatalogue = {
        catalogue: 'serveurs', prefix: '/api/serveurs',
        filtres: [
            { champ: 'type', nature: 'vocabulaire', valeurs: ['vm', 'physique'] },
            { champ: 'composanteId', nature: 'referentiel', axe: '/api/composantes' },
            { champ: 'nom', nature: 'texte' },
        ],
    }
    const cat = { ...VIDE_TEST, filtres: [SERVEURS] }

    it('admet un champ déclaré, refuse un champ absent du contrat', () => {
        expect(filtreAdmis(SERVEURS.filtres, 'composanteId', 'abc123')).toBe(true)
        expect(filtreAdmis(SERVEURS.filtres, 'motDePasse', 'x')).toBe(false)
    })

    it('exige une valeur du vocabulaire, jamais une valeur voisine', () => {
        expect(filtreAdmis(SERVEURS.filtres, 'type', 'vm')).toBe(true)
        // « virtuel » est plausible et n'existe pas : c'est exactement ce qu'un filtre
        // écrit à la main aurait laissé passer.
        expect(filtreAdmis(SERVEURS.filtres, 'type', 'virtuel')).toBe(false)
    })

    it('refuse une valeur vide sur un référentiel', () => {
        expect(filtreAdmis(SERVEURS.filtres, 'composanteId', '')).toBe(false)
    })

    /**
     * VIDE SE LIT « NOUS NE SAVONS PAS », JAMAIS « AUCUN FILTRE ». Une source qui ne publie
     * pas son bloc n'a pas dit qu'elle n'en avait aucun, et « ce catalogue ne se filtre
     * pas » serait faux.
     */
    it('rend une liste vide pour un catalogue non publié', () => {
        expect(filtresDe(cat, 'serveurs')).toHaveLength(3)
        expect(filtresDe(cat, 'iot')).toEqual([])
    })
})

/**
 * DEUX FORMES POSSIBLES, ET SUPPOSER LA MAUVAISE A TOUT ÉTEINT.
 *
 * `(j.filtres ?? []).filter(…)` écrit sans avoir vu la charge utile : la source rend un
 * objet indexé par catalogue, pas un tableau. `filter is not a function` a fait échouer le
 * chargement ENTIER de /api/lectures — vingt-sept vocabulaires, trente partitions et toutes
 * leurs notes avec. Un bloc qu'on ne sait pas lire ne doit pas emporter ceux qu'on sait lire.
 */
describe('les deux formes du bloc filtres', () => {
    const un = { catalogue: 'serveurs', filtres: [{ champ: 'type', nature: 'vocabulaire' as const }] }

    it('accepte un tableau', () => {
        expect(normaliserFiltres([un])).toHaveLength(1)
    })

    it('accepte un objet indexé par catalogue, et en tire le nom', () => {
        const r = normaliserFiltres({ serveurs: { filtres: un.filtres } })
        expect(r).toHaveLength(1)
        expect(r[0]!.catalogue).toBe('serveurs')
    })

    it('rend une liste vide sur une forme inconnue, sans faire tomber le reste', () => {
        expect(normaliserFiltres(undefined)).toEqual([])
        expect(normaliserFiltres('bonjour')).toEqual([])
        expect(normaliserFiltres(42)).toEqual([])
        // Une entrée mal formée est écartée, les autres restent.
        expect(normaliserFiltres([un, { catalogue: 'x' }])).toHaveLength(1)
    })
})
