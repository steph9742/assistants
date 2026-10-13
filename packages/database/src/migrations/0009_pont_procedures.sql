-- LE PONT DONNÉES → PROCÉDURE, PAR DÉCLARATION.
--
-- Une réponse de données qui contient des incidents va chercher la fiche qui déclare leur
-- type et attache sa conduite ; une réponse d'un domaine du Catalogue va chercher les
-- fiches qui déclarent ce domaine. La donnée dit ce qui se passe, le corpus dit quoi faire.
--
-- Les deux correspondances sont DÉCLARÉES par la rédaction dans l'en-tête des fiches,
-- jamais devinées par rapprochement de mots.
--
--   type_incident     — la taxonomie des incidents de l'ÉTABLISSEMENT (grille INC-GRILLE),
--                       que Sniff implémente. Le nom ne se couple pas à l'outil : si Sniff
--                       change un jour, la déclaration des fiches reste vraie.
--   domaine_catalogue — le vocabulaire fermé des domaines de /api/lacunes, publié et
--                       garanti par le type côté Catalogue.

ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "type_incident" text;
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "domaine_catalogue" text;
