"""Download the requested frWaC model and Lexique383 with publisher checksums.

Uses HTTPS with the system trust store. No authentication or paid service.
Large model files and generated data belong in ignored directories, never Git.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import urllib.request

MODEL_NAME = 'frWac_no_postag_phrase_500_cbow_cut10.bin'
MODEL_URL = 'https://embeddings.net/embeddings/' + MODEL_NAME
MODEL_CHECKSUMS = 'https://embeddings.net/embeddings/md5sum.txt'
LEXIQUE_INFO = 'https://raw.githubusercontent.com/chrplr/openlexicon/master/datasets-info/_json/Lexique383.json'
LEXIQUE_URL = 'https://www.lexique.org/databases/Lexique383/Lexique383.tsv'


def digest(path, algorithm='sha256'):
    result = hashlib.new(algorithm)
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def fetch_text(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode('utf-8-sig')


def download(url, destination, expected_md5, authority):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and digest(destination, 'md5') == expected_md5:
        print(f'Déjà vérifié : {destination}')
    else:
        partial = destination.with_name(destination.name + '.part')
        try:
            print(f'Téléchargement : {url}', flush=True)
            with urllib.request.urlopen(url, timeout=120) as source, partial.open('wb') as output:
                while block := source.read(1024 * 1024):
                    output.write(block)
            if digest(partial, 'md5') != expected_md5:
                raise ValueError('Le MD5 ne correspond pas à celui publié par la source ; fichier refusé.')
            partial.replace(destination)
        finally:
            partial.unlink(missing_ok=True)
    provenance = {
        'url': url, 'checksumSource': authority,
        'publisherMd5': expected_md5, 'sha256': digest(destination),
        'verification': 'publisher-md5-over-https',
    }
    destination.with_name(destination.name + '.provenance.json').write_text(
        json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.cache/sources'))
    parser.add_argument('--only', choices=['model', 'lexique', 'all'], default='all')
    args = parser.parse_args()
    if args.only in ('all', 'model'):
        checksums = fetch_text(MODEL_CHECKSUMS)
        matches = re.findall(r'^([a-fA-F0-9]{32})\s+\*?(?:\./)?' + re.escape(MODEL_NAME) + r'\s*$', checksums, re.M)
        if len(matches) != 1:
            raise ValueError('Somme MD5 officielle introuvable ou ambiguë ; aucun modèle téléchargé.')
        download(MODEL_URL, args.directory / MODEL_NAME, matches[0].lower(), MODEL_CHECKSUMS)
    if args.only in ('all', 'lexique'):
        info = json.loads(fetch_text(LEXIQUE_INFO))
        record = next(row for row in info['urls'] if row['url'].endswith('/Lexique383.tsv'))
        download(LEXIQUE_URL, args.directory / 'Lexique383.tsv', record['md5sum'], LEXIQUE_INFO)


if __name__ == '__main__':
    main()
