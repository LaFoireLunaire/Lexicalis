"""Synthetic vectors are test fixtures only; never shipped as game data."""
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from prepare_data import export, word2vec_rows, read_lexique
from download_data import download, digest
from compare_temperatures import compare
from compare_source_model import compare_source


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.model = self.root / 'test-only.bin'
        rows = [('étoile', [3, 4, 0]), ('lune', [1, 0, 0]), ('Étoile', [0, 1, 0]),
                ('artefact_123', [0, 1, 0]), ('zéro', [0, 0, 0]), ('nan', [float('nan'), 0, 1]),
                ('e\u0301toile', [0, 0, 1]), ('école', [0, 1, 0])]
        self.model.write_bytes(f'{len(rows)} 3\n'.encode() + b'\n'.join(
            word.encode() + b' ' + np.array(vector, dtype='<f4').tobytes() for word, vector in rows))
        self.targets = self.root / 'targets.txt'
        self.targets.write_text('étoile\nlune\nécole\n', encoding='utf-8')

    def prepare(self, **kwargs):
        return export(self.model, self.root / 'output', targets_file=self.targets,
                      expected_sha256=digest(self.model), dimensions=3, min_targets=1, min_words=1, **kwargs)

    def test_export_integrity_normalization_order_and_reproducibility(self):
        manifest = self.prepare()
        output = self.root / 'output'
        words = json.loads((output / manifest['files']['vocabulary']['url']).read_text('utf-8'))
        self.assertEqual(words, ['lune', 'école', 'étoile'])
        self.assertEqual(manifest['targetCount'], 3)
        matrix = np.fromfile(output / manifest['files']['vectors']['url'], dtype='<f4').reshape(-1, 3)
        np.testing.assert_allclose(np.linalg.norm(matrix, axis=1), 1, atol=1e-7)
        np.testing.assert_allclose(matrix[2], [.6, .8, 0], atol=1e-7)
        for record in manifest['files'].values():
            data = (output / record['url']).read_bytes()
            self.assertEqual(record['bytes'], len(data))
            self.assertEqual(record['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(self.prepare(), manifest)
        asset = output / manifest['files']['vectors']['url']
        asset.write_bytes(b'corrupted-cached-output')
        self.assertEqual(self.prepare(), manifest)
        self.assertEqual(digest(asset), manifest['files']['vectors']['sha256'])
        self.assertEqual(manifest['source']['verification'], 'supplied-sha256')

    def test_model_must_have_valid_checksum(self):
        with self.assertRaisesRegex(ValueError, 'SHA-256 incorrect'):
            export(self.model, self.root / 'output', targets_file=self.targets, expected_sha256='0' * 64)
        with self.assertRaisesRegex(ValueError, 'source fiable'):
            export(self.model, self.root / 'output', targets_file=self.targets)

    def test_truncated_and_incompatible_model_rejected(self):
        with self.assertRaisesRegex(ValueError, 'incompatible'):
            list(word2vec_rows(self.model, 500))
        self.model.write_bytes(self.model.read_bytes()[:-2])
        with self.assertRaisesRegex(ValueError, 'tronqué'):
            list(word2vec_rows(self.model, 3))

    def test_gzip_is_equivalent(self):
        zipped = self.root / 'model.bin.gz'
        zipped.write_bytes(gzip.compress(self.model.read_bytes()))
        plain, compressed = list(word2vec_rows(self.model, 3)), list(word2vec_rows(zipped, 3))
        self.assertEqual([x[0] for x in plain], [x[0] for x in compressed])
        for a, b in zip(plain, compressed):
            np.testing.assert_equal(a[1], b[1])

    def test_minimum_counts_fail_instead_of_silently_shrinking_game(self):
        with self.assertRaisesRegex(ValueError, 'Vocabulaire insuffisant'):
            export(self.model, self.root / 'output', targets_file=self.targets,
                   expected_sha256=digest(self.model), dimensions=3)

    def test_playable_forms_are_broader_than_common_mystery_lemmas(self):
        lexique = self.root / 'Lexique383.tsv'
        lexique.write_text('ortho\tlemme\tcgram\tfreqlemfilms2\n'
                           'étoile\tétoile\tNOM\t15\n'
                           'étoiles\tétoile\tNOM\t15\n'
                           'rare\trare\tADJ\t0.1\n'
                           'Paris\tParis\tNPR\t100\n', encoding='utf-8')
        playable, targets = read_lexique(lexique, 5)
        self.assertEqual(playable, {'étoile', 'étoiles', 'rare'})
        self.assertEqual(targets, {'étoile'})

    def test_reference_comparison_uses_known_cosines_and_ranks(self):
        self.prepare()
        references = self.root / 'references.csv'
        references.write_text('target,guess,temperature,progression\n'
                              'étoile,étoile,100,1000\n'
                              'étoile,lune,60,998\n'
                              'lune,étoile,60,999\n', encoding='utf-8')
        report = compare(self.root / 'output' / 'manifest.json', references)
        self.assertEqual(report['pairs'], 3)
        self.assertEqual(report['mismatches'], [])
        references.write_text('target,guess,temperature,progression\n'
                              'étoile,lune,70,999\n'
                              'étoile,absent,40,10\n', encoding='utf-8')
        report = compare(self.root / 'output' / 'manifest.json', references)
        self.assertEqual(len(report['mismatches']), 2)
        self.assertEqual(report['comparedPairs'], 1)
        self.assertEqual(report['missingPairs'], 1)
        self.assertEqual(report['temperatureMismatches'], 1)
        self.assertEqual(report['progressionMismatches'], 1)
        self.assertEqual(report['missingWords'], ['absent'])

    def test_original_model_comparison_does_not_depend_on_export_filter(self):
        references = self.root / 'source-references.csv'
        references.write_text('target,guess,temperature\n'
                              'étoile,lune,60\n'
                              'lune,étoile,60\n'
                              'étoile,étoile,100\n', encoding='utf-8')
        report = compare_source(self.model, references, digest(self.model), dimensions=3)
        self.assertEqual(report['comparedPairs'], 3)
        self.assertEqual(report['temperatureMismatches'], [])
        self.assertEqual(report['sameTwoDecimals'], 3)
        references.write_text('target,guess,temperature\n'
                              'étoile,lune,80\n'
                              'étoile,absent,40\n', encoding='utf-8')
        report = compare_source(self.model, references, digest(self.model), dimensions=3)
        self.assertEqual(len(report['temperatureMismatches']), 1)
        self.assertEqual(report['missing'], [{'target': 'étoile', 'guess': 'absent'}])

    def test_empty_reference_file_is_not_a_validation(self):
        self.prepare()
        references = self.root / 'references.csv'
        references.write_text('target,guess,temperature\n')
        with self.assertRaisesRegex(ValueError, 'Aucune paire'):
            compare(self.root / 'output' / 'manifest.json', references)

    def test_downloader_reuses_verified_files_and_rejects_corruption(self):
        path = self.root / 'download.bin'
        path.write_bytes(b'trusted-source')
        with patch('download_data.urllib.request.urlopen') as network:
            download('https://example.test/model', path, digest(path, 'md5'), 'https://example.test/sums')
            network.assert_not_called()
        self.assertEqual(json.loads(path.with_name(path.name + '.provenance.json').read_text())['sha256'], digest(path))
        import io
        with patch('download_data.urllib.request.urlopen', return_value=io.BytesIO(b'corrupt')):
            with self.assertRaisesRegex(ValueError, 'MD5'):
                download('https://example.test/model', self.root / 'bad.bin', '0' * 32, 'https://example.test/sums')
        self.assertFalse((self.root / 'bad.bin').exists())
        self.assertFalse((self.root / 'bad.bin.part').exists())


if __name__ == '__main__':
    unittest.main()
