"""Package the verified static game, without original models or developer files.

Produces a deployment directory, reproducible ZIP, SHA-256, Blogger snippet,
and an inventory. No external application is modified by this command.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import tempfile
from urllib.parse import urlsplit
import zipfile


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def local_asset(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative:
        raise ValueError('Chemin de ressource invalide.')
    parts = Path(relative)
    if parts.is_absolute() or '..' in parts.parts or any(char in relative for char in ('?', '#', ':')):
        raise ValueError('Les ressources publiées doivent être locales au site.')
    candidate = root / parts
    if any(part.is_symlink() for part in [candidate, *candidate.parents] if part != root.parent):
        raise ValueError('Les liens symboliques ne sont pas autorisés dans le site.')
    if not candidate.is_file() or not candidate.resolve().is_relative_to(root.resolve()):
        raise ValueError(f'Ressource absente ou hors du site : {relative}')
    return candidate


def canonical_site_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or any(c.isspace() for c in value)):
        raise ValueError('Fournir une URL HTTPS publique sans identifiants, requête ou fragment.')
    return value.rstrip('/') + '/'


def blogger_snippet(site_url):
    safe_url = html.escape(canonical_site_url(site_url), quote=True)
    return '''<!-- Remplacer l’ancien bloc iframe de la page Blogger par ce bloc complet.
     Le jeu occupe toute la fenêtre sur cette page uniquement. -->
<style>
  html.lexicalis-blogger-page,
  html.lexicalis-blogger-page body {
    overflow: hidden !important;
  }
  #lexicalis-blogger-frame {
    position: fixed !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    max-width: none !important;
    height: 100vh !important;
    height: 100dvh !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: #101722;
    z-index: 2147483647 !important;
  }
</style>
<iframe
  id="lexicalis-blogger-frame"
  src="__LEXICALIS_URL__"
  title="Lexicalis — jeu de proximité sémantique de La Foire Lunaire"
  width="100%"
  height="900"
  loading="eager"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
<script>
(function () {
  var frame = document.getElementById('lexicalis-blogger-frame');
  if (!frame) return;
  document.documentElement.classList.add('lexicalis-blogger-page');
  var viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    document.head.appendChild(viewport);
  }
  viewport.content = 'width=device-width, initial-scale=1';
  // Escape theme columns and transformed/clipped ancestors on this page.
  if (frame.parentNode !== document.body) document.body.appendChild(frame);
})();
</script>
'''.replace('__LEXICALIS_URL__', safe_url)


def build(source, destination, site_url):
    source, destination = source.resolve(), destination.resolve()
    site_url = canonical_site_url(site_url)
    if destination == source or destination.is_relative_to(source) or source.is_relative_to(destination):
        raise ValueError('La sortie doit être séparée du répertoire source public/.')
    if destination.exists():
        raise ValueError('Le répertoire de sortie existe déjà : choisir une nouvelle sortie pour préserver son contenu.')
    manifest_file = local_asset(source, 'data/manifest.json')
    manifest = json.loads(manifest_file.read_text('utf-8'))
    if (manifest.get('schemaVersion') != 1 or manifest.get('dimensions') != 500
            or manifest.get('dtype') != 'float32-le' or manifest.get('normalized') is not True
            or manifest.get('count', 0) < 1000 or manifest.get('targetCount', 0) < 2000):
        raise ValueError('Le manifeste ne décrit pas un export de production compatible.')
    selected = {'index.html', 'config.js', 'data/manifest.json'}
    assets_root = source / 'assets'
    for path in sorted(assets_root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Lien symbolique interdit dans assets/.')
        if path.is_file():
            selected.add(path.relative_to(source).as_posix())
    for name in ('vocabulary', 'targets', 'vectors'):
        record = manifest['files'][name]
        path = local_asset(source / 'data', record['url'])
        if (not re.fullmatch('[a-f0-9]{64}', record['sha256'])
                or path.stat().st_size != record['bytes'] or sha256_file(path) != record['sha256']):
            raise ValueError(f'Intégrité incorrecte : {name}.')
        selected.add(path.relative_to(source).as_posix())
    if manifest['files']['vectors']['bytes'] != manifest['count'] * 500 * 4:
        raise ValueError('Taille des vecteurs incompatible.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.lexicalis-build-', dir=destination.parent))
    try:
        site = temporary / 'site'
        site.mkdir()
        for relative in sorted(selected):
            original = local_asset(source, relative)
            copied = site / relative
            copied.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, copied)
            copied.chmod(0o644)
        (site / '.nojekyll').touch()
        inventory = {
            'dataId': manifest['id'], 'siteUrl': site_url,
            'words': manifest['count'], 'mysteries': manifest['targetCount'], 'dimensions': 500,
            'files': [{'path': p.relative_to(site).as_posix(), 'bytes': p.stat().st_size,
                       'sha256': sha256_file(p)} for p in sorted(site.rglob('*')) if p.is_file()],
            'publication': 'Préparé localement ; aucune publication en ligne effectuée par ce script.',
        }
        archive = temporary / 'lexicalis-site.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
            for path in sorted(site.rglob('*')):
                if not path.is_file():
                    continue
                entry = zipfile.ZipInfo(path.relative_to(site).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                with path.open('rb') as source_stream, bundle.open(entry, 'w', force_zip64=True) as target_stream:
                    shutil.copyfileobj(source_stream, target_stream, length=1024 * 1024)
        (temporary / 'lexicalis-site.zip.sha256').write_text(
            sha256_file(archive) + '  lexicalis-site.zip\n', encoding='utf-8')
        (temporary / 'blogger.html').write_text(blogger_snippet(site_url), encoding='utf-8')
        (temporary / 'release.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('public'))
    parser.add_argument('--output', type=Path, default=Path('dist/release'))
    parser.add_argument('--site-url', default='https://lafoirelunaire.github.io/Lexicalis/')
    args = parser.parse_args()
    inventory = build(args.source, args.output, args.site_url)
    print(json.dumps({'output': str(args.output), 'dataId': inventory['dataId'],
                      'siteUrl': inventory['siteUrl'], 'fileCount': len(inventory['files']),
                      'totalBytes': sum(row['bytes'] for row in inventory['files'])}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
