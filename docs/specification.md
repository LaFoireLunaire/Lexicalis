# Projet Lexicalis — La Foire Lunaire

## 1. Présentation du projet

Lexicalis est un projet de jeu autour des mots français destiné à être intégré à mon blog Blogger « La Foire Lunaire », qui accueille également mon projet Fractalarium.

À terme, Lexicalis pourra proposer plusieurs modes de jeu, notamment un mode inspiré de Cémantix et un mode inspiré de Motus.

Pour le moment, je souhaite uniquement développer le mode inspiré de Cémantix, avec des parties illimitées.

L'objectif est de retrouver les sensations de jeu de Cémantix, en utilisant si possible exactement le même espace vectoriel.

## 2. Périmètre de la première version

- Jeu intégralement en français.
- Parties illimitées.
- Tirage aléatoire du mot mystère.
- Nombre de propositions illimité.
- Calcul réel de la proximité sémantique.
- Classement des 1 000 mots les plus proches.
- Interface adaptée aux ordinateurs et aux smartphones.
- Intégration dans Blogger.
- Aucun compte utilisateur.
- Aucune limite quotidienne.
- Aucun service d'intelligence artificielle payant.

Ne pas implémenter pour le moment le mode Motus, les défis quotidiens ou le multijoueur.

## 3. Modèle vectoriel

La priorité est d'utiliser le même espace vectoriel que Cémantix.

Le modèle identifié comme étant le plus probablement utilisé est :

`frWac_no_postag_phrase_500_cbow_cut10.bin`

Il s'agit d'un modèle Word2Vec pré-entraîné par Jean-Philippe Fauconnier.

Caractéristiques :

- Corpus frWaC de 1,6 milliard de mots.
- 500 dimensions.
- Algorithme CBOW.
- Corpus lemmatisé.
- Prise en compte des expressions.
- Absence d'étiquetage grammatical.
- Seuil de fréquence de 10.
- Taille originale d'environ 2 Go.
- Licence CC BY 3.0.

### Sources

Modèles originaux et licence :
https://fauconnier.github.io/#data

FAQ officielle de Cémantix :
https://static.certitudes.org/html/cemantix-faq

Un projet indépendant affirme avoir reproduit les distances de Cémantix avec ce modèle :
https://gitea.augustin64.fr/augustin64/cemantix-cli

Versions filtrées du modèle :
https://gitea.augustin64.fr/augustin64/cemantix-cli/releases

Le fichier `selected_word2vec_model_500.bin.gz`, de 82 Mio, constitue une piste intéressante pour démarrer rapidement.

L'identité exacte du modèle doit néanmoins être vérifiée expérimentalement. Ne pas considérer cette hypothèse comme une confirmation officielle.

Ne pas remplacer ce modèle par FastText, un modèle Wikipédia, un modèle génératif ou un autre modèle d'embeddings sans mon accord.

## 4. Calcul mathématique

Pour deux mots représentés par des vecteurs u et v, calculer leur similarité cosinus :

S(u,v) = (u · v) / (||u|| × ||v||)

La température sera initialement définie par :

T(u,v) = 100 × S(u,v)

- Température comprise théoriquement entre -100 et 100.
- Affichage à deux décimales.
- Le mot mystère possède une température de 100.
- Des températures négatives sont possibles.

Vérifier expérimentalement que cette formule correspond effectivement aux températures de Cémantix.

Il est possible de normaliser préalablement tous les vecteurs afin de remplacer le calcul de similarité cosinus par un simple produit scalaire.

Ne pas arrondir les scores avant d'établir le classement.

### Classement

Calculer la similarité entre le mot mystère et l'ensemble des mots jouables.

Les 1 000 premiers mots, mot mystère inclus, reçoivent un score de progression :

- 1 000/1 000 : mot mystère.
- 999/1 000 : mot voisin le plus proche.
- 998/1 000 : deuxième voisin le plus proche.
- Etc.
- 1/1 000 : dernier mot du classement.

Les autres mots disposent seulement d'une température.

Le classement doit dépendre des distances réelles, et non d'une conversion arbitraire de la température.

Définir un ordre déterministe en cas d'égalité.

## 5. Gestion du vocabulaire

Distinguer deux ensembles de mots.

### Mots jouables

Ensemble des mots que le joueur peut proposer.

Préserver autant que possible le vocabulaire français exploitable du modèle original.

- Noms communs.
- Verbes à l'infinitif.
- Adjectifs.
- Adverbes.
- Autres mots français pertinents.

Écarter les entrées manifestement incorrectes, les noms propres non pertinents, les artefacts du corpus et les expressions non adaptées au jeu.

### Mots mystères

Sous-ensemble des mots jouables, composé de mots relativement courants et connus du grand public.

Prévoir plusieurs milliers de mots mystères potentiels.

Une ressource complémentaire envisageable pour filtrer les mots selon leur fréquence est la base Lexique :
https://www.lexique.org/

Vérifier sa licence avant utilisation et redistribution.

Ne pas réduire inutilement le vocabulaire des propositions pour simplifier le choix du mot mystère.

### Saisie

- Ignorer la casse et les espaces superflus.
- Conserver les accents.
- Normaliser les chaînes Unicode.
- Refuser proprement les mots inconnus.
- Ne pas comptabiliser les propositions invalides ou déjà proposées.
- Éviter les substitutions automatiques ambiguës.

## 6. Interface utilisateur

Créer une interface moderne, épurée, en français et cohérente avec l'identité de La Foire Lunaire.

L'interface principale comprendra :

- Le titre Lexicalis.
- Le nombre d'essais effectués.
- Un champ de saisie.
- Un bouton de validation.
- Un tableau des propositions.
- Un bouton Nouvelle partie.
- Un bouton Indice.
- Un bouton Abandonner.

### Tableau des propositions

Colonnes souhaitées :

| N° | Mot | Température | Progression |
|---|---|---|---|

Par défaut, trier les propositions de la plus chaude à la plus froide.

Permettre également un tri chronologique.

Utiliser des couleurs progressives évoquant la température : bleu, vert, jaune, orange et rouge.

Prévoir une barre de progression pour les mots faisant partie du classement des 1 000 premiers.

Mettre en évidence la dernière proposition, même si celle-ci n'est pas parmi les meilleures.

Après validation, permettre immédiatement la saisie d'un nouveau mot.

### Indices

Proposer un mot encore non découvert parmi les voisins du mot mystère.

Privilégier les indices progressivement plus utiles en fonction de l'avancement du joueur.

Ne jamais révéler directement le mot mystère par le système d'indices.

Comptabiliser séparément les indices utilisés.

### Fin de partie

En cas de victoire :

- Afficher le mot mystère.
- Afficher le nombre d'essais et d'indices utilisés.
- Permettre de consulter les mots les plus proches.
- Proposer immédiatement une nouvelle partie.

En cas d'abandon, révéler le mot mystère après confirmation.

## 7. Architecture technique

Le jeu doit pouvoir être intégré dans Blogger sans nécessiter de serveur de calcul permanent.

Privilégier :

- HTML.
- CSS.
- JavaScript.
- Python pour la préparation hors ligne des données.
- Hébergement statique externe pour les ressources volumineuses.

Tous les calculs liés à une partie devront idéalement être effectués dans le navigateur.

### Préparation des données

Créer un script Python reproductible permettant de :

1. Charger le modèle Word2Vec original ou sa version filtrée.
2. Sélectionner les mots jouables.
3. Normaliser les vecteurs.
4. Constituer la liste des mots mystères.
5. Exporter le dictionnaire et les vecteurs dans un format exploitable en JavaScript.
6. Générer les métadonnées nécessaires au chargement.
7. Documenter les sources, licences et transformations effectuées.

Préférer un format binaire pour les vecteurs plutôt qu'un énorme fichier JSON.

Ne pas placer les fichiers originaux de plusieurs gigaoctets dans le dépôt Git.

### Moteur JavaScript

Utiliser des TypedArrays pour stocker les vecteurs.

Au début de chaque partie :

1. Tirer un mot mystère au hasard.
2. Calculer sa similarité avec l'ensemble des mots jouables.
3. Déterminer le classement des 1 000 premiers.
4. Stocker les scores nécessaires pour répondre rapidement aux propositions suivantes.

Envisager l'utilisation d'un Web Worker afin que les calculs ne bloquent pas l'interface.

### Optimisation

La fidélité au modèle original est prioritaire.

Commencer par une implémentation de référence en Float32.

Étudier ensuite, si nécessaire :

- La compression des fichiers.
- La quantification Float16 ou Int8.
- Le découpage des ressources volumineuses.
- La mise en cache avec IndexedDB.
- L'accélération des calculs.

Ne pas réduire le nombre de dimensions ou quantifier définitivement les vecteurs avant d'avoir mesuré l'impact sur les températures et les classements.

## 8. Intégration à Blogger

Comme pour Fractalarium, l'intégration dans Blogger est une contrainte importante dès le début du développement.

Prévoir :

- Une version autonome pour le développement et les tests.
- Une version intégrable dans une page Blogger, directement ou via une iframe.
- Une interface responsive.
- Aucun dépassement horizontal sur mobile.
- Des styles isolés pour éviter les conflits avec le thème Blogger.
- Des ressources externes configurables.
- Une gestion correcte des restrictions CORS.

Le jeu doit fonctionner sur ordinateur comme sur Android.

## 9. Sauvegarde

Utiliser localStorage pour sauvegarder :

- La partie en cours.
- Les propositions.
- Le mot mystère ou son identifiant.
- Le nombre d'indices utilisés.
- Les préférences du joueur.

Une actualisation accidentelle de la page ne doit pas faire perdre la partie.

Tenir compte de la version des données dans le système de sauvegarde.

## 10. Vérifications et tests

Avant de considérer le moteur comme fonctionnel :

- Vérifier l'origine et l'intégrité du modèle.
- Comparer les températures obtenues avec des résultats connus de Cémantix issus de parties terminées.
- Comparer les classements lorsque les données sont disponibles.
- Vérifier la symétrie des similarités.
- Vérifier qu'un mot comparé à lui-même donne 100.
- Tester les accents, les doublons et les mots inconnus.
- Tester le tirage aléatoire.
- Tester la sauvegarde et la reprise.
- Mesurer le temps de chargement, la consommation mémoire et la fluidité sur mobile et ordinateur.

Ne pas interroger massivement les serveurs de Cémantix.

Documenter les éventuelles différences avec Cémantix, notamment celles liées au filtrage du vocabulaire.

## 11. Ordre de développement recommandé

1. Récupération et identification du modèle vectoriel.
2. Validation mathématique en Python.
3. Préparation et export des données.
4. Création du moteur JavaScript.
5. Création de l'interface jouable.
6. Sauvegarde locale.
7. Intégration à Blogger.
8. Tests et optimisations.

Commencer par une véritable version fonctionnelle utilisant les données vectorielles réelles, et non une démonstration reposant sur des scores fictifs.

Si le téléchargement du modèle est impossible dans l'environnement de développement, fournir les commandes et scripts permettant de récupérer et préparer localement les données, puis poursuivre les développements qui ne dépendent pas de leur disponibilité.

Prévoir une architecture suffisamment modulaire pour accueillir ultérieurement un mode Motus, sans l'implémenter pour le moment.

## 12. Crédits

Afficher une attribution visible :

« Lexicalis — La Foire Lunaire. Jeu inspiré de Cémantix. Modèle vectoriel : Jean-Philippe Fauconnier, French Word Embeddings (2015), licence CC BY 3.0. »

Ajouter les liens vers l'auteur, la licence et les éventuelles ressources complémentaires utilisées.
