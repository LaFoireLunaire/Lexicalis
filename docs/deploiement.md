# Mettre Lexicalis en ligne puis l’intégrer à Blogger

La préparation locale est terminée. Le propriétaire a choisi un **code public sur GitHub**. La cible proposée est GitHub Pages pour le dépôt `LaFoireLunaire/Lexicalis`.

**URL prévue après activation et déploiement réussi :** `https://lafoirelunaire.github.io/Lexicalis/`. Cette adresse n’est pas annoncée comme déjà en ligne.

## Ce qui est prêt

- `.github/workflows/pages.yml` prépare les vraies données puis publie le site **uniquement lorsque l’on lance le workflow manuellement**.
- `dist/release/lexicalis-site.zip` contient le site autonome complet et ses vraies données ; `lexicalis-site.zip.sha256` permet de contrôler son téléchargement.
- `docs/blogger.html` et `dist/release/blogger.html` contiennent le bloc à coller dans Blogger.
- `dist/release/release.json` décrit les fichiers, leurs empreintes et l’identifiant du jeu exporté.

L’archive ne contient ni le modèle original de 2 Go, ni dépendances de développement, ni fichiers de compte ou de configuration privée. Elle contient les 61 091 vecteurs normalisés nécessaires au navigateur. Les données et les archives restent ignorées par Git.

## 1. Préparer le dépôt GitHub

Les fichiers du projet, dont `.github/workflows/pages.yml`, doivent être présents sur la branche par défaut du dépôt, habituellement `main`. La préparation d’un environnement Codex et la présence des fichiers dans son snapshot ne suffisent pas à les envoyer dans le dépôt distant.

Si une branche de préparation vous est fournie, ouvrez sa comparaison avec `main`, créez puis fusionnez la pull request après revue. Le site ne se déploie pas sur un simple push : le workflow est volontairement manuel.

Dans les paramètres du dépôt, vérifiez sa visibilité. Pour utiliser GitHub Pages gratuitement avec le choix retenu, le dépôt doit être **Public**, ou disposer d’un forfait autorisant Pages sur un dépôt privé. Le propriétaire a accepté le code public ; le script de préparation ne modifie pas lui-même la visibilité du dépôt.

## 2. Activer GitHub Pages

Dans `LaFoireLunaire/Lexicalis` :

1. Ouvrir **Settings → Pages**.
2. Dans **Build and deployment**, choisir **Source → GitHub Actions**.
3. Ouvrir **Actions → Publier Lexicalis sur GitHub Pages**.
4. Cliquer sur **Run workflow**, sélectionner la branche `main`, puis lancer.
5. Attendre la réussite des étapes `build` et `deploy`. Le premier téléchargement du modèle original peut prendre plusieurs minutes ; les sources sont ensuite mises en cache et revérifiées.
6. Utiliser l’URL réellement affichée par le déploiement. L’URL prévue ci-dessus est correcte pour le nom de dépôt actuel, sans domaine personnalisé.

Le workflow utilise les droits temporaires intégrés de GitHub Actions. Aucun token personnel, clé d’IA ou secret à copier dans le code n’est nécessaire. Les Actions officielles sont épinglées sur des commits vérifiés. Les permissions de publication Pages sont limitées au job `deploy`.

### Pourquoi les données ne sont pas ajoutées au dépôt

Le binaire web fait **116,52 Mio**, au-dessus de la limite habituelle de 100 Mio par fichier dans GitHub. Le workflow le génère pendant la construction, puis envoie **un artefact Pages**, et non un commit de données. Le site publié fait environ 123 Mo, sous la limite de 1 Go de GitHub Pages.

GitHub Pages documente aussi une limite souple de bande passante de 100 Go/mois : ce volume correspond à environ 800 téléchargements complets du dictionnaire actuel. Les nombreuses parties jouées après un chargement n’entraînent pas de nouveau téléchargement des vecteurs. Pour un trafic important, prévoir un hébergement de données adapté ; ne pas promettre une capacité de trafic illimitée.

Sources officielles consultées : [limites GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [artefact Pages](https://github.com/actions/upload-pages-artifact). Le binaire original de 2 Go est seulement une entrée de préparation, jamais un fichier du site.

## 3. Vérifier le site déployé

Ouvrir le lien de déploiement en HTTPS, attendre le dictionnaire, proposer un mot puis actualiser la page pour vérifier la reprise. Vérifier sur un téléphone Android physique la saisie, le téléchargement et l’absence de dépassement horizontal.

Toutes les ressources du paquet utilisent des chemins relatifs compatibles avec `/Lexicalis/`. L’application, le Worker et les données sont servis depuis la même origine : aucune configuration CORS supplémentaire n’est nécessaire dans ce cas. Pour un hébergement de données externe, consulter les réglages de `public/config.js` dans le README.

GitHub Pages ne fournit pas de réglage libre d’en-têtes HTTP comme `Content-Security-Policy: frame-ancestors`. Ne pas essayer de définir cette directive dans une balise meta. Pour cette cible, vérifier simplement que le site publié se charge dans l’iframe Blogger ; si un proxy ou un domaine personnalisé ajoute une interdiction d’iframe, il faudra ajuster cette couche.

## 4. Ajouter le jeu à Blogger

1. Dans l’administration de `https://lafoirelunaire.blogspot.com/`, créer une page ou ouvrir la page destinée au jeu.
2. Passer l’éditeur en **mode HTML**.
3. Coller le contenu de `docs/blogger.html`. Si GitHub affiche une URL de déploiement différente, remplacer le `src` de l’iframe par cette URL HTTPS.
4. Prévisualiser, puis publier la page lorsque son rendu vous convient.

L’iframe isole les styles du jeu du thème Blogger. La hauteur est réglée dans le bloc et le contenu peut défiler verticalement. Le stockage local dépend des règles du navigateur concernant les iframes ; vérifier la reprise après actualisation sur le blog lui-même. Aucune page Blogger n’a été modifiée par cette préparation.

## Autre hébergement statique

Décompresser `dist/release/lexicalis-site.zip` dans le répertoire servi en HTTPS. L’archive contient directement `index.html`, `assets/` et `data/` ; il n’y a pas de serveur de calcul à installer. L’hébergeur doit accepter un fichier de plus de 116 Mio et l’affichage dans une iframe. Si l’URL change, régénérer le bloc Blogger avec `--site-url` ou modifier son attribut `src`.

Ne pas déposer l’archive ZIP ou les vecteurs volumineux comme fichiers Git du dépôt. Le ZIP sert à un hébergement statique ou à un transfert, pas à remplacer le workflow Pages.

## Reproduire la préparation et les vérifications

Depuis la racine du projet, après préparation des données et activation de `.venv` :

```sh
python scripts/build_site.py --output dist/release --site-url https://lafoirelunaire.github.io/Lexicalis/
npm run test:release
```

Le constructeur refuse d’écraser une sortie existante afin de préserver vos fichiers. Pour une nouvelle version, utiliser par exemple `--output dist/release-v2`, puis `node scripts/test-release.mjs dist/release-v2`.

Le test vérifie le ZIP et toutes les empreintes, l’extrait sous `/Lexicalis/`, joue avec les vraies données sur ordinateur et mobile émulé, puis teste une iframe depuis une autre origine avec des styles parents incompatibles. Il arrête ses serveurs temporaires et laisse les rapports dans `test-results/`.

La syntaxe du workflow a été validée avec Actionlint 1.7.7, dont le binaire a été contrôlé contre les SHA-256 de sa release officielle. Les étapes Python du workflow correspondent à la chaîne de préparation déjà exécutée sur les vraies données ; le workflow lui-même n’a pas encore été lancé sur GitHub.
