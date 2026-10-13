-- TROIS ZONES D'INDEXATION, PONDÉRÉES PAR POSTGRESQL.
--
-- Le `tsvector` d'un passage portait `titre_section || texte`, et rien d'autre. Le titre du
-- DOCUMENT n'y était pas : une fiche « INC-04 — Malware sur un poste » dont une section dit
-- « isoler la machine du réseau » avait une couverture NULLE sur « malware ». Mesuré, le
-- biais était systématique et se lit à l'envers de ce qu'on cherche — plus une section est
-- discursive, plus elle reformule son sujet, plus elle ressort. Les sections qui FONT
-- nomment le moins.
--
-- Deux colonnes de contexte sont recopiées depuis le document à chaque synchronisation. Une
-- colonne engendrée ne voit que sa propre ligne : sans cette dénormalisation, le titre et
-- les mots-clés ne peuvent pas entrer dans l'index. C'est le prix d'un index GIN utilisable
-- — la correction précédente les recalculait par ligne à chaque requête, ce qui marchait et
-- rendait l'index inopérant.
--
--   contexte_fort  → zone A : mots-clés déclarés, questions auxquelles la fiche répond
--   contexte_moyen → zone B : titre du document et sa référence
--   titre_section  → zone B
--   texte          → zone C
--
-- `ts_rank_cd` applique nativement {A: 1,0 · B: 0,4 · C: 0,2}.
--
-- ⚠️ UNE RESYNCHRONISATION FORCÉE EST OBLIGATOIRE APRÈS CETTE MIGRATION. Les deux colonnes
-- sont nulles pour les lignes existantes : tant qu'elles ne sont pas remplies, l'index perd
-- le titre du document, et la recherche est PIRE qu'avant. Voir doc/Exploitation-MCO.md.

ALTER TABLE "passage" ADD COLUMN IF NOT EXISTS "contexte_fort" text;
ALTER TABLE "passage" ADD COLUMN IF NOT EXISTS "contexte_moyen" text;

-- La colonne engendrée ne s'altère pas : on la supprime et on la recrée. PostgreSQL
-- recalcule alors toutes les lignes, et l'index GIN se reconstruit sur la nouvelle
-- définition.
DROP INDEX IF EXISTS "passage_tsv";
ALTER TABLE "passage" DROP COLUMN IF EXISTS "tsv";

ALTER TABLE "passage" ADD COLUMN "tsv" tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('french', coalesce("contexte_fort", '')), 'A')
        || setweight(to_tsvector('french', coalesce("contexte_moyen", '') || ' ' || coalesce("titre_section", '')), 'B')
        || setweight(to_tsvector('french', "texte"), 'C')
    ) STORED;

CREATE INDEX "passage_tsv" ON "passage" USING gin ("tsv");
