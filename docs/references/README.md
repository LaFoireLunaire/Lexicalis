# Références Cémantix fournies par le propriétaire

`cemantix-virtuel.csv` transcrit les **39 lignes entièrement visibles** d’une capture de partie terminée fournie dans la conversation le 26 novembre 2026. Le mot trouvé est **virtuel**. La date de l’édition de Cémantix n’est pas confirmée par la capture du jeu.

La première colonne numérique de la capture est le numéro d’essai ; elle n’est pas utilisée dans la comparaison. Les températures affichées à deux décimales sont transcrites avec un point décimal dans le CSV. La progression est le nombre à droite de la température. La ligne « carte », partiellement coupée en bas de l’image, est volontairement omise.

Ces valeurs sont des observations fournies par l’utilisateur, pas des résultats calculés par Lexicalis. Elles ne servent ni à inventer des scores ni à ajuster arbitrairement le moteur. Aucun serveur de Cémantix n’a été interrogé pour les obtenir.

Après export des **vraies données vérifiées**, depuis la racine du dépôt et avec `.venv` activé :

```sh
python scripts/compare_temperatures.py \
  --manifest public/data/manifest.json \
  --references docs/references/cemantix-virtuel.csv
```

La comparaison avec le modèle original vérifié a maintenant été exécutée : **39 paires comparées, aucun mot manquant, 39 températures identiques au centième**. Voir `virtuel-original-model.json`. La plus grande différence entre le cosinus brut et la valeur affichée sur la capture est 0,004953 °C, compatible avec l’arrondi à deux décimales.

Le rapport `virtuel-filtered-vocabulary.json` distingue la version jouable : 36 paires comparables, 3 mots exclus par Lexique383 (`multijoueur`, `cyborg`, `customisation`), aucun écart de température au-delà de la tolérance et 35 rangs différents. Par exemple, `ordinateur` vaut 39,53 °C dans les deux versions, mais sa progression vaut 986 dans Lexicalis contre 984 sur la capture. Ne pas modifier les scores pour masquer cette différence. Les rangs sont sensibles au filtrage du vocabulaire ; les écarts de température sont un indice plus direct pour l’hypothèse du modèle. Un accord sur cette seule partie, même avec ses 39 propositions, ne prouverait pas une identité officielle ou globale avec Cémantix.
