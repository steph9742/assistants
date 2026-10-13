-- CE QUI MANQUAIT, EN UNE PHRASE.
--
-- Le signalement disait qu'une réponse était à côté ; il ne disait pas EN QUOI. Or c'est
-- cette phrase-là qui sert à la rédaction documentaire : « il manquait la commande », « ça
-- ne dit pas quoi faire si l'utilisateur n'a rien saisi ». Sans elle, le lecteur du journal
-- doit deviner ce que le signalant avait en tête, et le plus souvent il ne devine pas.
--
-- Facultatif : un signalement sans phrase reste un signalement. Exiger la précision ferait
-- renoncer, et un signalement muet vaut mieux qu'un silence.

ALTER TABLE "lacune" ADD COLUMN IF NOT EXISTS "ce_qui_manquait" text;
