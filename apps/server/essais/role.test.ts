import { describe, expect, test } from "bun:test";
import { roleDesGroupes } from "@assistants/auth";

// Le rôle a résisté à trois correctifs successifs avant d'être compris. Ces essais tiennent
// la partie qui se teste sans annuaire : le calcul lui-même, et la tolérance de forme —
// c'est justement là qu'était la faute, la charge d'écriture ne portant pas toujours le
// même type que le profil.
describe('roleDesGroupes', () => {

    test('un tableau contenant le groupe donne admin', () => {
        expect(roleDesGroupes(['admins', 'all_users'])).toBe('admin')
    })

    // Le cas qui manquait : à la mise à jour, `groupes` arrive en CHAÎNE, telle qu'elle est
    // stockée — pas en tableau comme dans le profil OIDC.
    test('une chaîne séparée par des virgules aussi', () => {
        expect(roleDesGroupes('admins,all_users')).toBe('admin')
    })

    test('sans le groupe, user', () => {
        expect(roleDesGroupes(['all_users'])).toBe('user')
        expect(roleDesGroupes('all_users')).toBe('user')
    })

    test('absence de groupes vaut user, jamais admin', () => {
        expect(roleDesGroupes(undefined)).toBe('user')
        expect(roleDesGroupes(null)).toBe('user')
        expect(roleDesGroupes('')).toBe('user')
        expect(roleDesGroupes([])).toBe('user')
    })

    // Le nom du groupe se règle : un annuaire n'a pas toujours celui-là, et un nom faux ne
    // se voit qu'au moment où plus personne n'est administrateur.
    test('le nom du groupe est réglable', () => {
        process.env.OIDC_GROUPE_ADMIN = 'cyber-admins'
        expect(roleDesGroupes(['admins'])).toBe('user')
        expect(roleDesGroupes(['cyber-admins'])).toBe('admin')
        delete process.env.OIDC_GROUPE_ADMIN
    })

    // L'ancien nom reste lu : un `.env` en service ne doit pas perdre son réglage au
    // renommage. Sans cet essai, la régression ne se verrait qu'au jour où PERSONNE n'est
    // plus administrateur — le groupe déclaré redevenant le défaut `admins`.
    test("l'ancien nom de la variable est encore honoré", () => {
        process.env.OUATE_GROUPE_ADMIN = 'cyber-admins'
        expect(roleDesGroupes(['cyber-admins'])).toBe('admin')
        expect(roleDesGroupes(['admins'])).toBe('user')
        delete process.env.OUATE_GROUPE_ADMIN
    })

    // Et le nouveau l'emporte, pour que la bascule soit un ajout et non une cohabitation.
    test('le nom actuel prime sur l\'ancien', () => {
        process.env.OIDC_GROUPE_ADMIN = 'neufs'
        process.env.OUATE_GROUPE_ADMIN = 'anciens'
        expect(roleDesGroupes(['neufs'])).toBe('admin')
        expect(roleDesGroupes(['anciens'])).toBe('user')
        delete process.env.OIDC_GROUPE_ADMIN
        delete process.env.OUATE_GROUPE_ADMIN
    })

    test('les espaces autour des noms ne comptent pas', () => {
        expect(roleDesGroupes(' all_users , admins ')).toBe('admin')
    })
})
