-- LA DIMENSION DES VECTEURS PASSE DE 768 À 1024, ET LA COLONNE EST VIDÉE.
--
-- `bge-m3` au lieu de `multilingual-e5-base`, et la raison n'est pas sa réputation : c'est
-- une mesure. 97 % des passages de `corpus-bonnes-pratiques` et 86 % de `corpus-juridique`
-- dépassent la fenêtre de 512 jetons d'e5 — c'est-à-dire les deux sources qui PRIMENT sur
-- toutes les autres dans les rangs d'autorité. Les textes réglementaires auraient été les
-- plus mal vectorisés du corpus. bge-m3 accepte 8 192 jetons : la troncature disparaît au
-- lieu d'être gérée.
--
-- POURQUOI LE `UPDATE` EST LÀ, ET CE QU'IL CORRIGE.
--
-- La première version de cette migration disait « aucun vecteur n'existe en base, les
-- embeddings n'ayant jamais été activés ». C'était affirmé sans avoir été mesuré, et c'était
-- faux : PostgreSQL a refusé la conversion avec « expected 1024 dimensions, not 768 ».
--
-- L'origine de ces vecteurs est le plus intéressant. Nous avions relevé les modèles servis
-- par la plateforme et n'y avions vu que deux modèles de conversation. Mais Open WebUI
-- embarque son propre modèle d'embedding pour sa fonction RAG : il n'apparaît pas dans la
-- liste des modèles et répond pourtant sur `/api/embeddings`. En 768 dimensions, notre
-- contrôle le laissait passer. La moitié sémantique tournait donc peut-être déjà, avec un
-- modèle que personne n'avait choisi.
--
-- Ces vecteurs sont vidés, et c'est sans regret :
--
--   — ce sont des données DÉRIVÉES, entièrement recalculables par `synchro --reindexer` ;
--   — ils viennent d'un modèle qu'on abandonne, donc incomparables aux nouveaux ;
--   — ils sont vraisemblablement PARTIELS, selon ce qui répondait tel ou tel jour. Un index
--     à moitié peuplé par un modèle inconnu vaut moins que pas d'index du tout : les scores
--     y auraient l'air normaux.
--
-- L'effacement est donc explicite et daté, plutôt que subi. Il a été autorisé avant d'être
-- écrit — une écriture destructrice, même sur du dérivé, ne se décide pas seul.
--
-- ⚠️ APRÈS CETTE MIGRATION, LA MOITIÉ SÉMANTIQUE EST VIDE. C'est sans effet tant que
-- `embeddings.actif` est à `false` — la recherche est lexicale et le reste. Ne l'activer
-- qu'après avoir sondé le point d'entrée ET relancé `synchro --reindexer`.

UPDATE "passage" SET "vecteur" = NULL;

ALTER TABLE "passage" ALTER COLUMN "vecteur" TYPE vector(1024);
