"""Export verified word2vec vectors to a static Float32 dataset.

Streaming input supports word2vec binary and gzip. No gensim/scipy required.
Normalization uses Float64 norms, with a single final Float32 conversion.
"""
import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re
import tempfile
import unicodedata

import numpy as np

from download_data import MODEL_NAME, MODEL_URL, LEXIQUE_URL, digest

WORD = re.compile(r"[a-zàâäæçéèêëîïôöœùûüÿ]+(?:[-'’][a-zàâäæçéèêëîïôöœùûüÿ]+)*\Z")
TARGET_POS = {'NOM', 'VER', 'ADJ', 'ADV'}


def normalize(word):
    return unicodedata.normalize('NFC', word.strip().lower())


def verify_input(path, expected=None):
    actual = digest(path)
    sidecar = path.with_name(path.name + '.provenance.json')
    provenance = json.loads(sidecar.read_text('utf-8')) if sidecar.exists() else {}
    trusted = expected or provenance.get('sha256')
    if not trusted:
        raise ValueError(f'{path}: utiliser download_data.py ou fournir --expected-sha256 depuis une source fiable.')
    if not re.fullmatch('[a-fA-F0-9]{64}', trusted) or actual != trusted.lower():
        raise ValueError(f'{path}: SHA-256 incorrect ; export refusé.')
    return {**provenance, 'sha256': actual, 'verification':
            provenance.get('verification', 'supplied-sha256') if not expected else 'supplied-sha256'}


def read_lexique(path, min_frequency):
    """Accept all useful French forms, choose common lemmas independently."""
    playable, targets = set(), set()
    with path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream, delimiter='\t')
        required = {'ortho', 'lemme', 'cgram', 'freqlemfilms2'}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f'Colonnes Lexique manquantes : {required - set(reader.fieldnames or [])}')
        for row in reader:
            word, lemma = normalize(row['ortho']), normalize(row['lemme'])
            pos = row['cgram'].upper()
            if pos in {'NPR', 'NAM'}:
                continue
            if WORD.fullmatch(word):
                playable.add(word)
            if WORD.fullmatch(lemma):
                playable.add(lemma)
            frequency = float((row['freqlemfilms2'] or '0').replace(',', '.'))
            if (word == lemma and pos in TARGET_POS and 4 <= len(word) <= 16
                    and frequency >= min_frequency and '-' not in word and "'" not in word and '’' not in word):
                targets.add(word)
    return playable, targets


def word2vec_rows(path, dimensions):
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rb') as stream:
        header = stream.readline(128).split()
        if len(header) != 2:
            raise ValueError('En-tête Word2Vec binaire invalide.')
        count, actual_dimensions = map(int, header)
        if actual_dimensions != dimensions or not 0 < count < 20_000_000:
            raise ValueError(f'Modèle incompatible : {count} entrées, {actual_dimensions} dimensions ; attendu {dimensions}.')
        for _ in range(count):
            token = bytearray()
            while True:
                char = stream.read(1)
                if not char:
                    raise ValueError('Modèle tronqué pendant la lecture du vocabulaire.')
                if char in (b'\n', b'\r') and not token:
                    continue
                if char == b' ':
                    break
                token.extend(char)
                if len(token) > 4096:
                    raise ValueError('Entrée Word2Vec excessivement longue.')
            raw = stream.read(4 * dimensions)
            if len(raw) != 4 * dimensions:
                raise ValueError('Modèle tronqué pendant la lecture des vecteurs.')
            try:
                word = token.decode('utf-8')
            except UnicodeDecodeError:
                continue
            yield word, np.frombuffer(raw, dtype='<f4')


def export(model, output, *, lexique=None, targets_file=None, expected_sha256=None,
           lexique_sha256=None, dimensions=500, min_frequency=5, min_targets=2000,
           min_words=1000, source_url=MODEL_URL):
    provenance = verify_input(model, expected_sha256)
    if lexique:
        lexique_provenance = verify_input(lexique, lexique_sha256)
        allowed, candidates = read_lexique(lexique, min_frequency)
    elif targets_file:
        allowed = None
        candidates = {normalize(word) for word in targets_file.read_text('utf-8').splitlines() if word.strip()}
        lexique_provenance = None
    else:
        raise ValueError('Fournir --lexique ou une liste --targets révisée manuellement.')
    rows = {}
    seen = 0
    for original, vector in word2vec_rows(model, dimensions):
        seen += 1
        word = unicodedata.normalize('NFC', original)
        # No automatic case folding of model vocabulary: avoids proper-name collisions.
        if (word != word.lower() or not WORD.fullmatch(word) or word in rows
                or (allowed is not None and word not in allowed)):
            continue
        norm = float(np.linalg.norm(vector.astype(np.float64)))
        if not np.isfinite(norm) or norm == 0:
            continue
        rows[word] = (vector.astype(np.float64) / norm).astype('<f4')
    words = sorted(rows)
    target_words = sorted(candidates.intersection(rows))
    if len(words) < min_words or len(target_words) < min_targets:
        raise ValueError(f'Vocabulaire insuffisant : {len(words)} jouables (minimum {min_words}), '
                         f'{len(target_words)} mystères (minimum {min_targets}). Ajuster le filtre explicitement.')
    indices = {word: index for index, word in enumerate(words)}
    matrix = np.stack([rows[word] for word in words]).astype('<f4')
    output.mkdir(parents=True, exist_ok=True)
    files = {}

    def write_asset(name, content, suffix):
        sha256 = hashlib.sha256(content).hexdigest()
        filename = f'{name}-{sha256[:16]}.{suffix}'
        asset = output / filename
        if not asset.exists() or asset.stat().st_size != len(content) or digest(asset) != sha256:
            temporary_asset = None
            try:
                with tempfile.NamedTemporaryFile(dir=output, prefix=filename + '.', suffix='.tmp', delete=False) as stream:
                    temporary_asset = Path(stream.name)
                    stream.write(content)
                temporary_asset.replace(asset)
            finally:
                if temporary_asset is not None:
                    temporary_asset.unlink(missing_ok=True)
        files[name] = {'url': filename, 'sha256': sha256, 'bytes': len(content)}

    def encoded(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')

    write_asset('vocabulary', encoded(words), 'json')
    write_asset('targets', encoded([indices[word] for word in target_words]), 'json')
    write_asset('vectors', matrix.tobytes(order='C'), 'f32')
    configuration = {'files': files, 'dimensions': dimensions, 'filter': 'lexique383' if lexique else 'orthographic'}
    identifier = hashlib.sha256(encoded(configuration)).hexdigest()[:24]
    manifest = {
        'schemaVersion': 1, 'id': identifier, 'dimensions': dimensions, 'count': len(words),
        'targetCount': len(target_words), 'dtype': 'float32-le', 'normalized': True, 'files': files,
        'source': {'name': MODEL_NAME, 'url': provenance.get('url', source_url),
                   'author': 'Jean-Philippe Fauconnier', 'year': 2015,
                   'license': 'CC BY 3.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/3.0/',
                   'artifact': model.name, **provenance},
        'filtering': {'inputRows': seen, 'playableWords': len(words), 'mysteryWords': len(target_words),
                      'minimumLemmaFilmFrequency': min_frequency if lexique else None,
                      'description': 'Mots minuscules en alphabet français, accents conservés ; '
                                     'formes et lemmes Lexique hors noms propres.' if lexique else
                                     'Mots minuscules en alphabet français ; liste mystère révisée séparément.',
                      'targetsSha256': digest(targets_file) if targets_file and not lexique else None},
        'lexique': ({'name': 'Lexique383', 'url': LEXIQUE_URL, 'license': 'CC BY-SA 4.0',
                     'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/',
                     'authors': 'Boris New, Christophe Pallier et collaborateurs', **lexique_provenance}
                    if lexique else None),
        'scoring': '100 × cosinus ; dot Float64 sur vecteurs normalisés Float32 ; aucun arrondi avant classement',
        'ties': 'Mot mystère en premier, puis index du vocabulaire trié par points de code Unicode.',
        'assetLicenses': {'vectors': 'CC BY 3.0',
                          'vocabulary': 'CC BY-SA 4.0' if lexique else 'CC BY 3.0',
                          'targets': 'CC BY-SA 4.0' if lexique else 'Droits de la liste fournie à vérifier séparément.'},
        'cemantixEquivalence': 'Hypothèse non confirmée : aucune identité officielle ou expérimentale établie.',
    }
    temporary = output / 'manifest.json.tmp'
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(output / 'manifest.json')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/data'))
    parser.add_argument('--lexique', type=Path)
    parser.add_argument('--targets', type=Path)
    parser.add_argument('--expected-sha256')
    parser.add_argument('--lexique-sha256')
    parser.add_argument('--source-url', default=MODEL_URL)
    parser.add_argument('--dimensions', type=int, default=500)
    parser.add_argument('--min-frequency', type=float, default=5)
    parser.add_argument('--min-targets', type=int, default=2000)
    parser.add_argument('--min-words', type=int, default=1000)
    args = parser.parse_args()
    manifest = export(args.model, args.output, lexique=args.lexique, targets_file=args.targets,
                      expected_sha256=args.expected_sha256, lexique_sha256=args.lexique_sha256,
                      dimensions=args.dimensions, min_frequency=args.min_frequency,
                      min_targets=args.min_targets, min_words=args.min_words, source_url=args.source_url)
    print(f"Export {manifest['id']} : {manifest['count']} mots, {manifest['targetCount']} mystères, "
          f"{manifest['dimensions']} dimensions.")


if __name__ == '__main__':
    main()
