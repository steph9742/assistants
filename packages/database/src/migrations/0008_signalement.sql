-- LE SIGNALEMENT — la moitié manquante de la file de rédaction.
--
-- Le journal des lacunes ne recevait que les questions SANS réponse. Or les pires réponses
-- de la semaine étaient trouvées : « Non, pas de P1 », les sections discursives d'INC-04
-- servies à la place du confinement. Trouvées, donc sans trace — chaque « c'est à côté »
-- devait être répété de vive voix pour exister.
--
-- `origine` distingue les deux files ; `citations` porte ce que la réponse citait, ce qui
-- permet de trier un défaut de corpus (mauvaise fiche citée) d'un défaut de rédaction
-- (bonne fiche, mauvaise lecture).

ALTER TABLE "lacune" ADD COLUMN IF NOT EXISTS "origine" text NOT NULL DEFAULT 'non_trouve';
ALTER TABLE "lacune" ADD COLUMN IF NOT EXISTS "citations" jsonb;
