# Documentation technique

## Le chemin d'une réponse

```
question
  │
  ├─ chercher()          filtres durs en SQL (statut, source inactive)
  │                      couverture pondérée par rareté + densité
  │
  ├─ sous le plancher ?  ─── oui ──▶ « ce n'est pas écrit » + lacune consignée
  │                                   (le modèle n'est même pas appelé)
  │ non
  ├─ passages encadrés   un bloc <donnee> PAR PASSAGE, avec sa référence
  │                      → le modèle peut attribuer chaque phrase
  │
  ├─ modèle              consigne : citer, ne pas compter, signaler les contradictions
  │
  └─ réponse + citations  statut et date_revision affichés · modèle et empreinte de consigne
```

## Pourquoi la recherche est ce qu'elle est

Le raisonnement qui a fixé chaque valeur est dans l'en-tête de
`apps/server/src/utils/recherche.ts`. En résumé : ni le ET ni le OU ne conviennent, la
rareté seule se fait piéger par les mots creux, et le plancher ne peut pas être exact — le
juge final est le modèle.

Les valeurs vivent dans le registre de réglages, pas dans le code. Un corpus différent
demande de les recalibrer, et c'est le seul réglage de ce projet qu'on ne peut pas poser
sans mesurer.

## Ce que le modèle ne fait jamais

Il ne compte pas, ne trie pas, ne corrèle pas, n'appelle aucun outil. Trier et dénombrer
sont des opérations exactes : le modèle rédige la requête, l'application l'exécute, la
réponse affiche le résultat **et** la requête exécutée.
