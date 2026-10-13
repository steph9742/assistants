#!/usr/bin/env bun
// COMPTE DE SECOURS.
//
// Sans lui, une panne de dex, un client OIDC mal déclaré ou un claim `groups` absent
// ferment l'application à TOUT LE MONDE — y compris à qui pourrait aller la réparer. C'est
// la même raison qui fait garder un accès local sur tout service derrière un SSO.

import { db } from "@assistants/database";
import { authSchema } from "@assistants/database/tables";
import { auth } from "@assistants/auth";
import { eq } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

// Domaine .local volontairement non routable : ce compte ne doit jamais recevoir de
// courriel, et une adresse d'apparence réelle finirait par en recevoir.
const EMAIL = process.env.SEED_ADMIN_EMAIL || 'secours@assistants.local'
const CHEMIN = process.env.SEED_PASSWORD_FILE || '.secrets/admin-password'

const [existant] = await db.select().from(authSchema.user).where(eq(authSchema.user.email, EMAIL))
if (existant) {
    console.log(`Le compte de secours « ${EMAIL} » existe déjà. Rien à faire.`)
    console.log('Pour en changer le mot de passe, supprimez-le puis relancez ce script.')
    process.exit(0)
}

// 24 octets en base64url : assez long pour qu'aucune force brute en ligne ne compte, assez
// court pour être recopié à la main une fois depuis un terminal.
const motDePasse = randomBytes(24).toString('base64url')

await auth.api.signUpEmail({
    body: { email: EMAIL, password: motDePasse, name: 'Compte de secours' },
})
await db.update(authSchema.user)
    .set({ role: 'admin', emailVerified: true })
    .where(eq(authSchema.user.email, EMAIL))

try {
    mkdirSync(dirname(CHEMIN), { recursive: true })
    writeFileSync(CHEMIN, `${EMAIL}\n${motDePasse}\n`, { mode: 0o600 })
}
catch {
    // Volume non inscriptible : on l'affiche quand même, sinon le compte est perdu.
    console.error(`⚠️  Impossible d'écrire dans ${CHEMIN} — notez le mot de passe MAINTENANT.`)
}

console.log('')
console.log('  Compte de secours créé.')
console.log(`  identifiant  ${EMAIL}`)
console.log(`  mot de passe ${motDePasse}`)
console.log('')
console.log(`  Déposé dans ${CHEMIN} (mode 0600). Affiché une seule fois.`)
console.log('  À sauvegarder avec .secrets/, comme la clé de chiffrement des réglages.')
console.log('')
process.exit(0)
