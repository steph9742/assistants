import { createId } from "@paralleldrive/cuid2";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const id = () => text('id').primaryKey().$defaultFn(() => createId())

/**
 * RÉGLAGES — une ligne par clé, uniquement pour ce qui S'ÉCARTE du défaut.
 *
 * Le défaut vit dans le registre (`src/registre/`), pas ici : une valeur absente de cette
 * table n'est pas une valeur manquante, c'est le défaut du registre. Cela permet de faire
 * évoluer un défaut sans migration, et de lire un parc installé sans l'avoir initialisé.
 */
export const appSetting = pgTable('app_setting', {
    key: text('key').primaryKey(),
    value: text('value'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by'),
})
