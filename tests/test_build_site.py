"""Packaging regressions: missing/corrupt assets must never become a release."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_site import build, canonical_site_url


class SitePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'public'
        (self.source / 'data').mkdir(parents=True)
        (self.source / 'assets').mkdir()
        (self.source / 'index.html').write_text('<!doctype html><html lang="fr">Test de packaging</html>')
        (self.source / 'config.js').write_text('window.LEXICALIS_CONFIG = {};')
        (self.source / 'assets' / 'app.js').write_text('/* Test only */')
        self.manifest = {'schemaVersion': 1, 'id': 'PACKAGING-TEST-ONLY', 'count': 1000,
                         'targetCount': 2000, 'dimensions': 500, 'normalized': True,
                         'dtype': 'float32-le', 'files': {}}
        # Opaque bytes exercise packaging, not playable vectors or semantic quality.
        for name, content in [('vocabulary', b'[]'), ('targets', b'[]'), ('vectors', bytes(1000 * 500 * 4))]:
            (self.source / 'data' / name).write_bytes(content)
            self.manifest['files'][name] = {'url': name, 'bytes': len(content),
                                            'sha256': hashlib.sha256(content).hexdigest()}
        self.save_manifest()
        self.destination = self.root / 'release'
        self.url = 'https://lafoirelunaire.github.io/Lexicalis/'

    def save_manifest(self):
        (self.source / 'data' / 'manifest.json').write_text(json.dumps(self.manifest))

    def test_only_current_site_files_are_shipped_and_zip_is_repeatable(self):
        (self.source / 'data' / 'obsolete-model.bin').write_bytes(b'not-for-deployment')
        (self.source / '.env').write_text('THIS_IS_NOT_A_SECRET=test-fixture')
        report = build(self.source, self.destination, self.url)
        archive = self.destination / 'lexicalis-site.zip'
        with zipfile.ZipFile(archive) as bundle:
            self.assertNotIn('.env', bundle.namelist())
            self.assertNotIn('data/obsolete-model.bin', bundle.namelist())
            self.assertIn('.nojekyll', bundle.namelist())
            self.assertIn('data/vectors', bundle.namelist())
            self.assertIsNone(bundle.testzip())
        self.assertEqual(report['dataId'], 'PACKAGING-TEST-ONLY')
        second = self.root / 'another-release'
        build(self.source, second, self.url)
        self.assertEqual(archive.read_bytes(), (second / 'lexicalis-site.zip').read_bytes())
        self.assertIn(self.url, (self.destination / 'blogger.html').read_text())

    def test_corruption_or_missing_assets_prevent_release(self):
        (self.source / 'data' / 'vectors').write_bytes(b'corruption')
        with self.assertRaisesRegex(ValueError, 'Intégrité'):
            build(self.source, self.destination, self.url)
        self.assertFalse(self.destination.exists())
        (self.source / 'data' / 'vectors').unlink()
        with self.assertRaisesRegex(ValueError, 'absente'):
            build(self.source, self.destination, self.url)

    def test_paths_cannot_escape_or_follow_symlinks(self):
        outside = self.root / 'outside'
        outside.write_bytes(b'not-public')
        self.manifest['files']['vocabulary']['url'] = '../../outside'
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'locales'):
            build(self.source, self.destination, self.url)
        self.manifest['files']['vocabulary']['url'] = 'vocabulary'
        self.save_manifest()
        (self.source / 'assets' / 'outside.js').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'symbolique'):
            build(self.source, self.destination, self.url)

    def test_existing_output_is_preserved(self):
        self.destination.mkdir()
        (self.destination / 'user-file').write_text('preserve')
        with self.assertRaisesRegex(ValueError, 'existe déjà'):
            build(self.source, self.destination, self.url)
        self.assertEqual((self.destination / 'user-file').read_text(), 'preserve')

    def test_site_url_must_be_https_without_credentials(self):
        self.assertEqual(canonical_site_url(self.url.rstrip('/')), self.url)
        for url in ['javascript:alert(1)', 'http://example.test/', 'https://user:password@example.test/',
                    'https://example.test/?token=secret', 'https://example.test/#fragment']:
            with self.assertRaises(ValueError):
                canonical_site_url(url)


if __name__ == '__main__':
    unittest.main()
