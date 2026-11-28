# Lexicalis — La Foire Lunaire

Jeu de [La Foire Lunaire](https://lafoirelunaire.blogspot.com/) : jeu français de proximité sémantique, à parties illimitées, conçu pour un hébergement statique et une intégration Blogger par iframe. Aucun compte, service d’IA payant ou serveur de calcul. Les calculs se font dans un Web Worker du navigateur.

**État actuel :** le jeu fonctionne avec le modèle original vérifié : **61 091 mots jouables, 5 006 mots mystères, 500 dimensions Float32**. Les **39 températures** de la capture « virtuel » correspondent exactement au centième avec `100 × cosinus`. Les rangs diffèrent à cause du vocabulaire filtré ; aucune identité officielle avec Cémantix n’est revendiquée. Voir les [résultats et limites](docs/validation.md). Les fichiers volumineux sont présents dans cet environnement, mais ignorés par Git ; préparer `public/data/` après un simple clone.

Le [cahier des charges](docs/specification.md) est conservé dans le dépôt. Motus, les défis quotidiens et le multijoueur ne sont pas implémentés.

## Développement

Prérequis : Python 3.11+ et NumPy 2.3.5 ; Node 22+ et npm pour les tests seulement. L’application publiée n’a aucune dépendance npm et n’a pas besoin d’étape de compilation.

Depuis la racine du dépôt :

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
npm ci
npm start
```

Si `pip` ou `venv` ne sont pas disponibles mais `uv` l’est, utiliser à la place :

```sh
uv venv .venv --python python3
uv pip install --python .venv/bin/python -r requirements.txt
. .venv/bin/activate
npm ci
npm start
```

Dans l’environnement cloud préparé, les données sont déjà exportées dans `public/data/`. Le serveur sert `public/` sur le port 3000. `python scripts/serve.py --port 3001` permet de changer le port. Pour jouer, préparer d’abord les données ci-dessous. Ne pas ouvrir directement `index.html` en `file://` : les modules, le Worker et les contrôles d’intégrité demandent un serveur HTTP local ou HTTPS.

## Récupérer et préparer le vrai modèle

La priorité est exclusivement `frWac_no_postag_phrase_500_cbow_cut10.bin` de Jean-Philippe Fauconnier. Aucun remplacement par FastText, Wikipédia ou un autre espace vectoriel n’est prévu. Garder les 500 dimensions et la précision Float32.

Après activation de `.venv`, depuis la racine :

```sh
python scripts/download_data.py --directory .cache/sources
python scripts/prepare_data.py \
  --model .cache/sources/frWac_no_postag_phrase_500_cbow_cut10.bin \
  --lexique .cache/sources/Lexique383.tsv \
  --output public/data
```

Prévoir environ 2 Go pour le modèle original, plus l’export et la mémoire nécessaire au filtrage. Le téléchargement conserve la vérification TLS et compare les fichiers au MD5 publié par leur source HTTPS ; un SHA-256 local est ensuite conservé dans un fichier de provenance. Un fichier déjà valide est réutilisé. Les fichiers partiels sont supprimés après échec.

Les serveurs à autoriser dans les paramètres réseau sont `embeddings.net`, `www.lexique.org` (et `lexique.org` si redirection). La consultation des sources utilise aussi `fauconnier.github.io`, `gitea.augustin64.fr` et `static.certitudes.org`. `raw.githubusercontent.com` est nécessaire pour les métadonnées officielles de Lexique. Ces domaines sont désormais autorisés dans la configuration publiée et les téléchargements réels ont réussi après son activation.

Si le téléchargement cloud reste impossible, exécuter ces commandes **sur un ordinateur ayant accès aux sources**, puis transférer le dossier exporté `public/data/` vers l’hébergement statique ou vers ce checkout. Les originaux, les exports, les dépendances et les résultats de test sont ignorés par Git. Ne pas committer plusieurs gigaoctets dans ce dépôt.

### Version filtrée proposée par cemantix-cli

La [release du projet indépendant](https://gitea.augustin64.fr/augustin64/cemantix-cli/releases) peut fournir `selected_word2vec_model_500.bin.gz`. Son contenu, sa provenance et son empreinte **n’ont pas été vérifiés ici**. Pas de téléchargement automatique d’une URL ou d’un hash devinés. Après vérification de la release et obtention d’un SHA-256 fiable :

```sh
python scripts/prepare_data.py \
  --model /chemin/selected_word2vec_model_500.bin.gz \
  --expected-sha256 EMPREINTE_SHA256_VERIFIEE \
  --source-url URL_HTTPS_EXACTE_DE_LA_RELEASE \
  --lexique .cache/sources/Lexique383.tsv \
  --output public/data
```

Ne pas considérer un hash calculé uniquement sur le téléchargement comme une preuve indépendante de son origine. Le filtre peut modifier les voisins classés, même s’il préserve les vecteurs retenus. Un autre modèle requiert l’accord du propriétaire du projet.

## Vocabulaire et format

- Les mots jouables proviennent de l’intersection entre les entrées minuscules exploitables du modèle et les formes/lemmes français de Lexique383, hors noms propres déclarés. Le filtre orthographique conserve les accents, les apostrophes et les traits d’union ; il écarte les expressions avec espaces et les artefacts visibles. Ce filtrage automatique n’est pas une révision humaine exhaustive.
- Les mystères sont choisis **séparément** parmi les lemmes NOM/VER/ADJ/ADV de 4 à 16 lettres dont `freqlemfilms2 >= 5`. Le script exige par défaut au moins 2 000 mystères et 1 000 mots jouables ; il échoue au lieu d’abaisser silencieusement les seuils. Les nombres effectifs ne seront connus qu’après export du modèle réel.
- Pour une curation manuelle, `--targets liste.txt` remplace Lexique comme source des mystères et conserve le vocabulaire du modèle passant le seul filtre orthographique. Cette variante nécessite une révision des noms propres/artefacts et des droits sur la liste. Elle ne prétend pas utiliser Lexique.
- Chaque vecteur est normalisé avec une norme Float64, puis stocké en Float32 little endian. `manifest.json` référence les fichiers binaires/JSON nommés par hash, leur taille, leur SHA-256, les sources et les transformations. Publier les assets **avant** le manifeste.
- Le navigateur vérifie les hashes, la taille, les 500 dimensions, les index et les normes avant la première utilisation des données. Une copie validée est conservée dans IndexedDB pour les ouvertures suivantes ; ses hashes sont à nouveau vérifiés à chaque lecture. Les vecteurs restent en Float32, sans quantification.

## Moteur et sauvegarde

`100 × cosinus` est calculé comme produit scalaire des vecteurs normalisés, avec accumulation JavaScript en double précision. Les températures sont affichées à deux décimales ; les scores bruts servent au tri. Le mot mystère vaut exactement 100 et reçoit la progression 1 000. Les 999 voisins suivants reçoivent 999 à 1. Les autres n’ont pas de progression. En cas d’égalité exacte : mystère d’abord, puis index du vocabulaire trié par points de code Unicode.

Le tirage aléatoire utilise `crypto.getRandomValues` avec rejet pour éviter le biais du modulo. Les propositions inconnues et déjà découvertes ne comptent pas. Un indice dévoile un voisin inédit, avec un rang visé progressivement plus proche, jusqu’au rang 999 ; une fois ce rang découvert, les indices restants ne peuvent plus l’améliorer. Ils ne dévoilent jamais le mystère et ne comptent pas comme essais.

`localStorage` conserve l’identifiant des données, le mystère, les entrées, l’issue et la dernière ligne consultée. Les scores sont recalculés à la reprise ; une version incompatible ou une sauvegarde invalide provoque une nouvelle partie expliquée. Les anciennes sauvegardes restent compatibles et affichent par défaut leur dernière entrée. Si le stockage est refusé, la partie reste jouable avec un avertissement. En iframe, sa disponibilité dépend du navigateur et de ses règles de stockage tiers. Le mystère est présent côté client : ce jeu sans compte n’a pas de protection anti-triche.

## Chargement et cache local

Au premier chargement, le Worker télécharge et valide les trois ressources du dictionnaire, puis enregistre une copie dans IndexedDB sous forme de Blobs. Lors d’une actualisation, il recontrôle le petit manifeste sur le serveur et réutilise cette copie si la version est identique : les **116,52 Mio de vecteurs** ne sont plus redemandés au réseau. Le cache est indépendant du cache HTTP.

L’identité du cache inclut l’URL du manifeste, l’identifiant du jeu, son format, les tailles et les SHA-256 des ressources, ainsi que la version du validateur. Chaque lecture locale contrôle à nouveau les tailles, les hashes et la structure des listes. Le parcours complet des normes est réutilisé uniquement pour les octets identiques déjà validés. Une mise à jour remplace atomiquement la copie précédente ; une copie endommagée est retéléchargée et validée intégralement. Les calculs de scores et de rangs restent inchangés.

Ce cache est facultatif : refus du stockage, quota insuffisant ou suppression par le navigateur entraînent un chargement réseau normal. Il dépend du navigateur et du contexte de l’iframe ; une ouverture directe du jeu peut utiliser un autre espace de stockage que l’intégration Blogger. Le manifeste reste consulté en ligne à chaque ouverture. Voir les [mesures et contrôles du cache](docs/validation.md#cache-après-actualisation-27-novembre-2026).

## Lisibilité et retour des propositions

Le jeu utilise un panneau unique : le bouton « Obtenir un indice » est placé près des compteurs, au-dessus de la saisie. Le panneau latéral et le texte d’accueil de la liste vide ont été retirés. En cours de partie, le bouton du haut propose « Abandonner la partie », avec confirmation ; après une victoire ou un abandon, il est remplacé par « Nouvelle partie ». Sur mobile, les nombres des compteurs mesurent 20 px et leurs libellés 13 px, contre 28 px et 16 px sur ordinateur.

Le tableau utilise une police de 16 px sur ordinateur et 15 px sur mobile, avec des en-têtes abrégés sur les petits écrans. Ses lignes ont 8 px de marge intérieure verticale. Sous le champ, la dernière proposition acceptée est affichée sur **une seule ligne identique à celle de la liste**, avec les mêmes colonnes : numéro, mot, température et progression, ou un tiret hors du top 1 000. Les indices y portent la même marque que dans la liste.

La liste est toujours classée du plus chaud au plus froid ; le choix de tri et le titre « Vos explorations » ont été retirés. Les anciennes préférences de tri sont ignorées, sans perdre la partie sauvegardée. Une nouvelle proposition conserve la position de défilement ; une nouvelle partie la remet en haut. Pour un nouveau mot du top 1 000, seules ses barres se remplissent en 650 ms. La reprise n’anime pas les anciennes barres et la préférence de réduction des mouvements est respectée.

Le bloc de messages `#feedback` et la boussole ont été retirés. Les mots inconnus sont signalés par la validation native du champ, sans compter d’essai ni remplacer le dernier mot valide. Retaper un mot déjà découvert réaffiche sa ligne sous le champ, avec son numéro d’origine, sa température et sa progression ; les compteurs, l’ordre de la liste et le défilement sont conservés. La barre ne rejoue pas son animation pour un doublon. Les indices conservent leur marque et la ligne sélectionnée est retrouvée après actualisation. Le chargement apparaît dans le texte indicatif du champ ; en cas d’échec, un bouton permet de réessayer. La victoire affiche le mot et les nombres d’essais et d’indices.

## Vérifications

```sh
npm test
npm run test:python
npm run test:browser
npm run test:cache
```

Pour les tests navigateur, installer Chromium ou fournir `CHROMIUM_PATH=/chemin/vers/chromium`. Dans l’environnement cloud actuel, il est présent à `/usr/bin/chromium`. Sur une autre machine, les navigateurs Playwright peuvent être installés selon sa documentation, puis leur chemin passé dans cette variable.

Les commandes ci-dessus utilisent des **vecteurs mathématiques synthétiques exclusivement dans les tests**, jamais dans le jeu. Les tests navigateur démarrent et arrêtent leur serveur temporaire. Ils vérifient le Worker, les hashes, les erreurs de chargement, les saisies, les indices, la sauvegarde/reprise, la victoire, l’abandon confirmé, le classement fixe, les largeurs 320/360/390/768/1024 px, une émulation Pixel 7, le stockage indisponible et un manifeste externe avec CORS. Le test de cache emploie le véritable IndexedDB dans le Worker, avec le cache HTTP désactivé : actualisation sans requête de données, corruption, nouvelles versions, refus de stockage et quota insuffisant. Rapports et captures : `test-results/`.

Avec les vraies données exportées :

```sh
node scripts/benchmark.mjs public/data/manifest.json
npm run test:real
python scripts/compare_source_model.py \
  --model .cache/sources/frWac_no_postag_phrase_500_cbow_cut10.bin \
  --references docs/references/cemantix-virtuel.csv
python scripts/compare_temperatures.py --references docs/references/cemantix-virtuel.csv
```

La capture fournie par le propriétaire pour le mot **virtuel** a été transcrite en [39 paires de référence](docs/references/cemantix-virtuel.csv), avec [leur provenance](docs/references/README.md). Le [rapport sur le modèle original](docs/references/virtuel-original-model.json) reproduit les **39 températures au centième**. Le [rapport du vocabulaire filtré](docs/references/virtuel-filtered-vocabulary.json) compare 36 mots, sans écart de température au-delà de la tolérance ; les 35 rangs non triviaux diffèrent et trois mots sont absents de Lexique383. Le comparateur du vocabulaire filtré retourne donc **1**, conformément aux différences observées, et non un succès global.

Pour ajouter d’autres références, le CSV doit contenir de **vrais résultats déjà connus de parties terminées**, avec les colonnes `target,guess,temperature,progression` (progression facultative ; décimales avec point). Le comparateur refuse un fichier vide et ne fait aucune requête vers Cémantix. Il signale les écarts de température au-delà de 0,011 °C et les différences de rang. Un rang différent peut résulter du vocabulaire filtré. Ne pas interroger massivement Cémantix pour constituer ces références.

Consulter [l’état des validations et les limites](docs/validation.md). Le test `npm run test:real` nécessite le serveur de développement en marche et les vraies données ; il vérifie le chargement, quatre propositions, la reprise et la victoire sur ordinateur et en émulation Pixel 7. Les vecteurs occupent **116,52 Mio** : prévoir ce téléchargement initial avant hébergement. Les mesures du modèle réel sont consignées dans les résultats ; les performances sur un appareil Android physique et sur une connexion mobile restent à mesurer. Aucun résultat sur des fixtures ne prouve la qualité sémantique ou l’équivalence à Cémantix.

## Publier et intégrer à Blogger

La préparation GitHub Pages et le bloc Blogger sont disponibles : suivre [le guide de mise en ligne](docs/deploiement.md). Chaque mise à jour de `main` déclenche automatiquement les vérifications, la construction et la publication ; une relance manuelle reste disponible dans Actions. Les autres branches ne publient pas le site. Les vecteurs sont générés dans un artefact, sans ajouter les données volumineuses à Git. Une archive autonome est produite par `npm run build:site` et vérifiée par `npm run test:release`.

Le logo de l’en-tête est le PNG original fourni par le propriétaire, conservé dans `public/assets/lexicalis-logo-8e25aff2.png` et inclus dans le site publié. Il mesure 240 px de large sur ordinateur et 120 px sur mobile, avec ses proportions conservées (2 170 × 725 pixels à l’origine).

1. Préparer puis héberger le contenu complet de `public/` sur un hébergement statique **HTTPS**. Aucune compilation n’est nécessaire. Utiliser un hébergement adapté à la taille du binaire, à sa bande passante et à ses conditions de service.
2. Même origine recommandée pour l’application et ses données. Pour des données sur un autre domaine, définir `window.LEXICALIS_CONFIG.manifestUrl` dans `public/config.js` et autoriser l’origine de **l’application** par CORS sur le manifeste **et tous les assets**. Configurer les types MIME JSON, JavaScript et binaire. HTTPS est nécessaire à Web Crypto en production.
3. Autoriser l’affichage de l’application en iframe : pas de `X-Frame-Options: DENY/SAMEORIGIN`, et une directive CSP `frame-ancestors` autorisant `https://lafoirelunaire.blogspot.com` (ou son domaine personnalisé si cela change). Cette directive doit être un en-tête HTTP de l’hébergement du jeu, pas une balise meta dans Blogger. Les scripts et le Worker restent servis depuis l’origine de l’application.
4. Adapter l’URL de [docs/blogger.html](docs/blogger.html), puis coller le bloc dans une page Blogger en mode HTML. Les styles sont isolés par l’iframe. Le bloc complet donne au jeu toute la fenêtre sur cette page ; le contenu défile dans l’iframe, sans dépassement horizontal. Pour une page existante, remplacer intégralement l’ancien bloc iframe par le nouveau contenu de `docs/blogger.html` (style, iframe et script). Aucune clé secrète ne doit figurer dans `config.js`.
5. Vérifier sur le vrai blog et sur un appareil Android : hauteur, saisie/clavier, CORS, reprise après actualisation et éventuelles restrictions du thème. L’intégration sur votre compte Blogger n’a pas été réalisée ici ; aucune publication n’a été faite.

## Sources et droits des données

- [Jean-Philippe Fauconnier — French Word Embeddings (2015)](https://fauconnier.github.io/#data), modèle frWaC CBOW 500 dimensions, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). [Page source consultée sur GitHub](https://github.com/fauconnier/fauconnier.github.io/blob/master/index.html), modèle et licence explicitement indiqués. [MD5 de l’éditeur](https://embeddings.net/embeddings/md5sum.txt).
- [Lexique383](https://www.lexique.org/), Boris New, Christophe Pallier et collaborateurs. La [notice de Lexique383 dans OpenLexicon](https://github.com/chrplr/openlexicon/blob/master/datasets-info/Lexique383/README-Lexique.md) indique **CC BY-SA 4.0** ; les [métadonnées officielles](https://github.com/chrplr/openlexicon/blob/master/datasets-info/_json/Lexique383.json) donnent l’URL et le MD5. Les listes dérivées de ce filtrage sont redistribuées sous cette licence ; conserver les attributions et transformations du manifeste. Référence : New, Pallier, Brysbaert & Ferrand (2004), *Lexique 2: A New French Lexical Database*, Behavior Research Methods, Instruments, & Computers 36(3), 516–524. Voir la notice pour les autres contributeurs et publications.
- [FAQ de Cémantix](https://static.certitudes.org/html/cemantix-faq) et [cemantix-cli](https://gitea.augustin64.fr/augustin64/cemantix-cli) : sources du cahier des charges. La FAQ consultée confirme le principe Word2Vec sans identifier précisément ce modèle ; cemantix-cli et sa release filtrée ne sont pas utilisés dans cet export. La correspondance mesurée sur une partie ne constitue pas une confirmation officielle du modèle.

Les crédits sont visibles dans le jeu ; la mention Lexique s’affiche lorsque les données chargées déclarent son utilisation. Les métadonnées de chaque export précisent ses sources exactes. La préparation n’effectue ni réduction de dimensions, ni quantification.
