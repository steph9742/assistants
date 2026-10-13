import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envOidc, lireSecretOidc } from "@assistants/auth/env";

// Le renommage `OUATE_*` → `OIDC_*` ne vaut que par son repli, et le repli ne vaut que s'il
// se déclenche DANS LES CONDITIONS DE PRODUCTION. Elles diffèrent de celles d'un essai sur un
// point décisif : `docker-compose.yml` passe chaque variable sous la forme
// `${OIDC_CLIENT_ID:-}`, donc le nouveau nom est toujours DÉFINI, à vide. C'est le cas que
// ces essais tiennent ; les autres sont là pour que celui-là ne soit pas seul.

const CLES = [
    'OIDC_CLIENT_ID', 'OUATE_CLIENT_ID',
    'OIDC_CLIENT_SECRET', 'OUATE_CLIENT_SECRET',
    'OIDC_CLIENT_SECRET_FILE', 'OUATE_CLIENT_SECRET_FILE',
]
afterEach(() => { for (const c of CLES) delete process.env[c] })

/** Écrit un secret dans un fichier jetable et rend son chemin. */
function fichierSecret(valeur: string): string {
    const chemin = join(mkdtempSync(join(tmpdir(), 'essai-oidc-')), 'secret')
    writeFileSync(chemin, valeur, { mode: 0o600 })
    return chemin
}

describe('envOidc', () => {

    test('le nom actuel est lu', () => {
        process.env.OIDC_CLIENT_ID = 'assistants'
        expect(envOidc('OIDC_CLIENT_ID')).toBe('assistants')
    })

    test("l'ancien nom seul est encore lu", () => {
        process.env.OUATE_CLIENT_ID = 'assistants'
        expect(envOidc('OIDC_CLIENT_ID')).toBe('assistants')
    })

    test('le nom actuel prime sur l\'ancien', () => {
        process.env.OIDC_CLIENT_ID = 'neuf'
        process.env.OUATE_CLIENT_ID = 'ancien'
        expect(envOidc('OIDC_CLIENT_ID')).toBe('neuf')
    })

    // LE CAS DE PRODUCTION. Un repli écrit sur la présence de la clé rendrait `undefined`
    // ici, le SSO se désactiverait tout seul, et l'essai ci-dessus continuerait de passer.
    test('le nom actuel défini mais VIDE ne masque pas l\'ancien', () => {
        process.env.OIDC_CLIENT_ID = ''
        process.env.OUATE_CLIENT_ID = 'assistants'
        expect(envOidc('OIDC_CLIENT_ID')).toBe('assistants')
    })

    test('des espaces seuls valent une valeur vide', () => {
        process.env.OIDC_CLIENT_ID = '   '
        process.env.OUATE_CLIENT_ID = 'assistants'
        expect(envOidc('OIDC_CLIENT_ID')).toBe('assistants')
    })

    test('aucun des deux noms rend undefined', () => {
        expect(envOidc('OIDC_CLIENT_ID')).toBeUndefined()
    })

    test('la valeur est débarrassée de ses espaces de bord', () => {
        process.env.OUATE_CLIENT_ID = '  assistants  '
        expect(envOidc('OIDC_CLIENT_ID')).toBe('assistants')
    })
})

describe('lireSecretOidc', () => {

    test('le nom actuel est lu', () => {
        process.env.OIDC_CLIENT_SECRET = 'neuf'
        expect(lireSecretOidc('OIDC_CLIENT_SECRET')).toBe('neuf')
    })

    test("l'ancien nom seul est encore lu", () => {
        process.env.OUATE_CLIENT_SECRET = 'ancien'
        expect(lireSecretOidc('OIDC_CLIENT_SECRET')).toBe('ancien')
    })

    test('le nom actuel défini mais VIDE ne masque pas l\'ancien', () => {
        process.env.OIDC_CLIENT_SECRET = ''
        process.env.OUATE_CLIENT_SECRET = 'ancien'
        expect(lireSecretOidc('OIDC_CLIENT_SECRET')).toBe('ancien')
    })

    // Basculer en posant la seule variante `_FILE` doit suffire : c'est la forme recommandée,
    // et exiger de renseigner aussi la variable en clair annulerait l'intérêt du fichier.
    test('la variante _FILE du nom actuel suffit à basculer', () => {
        process.env.OIDC_CLIENT_SECRET_FILE = fichierSecret('depuis-le-fichier')
        process.env.OUATE_CLIENT_SECRET = 'ancien'
        expect(lireSecretOidc('OIDC_CLIENT_SECRET')).toBe('depuis-le-fichier')
    })

    test("la variante _FILE de l'ancien nom est encore honorée", () => {
        process.env.OUATE_CLIENT_SECRET_FILE = fichierSecret('ancien-fichier')
        expect(lireSecretOidc('OIDC_CLIENT_SECRET')).toBe('ancien-fichier')
    })

    // La règle de `lireSecret` survit au repli : un fichier déclaré et illisible LÈVE, au
    // lieu de retomber en silence sur une autre valeur — ici sur l'ancien nom, ce qui
    // ferait démarrer l'application avec l'ancien secret alors qu'on croit avoir posé le
    // nouveau.
    test('un _FILE illisible lève au lieu de retomber sur l\'ancien nom', () => {
        process.env.OIDC_CLIENT_SECRET_FILE = '/introuvable/secret'
        process.env.OUATE_CLIENT_SECRET = 'ancien'
        expect(() => lireSecretOidc('OIDC_CLIENT_SECRET')).toThrow(/OIDC_CLIENT_SECRET_FILE/)
    })

    test('aucun des deux noms rend undefined', () => {
        expect(lireSecretOidc('OIDC_CLIENT_SECRET')).toBeUndefined()
    })
})
