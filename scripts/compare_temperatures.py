"""Compare exported vectors with supplied, completed Cémantix games.

CSV header: target,guess,temperature,progression
Progression is optional. No network requests are made. Returns 1 on mismatch.
"""
import argparse
import csv
import json
from pathlib import Path
import sys

import numpy as np
from download_data import digest
from prepare_data import normalize


def compare(manifest_path, reference_path, tolerance=0.011):
    manifest = json.loads(manifest_path.read_text('utf-8'))
    root = manifest_path.parent
    for asset in manifest['files'].values():
        if digest(root / asset['url']) != asset['sha256']:
            raise ValueError('Intégrité des données exportées incorrecte.')
    words = json.loads((root / manifest['files']['vocabulary']['url']).read_text('utf-8'))
    lookup = {word: i for i, word in enumerate(words)}
    matrix = np.fromfile(root / manifest['files']['vectors']['url'], dtype='<f4').reshape(len(words), manifest['dimensions'])
    matrix = matrix.astype(np.float64)
    checks, failures = 0, []
    compared, temperature_mismatches, progression_mismatches = 0, 0, 0
    missing_words = set()
    scores_by_target = {}
    with reference_path.open(encoding='utf-8-sig', newline='') as stream:
        rows = csv.DictReader(stream)
        if not {'target', 'guess', 'temperature'}.issubset(rows.fieldnames or []):
            raise ValueError('Colonnes requises : target,guess,temperature ; progression facultative.')
        for row in rows:
            checks += 1
            target, guess = normalize(row['target']), normalize(row['guess'])
            if target not in lookup or guess not in lookup:
                missing_words.update(word for word in (target, guess) if word not in lookup)
                failures.append({'line': checks + 1, 'error': 'Mot absent du vocabulaire filtré', 'target': target, 'guess': guess})
                continue
            compared += 1
            ti, gi = lookup[target], lookup[guess]
            if ti not in scores_by_target:
                scores = np.clip(matrix @ matrix[ti] * 100, -100, 100)
                scores[ti] = 100
                order = sorted(range(len(words)), key=lambda i: (-scores[i], i != ti, i))[:1000]
                ranks = {index: 1000 - position for position, index in enumerate(order)}
                scores_by_target[ti] = scores, ranks
            scores, ranks = scores_by_target[ti]
            expected = float(row['temperature'])
            if not np.isfinite(expected):
                raise ValueError('Température de référence non finie.')
            delta = abs(float(scores[gi]) - expected)
            rank = (row.get('progression') or '').strip()
            temperature_differs = delta > tolerance
            progression_differs = bool(rank and ranks.get(gi, 0) != int(rank))
            temperature_mismatches += int(temperature_differs)
            progression_mismatches += int(progression_differs)
            if temperature_differs or progression_differs:
                failures.append({'line': checks + 1, 'target': target, 'guess': guess,
                                 'expected': expected, 'actual': float(scores[gi]), 'delta': delta,
                                 'expectedProgression': rank or None, 'actualProgression': ranks.get(gi)})
    if checks == 0:
        raise ValueError('Aucune paire de référence : aucune validation possible.')
    return {'pairs': checks, 'comparedPairs': compared, 'missingPairs': checks - compared,
            'missingWords': sorted(missing_words), 'temperatureMismatches': temperature_mismatches,
            'progressionMismatches': progression_mismatches,
            'mismatches': failures, 'tolerance': tolerance, 'dataId': manifest['id'],
            'note': 'Un accord sur cet échantillon ne prouve pas une identité officielle avec Cémantix.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path('public/data/manifest.json'))
    parser.add_argument('--references', type=Path, required=True)
    parser.add_argument('--tolerance', type=float, default=0.011)
    args = parser.parse_args()
    if not np.isfinite(args.tolerance) or args.tolerance < 0:
        parser.error('La tolérance doit être finie et positive ou nulle.')
    report = compare(args.manifest, args.references, args.tolerance)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report['mismatches'] else 0


if __name__ == '__main__':
    sys.exit(main())
