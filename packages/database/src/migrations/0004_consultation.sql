CREATE TABLE "consultation" (
	"id" text PRIMARY KEY NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"utilisateur" text,
	"outil" text NOT NULL,
	"question" text,
	"taille_entree" integer DEFAULT 0 NOT NULL,
	"trouve" boolean,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modele" text,
	"consigne" text,
	"duree_ms" integer,
	"erreur" text
);
--> statement-breakpoint
CREATE INDEX "consultation_date" ON "consultation" USING btree ("date");--> statement-breakpoint
CREATE INDEX "consultation_utilisateur" ON "consultation" USING btree ("utilisateur");