"""Serve the standalone app; no calculation server or build is required."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=3000)
    parser.add_argument('--bind', default='0.0.0.0')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / 'public'
    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    print(f'Lexicalis : port {args.port}, répertoire {root}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
