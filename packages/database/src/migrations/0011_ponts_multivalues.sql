-- LE PONT PORTE DES LISTES, PAS DES VALEURS UNIQUES.
--
-- Constaté le 30 août 2026 en relisant les en-têtes que la rédaction venait d'ajouter :
-- trois documents déclarent DEUX domaines — l'annexe D « rgpd, conformite », l'annexe I
-- « listes-blanches, conformite », la fiche SOC « edr, parc ». Nos colonnes étaient du
-- texte simple, et la synchronisation n'écrivait que la PREMIÈRE valeur.
--
-- La conséquence était silencieuse et grave : `conformite` n'est déclaré que comme SECONDE
-- valeur, sur les deux documents qui le portent. Le domaine aurait donc été vide alors
-- qu'il est déclaré deux fois, et une réponse sur la conformité n'aurait jamais attaché de
-- conduite — sans que rien ne le signale.
--
-- La rédaction l'avait pourtant écrit : « pas d'unicité ici, contrairement aux types — un
-- domaine désigne un sujet que plusieurs documents éclairent ». Le corpus écrivait des
-- listes, la base gardait un scalaire.
--
-- LES COLONNES PASSENT AU PLURIEL, en nom comme en type. Le singulier était déjà un piège :
-- l'en-tête s'appelle `type_incidents`, la colonne s'appelait `type_incident`, et cette
-- désynchronisation d'une lettre a déjà coûté un déploiement entier où le pont était inerte.
--
-- Les colonnes sont RECRÉÉES plutôt que converties : une réindexation complète est de toute
-- façon nécessaire après le changement d'en-têtes, et elle réécrit chaque document.

ALTER TABLE "document" DROP COLUMN IF EXISTS "type_incident";
ALTER TABLE "document" DROP COLUMN IF EXISTS "domaine_catalogue";

ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "types_incident" text[];
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "domaines_catalogue" text[];
