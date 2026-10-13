-- pgvector : la colonne passage.vecteur en depend. Creee ici plutot qu a la main dans la
-- procedure d installation, pour qu une base neuve soit utilisable sans etape oubliee.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"chemin" text NOT NULL,
	"empreinte" text NOT NULL,
	"reference" text,
	"titre" text NOT NULL,
	"type_doc" text,
	"statut" text,
	"version" text,
	"date_revision" text,
	"url" text,
	"extraction" text DEFAULT 'complete' NOT NULL,
	"indexe_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lacune" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"sources_consultees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meilleur_score" text,
	"utilisateur" text,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"traitee" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passage" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"ordre" integer NOT NULL,
	"titre_section" text,
	"ancre" text,
	"texte" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('french', coalesce(titre_section, '') || ' ' || texte)) STORED,
	"vecteur" vector(768)
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" text PRIMARY KEY NOT NULL,
	"nom" text NOT NULL,
	"type" text NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"jeton_chiffre" text,
	"autorite" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_nom_unique" UNIQUE("nom")
);
--> statement-breakpoint
CREATE TABLE "synchro" (
	"source_id" text PRIMARY KEY NOT NULL,
	"dernier_debut" timestamp with time zone,
	"dernier_succes" timestamp with time zone,
	"etat" text DEFAULT 'jamais' NOT NULL,
	"message" text,
	"documents_vus" integer DEFAULT 0 NOT NULL,
	"documents_changes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passage" ADD CONSTRAINT "passage_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synchro" ADD CONSTRAINT "synchro_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_source_chemin" ON "document" USING btree ("source_id","chemin");--> statement-breakpoint
CREATE INDEX "document_statut" ON "document" USING btree ("statut");--> statement-breakpoint
CREATE INDEX "lacune_date" ON "lacune" USING btree ("date");--> statement-breakpoint
CREATE INDEX "passage_tsv" ON "passage" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "passage_document" ON "passage" USING btree ("document_id");