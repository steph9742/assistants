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
        process.env.OUATE_GROUPE_ADMIN = 'cyber-admins'
        expect(roleDesGroupes(['admins'])).toBe('user')
        expect(roleDesGroupes(['cyber-admins'])).toBe('admin')
        delete process.env.OUATE_GROUPE_ADMIN
    })

    test('les espaces autour des noms ne comptent pas', () => {
        expect(roleDesGroupes(' all_users , admins ')).toBe('admin')
    })
})
