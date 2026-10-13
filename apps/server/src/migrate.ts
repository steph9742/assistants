#!/usr/bin/env bun
// Applique les migrations. Service à part dans la composition : le serveur attend sa
// réussite, donc une migration qui échoue empêche le démarrage au lieu de laisser tourner
// une application sur un schéma qu'elle ne comprend pas.

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const dossier = process.env.DRIZZLE_MIGRATIONS_FOLDER
    || new URL('../../../packages/database/src/migrations', import.meta.url).pathname

const db = drizzle(process.env.DATABASE_URL!)

// pgvector avant tout le reste : la première migration crée l'extension, mais un parc
// installé avant son introduction ne l'a pas et la colonne `vecteur` échouerait.
await db.execute('CREATE EXTENSION IF NOT EXISTS vector')

await migrate(db, { migrationsFolder: dossier })
console.log('✅ migrations appliquées')
process.exit(0)
