# Validation — données réelles, 26 novembre 2026

## Résultat

Le jeu est opérationnel dans l’environnement cloud avec le **modèle original demandé**, sans substitution, réduction de dimensions ou quantification :

- **61 091 mots jouables**, **5 006 mots mystères**, **500 dimensions Float32**.
- Export reproductible : `972a8d09039d8c3879abe870`.
- Vecteurs : **122 182 000 octets**, soit **116,52 Mio**, avant compression de transport.
- Chargement, propositions, températures négatives, sauvegarde/reprise, victoire et consultation des 1 000 voisins vérifiés dans Chromium sur ordinateur et en émulation Pixel 7.

Le serveur de développement a été relancé après la publication de l’environnement. Les téléchargements qui étaient refusés en 403 fonctionnent maintenant. Le script complet d’installation (dépendances, téléchargement vérifié et export) a été exécuté puis a réutilisé les fichiers valides. Plusieurs exports ont produit le même identifiant. Les fichiers d’assets sont publiés atomiquement et le manifeste en dernier.

## Origine et intégrité

Modèle : `frWac_no_postag_phrase_500_cbow_cut10.bin`, Jean-Philippe Fauconnier, French Word Embeddings (2015), CC BY 3.0. Téléchargement depuis l’URL HTTPS indiquée par l’auteur, **1 081 991 entrées** dans le binaire d’origine.

- MD5 publié par l’auteur et vérifié : `14da334ef867fec69a086cd6b4805609`.
- SHA-256 du fichier reçu : `8ec240bf8270138f5bb29232cf93e3f44060a42cacec57b702dbe2dbf67d7976`.
- Lexique383 : MD5 vérifié contre ses métadonnées officielles sur HTTPS ; SHA-256 `637ba37a767a66679c48371d673ece50cbf541b49a4e40e598963d4f3fbce52b`.
- Chaque asset exporté possède un SHA-256 vérifié par le navigateur, ainsi qu’un contrôle des tailles, des index et des normes.

Les attributions CC BY 3.0 et CC BY-SA 4.0 sont affichées dans le jeu et conservées dans le manifeste. Les originaux et les exports volumineux sont ignorés par Git ; `public/data/` est à conserver dans le snapshot de l’environnement ou à régénérer après un clone.

## Comparaison avec la capture Cémantix « virtuel »

Sur les **39 propositions entièrement visibles** fournies par le propriétaire, le calcul `100 × cosinus` sur les vecteurs originaux reproduit **39 températures sur 39 exactement au centième**. Aucun mot n’est absent du modèle original. L’écart maximal entre le score brut et la valeur arrondie affichée sur la capture est de 0,004953 °C.

Exemples :

| Proposition | Capture | Calcul brut, arrondi au centième |
| --- | ---: | ---: |
| virtuel | 100,00 | 100,00 |
| ordinateur | 39,53 | 39,53 |
| avatar | 36,02 | 36,02 |
| univers | 35,34 | 35,34 |
| jeu | 33,09 | 33,09 |

Le [rapport complet du modèle original](references/virtuel-original-model.json) est produit par `scripts/compare_source_model.py`. Il compare les températures **avant tout filtrage**. Cet accord appuie expérimentalement le choix du modèle et de la formule sur cet échantillon ; il ne constitue pas une confirmation officielle ni une preuve couvrant tous les mots.

### Différences du vocabulaire jouable

Le [rapport de l’export filtré](references/virtuel-filtered-vocabulary.json) distingue :

- **36 paires comparables**, aucun écart de température au-delà de la tolérance de 0,011 °C.
- **3 mots exclus par Lexique383** : `multijoueur`, `cyborg`, `customisation`. Ils existent dans le modèle original mais ne sont pas acceptés dans cet export.
- **35 rangs non triviaux différents**. Le mot mystère conserve 1 000. Exemple : « ordinateur » conserve 39,53 °C, mais sa progression vaut **986** dans Lexicalis contre **984** dans Cémantix.

Ces écarts de rang sont attendus avec un vocabulaire différent et restent visibles dans le rapport. Aucune conversion arbitraire de la température ou correction destinée à reproduire artificiellement les rangs de la capture n’est appliquée. Le comparateur de l’export retourne **1**, conformément à ces différences connues ; ce contrôle ne doit pas être présenté comme passé intégralement.

## Tests et mesures

- **13 tests JavaScript** du moteur passent : classement non arrondi, égalités déterministes, cosinus, accents, saisies, doublons, indices, tirage, sauvegardes et fins de partie.
- **10 tests Python** passent : export/reprise et réparation des assets corrompus, normalisation, binaire/gzip, filtrage, intégrité, modèles tronqués, comparateurs du modèle original et de l’export, références vides.
- **32 contrôles Chromium sur fixtures** passent : Worker, intégrité, parcours, largeurs de 320 à 1 024 px, CORS, iframe et stockage indisponible. Les données synthétiques restent exclusivement dans les tests. Les nouveaux contrôles vérifient aussi le récapitulatif, les erreurs/doublons, la reprise, le défilement avec 80 propositions et les deux tris, l’interpolation effective de la barre, l’absence de répétition des anciennes animations et la réduction des mouvements.
- **Deux parcours sur données réelles** passent : ordinateur et émulation Pixel 7 avec ralentissement CPU ×4 demandé à Chromium. Chaque parcours charge les vrais assets, propose quatre mots, reprend la partie après actualisation et trouve le mystère ; les 1 000 voisins et l’absence de dépassement horizontal sont vérifiés. Le mot contrôlé du test est « abandonner », appartenant au véritable ensemble des mystères.

Les [mesures enregistrées](references/real-runtime.json) sont indicatives, réalisées sur le serveur local de cette machine cloud :

| Mesure | Résultat |
| --- | ---: |
| Préparation d’une partie, moteur Node | 142 ms |
| Réponse d’une proposition, moteur Node | 0,41 ms |
| RSS du processus Node après chargement | 175,77 Mio |
| Page prête, navigateur ordinateur | 2 582 ms |
| Page prête, navigateur mobile émulé | 3 178 ms |
| Dernière proposition, aller-retour interface ordinateur | 102 ms |
| Dernière proposition, aller-retour interface mobile émulée | 140 ms |

Le test a aussi relevé un intervalle maximal de la boucle principale de 174 ms sur ordinateur et 383 ms en émulation mobile, pendant le chargement et le parcours. Ce n’est pas une mesure de fréquence d’images ni une garantie de fluidité. La mémoire Node inclut le processus entier et ne représente pas la mémoire d’un navigateur Android. Le débit local ne représente pas un téléchargement Internet de 116,52 Mio.

Les scripts reproductibles sont `scripts/benchmark.mjs`, `scripts/smoke-real-data.mjs`, `scripts/compare_source_model.py` et `scripts/compare_temperatures.py`. Les rapports de référence sont conservés dans ce dossier ; les captures des tests sont dans `test-results/`.

## Restant à vérifier au déploiement

- Un **appareil Android physique**, son clavier, la mémoire disponible, le débit réel et la fluidité.
- L’hébergement statique HTTPS, ses en-têtes CORS et `frame-ancestors`, ainsi que le téléchargement initial volumineux.
- L’intégration au vrai thème de `https://lafoirelunaire.blogspot.com/`, la hauteur de l’iframe et la disponibilité du stockage tiers. Aucune page du blog n’a été modifiée ou publiée ici.
- Une validation de fidélité sur d’autres parties terminées et une révision/enrichissement du vocabulaire pour réduire les exclusions lexicales. Ne pas assimiler l’accord de 39 températures à une identité globale des classements.

L’instance actuelle a été validée. Les nouvelles données et instructions doivent être incluses dans la prochaine publication de l’environnement pour figer cet état enrichi ; leur restauration dans une nouvelle tâche n’a pas encore été testée.
