"""Compare screenshot temperatures directly with the verified original Word2Vec.

Only the required vectors are retained in memory. No vocabulary filtering, no
ranking inference and no requests to Cémantix. Does not export playable data.
"""
import argparse
import csv
import json
from pathlib import Path
import sys
import unicodedata

import numpy as np
from prepare_data import normalize, verify_input, word2vec_rows


def compare_source(model, references, expected_sha256=None, dimensions=500, tolerance=0.011):
    provenance = verify_input(model, expected_sha256)
    with references.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        if not {'target', 'guess', 'temperature'}.issubset(reader.fieldnames or []):
            raise ValueError('Colonnes requises : target,guess,temperature.')
        rows = list(reader)
    if not rows:
        raise ValueError('Aucune paire de référence : aucune validation possible.')
    wanted = {normalize(row[key]) for row in rows for key in ('target', 'guess')}
    vectors = {}
    for original, vector in word2vec_rows(model, dimensions):
        word = unicodedata.normalize('NFC', original)
        if word not in wanted or word in vectors:
            continue
        precise = vector.astype(np.float64)
        norm = np.linalg.norm(precise)
        if not np.isfinite(norm) or norm == 0:
            raise ValueError(f'Vecteur invalide pour {word}.')
        vectors[word] = precise / norm
    results, missing = [], []
    for row in rows:
        target, guess = normalize(row['target']), normalize(row['guess'])
        if target not in vectors or guess not in vectors:
            missing.append({'target': target, 'guess': guess})
            continue
        expected = float(row['temperature'])
        if not np.isfinite(expected):
            raise ValueError('Température de référence non finie.')
        actual = 100.0 if target == guess else float(np.clip(np.dot(vectors[target], vectors[guess]) * 100, -100, 100))
        results.append({'target': target, 'guess': guess, 'expected': expected, 'actual': actual,
                        'delta': abs(actual - expected), 'withinTolerance': abs(actual - expected) <= tolerance,
                        'sameTwoDecimals': f'{actual:.2f}' == f'{expected:.2f}'})
    mismatches = [row for row in results if not row['withinTolerance']]
    return {'referencePairs': len(rows), 'comparedPairs': len(results), 'missing': missing,
            'temperatureMismatches': mismatches, 'sameTwoDecimals': sum(row['sameTwoDecimals'] for row in results),
            'maxAbsoluteDelta': max((row['delta'] for row in results), default=None),
            'tolerance': tolerance, 'modelSha256': provenance['sha256'],
            'modelVerification': provenance['verification'], 'results': results,
            'note': 'Températures cosinus du modèle original, sans filtrage. '
                    'Aucun classement comparé ; accord sur cet échantillon seulement, pas de confirmation officielle.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--references', type=Path, required=True)
    parser.add_argument('--expected-sha256')
    parser.add_argument('--tolerance', type=float, default=0.011)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not np.isfinite(args.tolerance) or args.tolerance < 0:
        parser.error('La tolérance doit être finie et positive ou nulle.')
    report = compare_source(args.model, args.references, args.expected_sha256, tolerance=args.tolerance)
    content = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding='utf-8')
    print(content, end='')
    return int(bool(report['temperatureMismatches'] or report['missing']))


if __name__ == '__main__':
    sys.exit(main())
