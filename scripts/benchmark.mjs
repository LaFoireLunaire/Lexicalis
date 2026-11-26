// Run against real, prepared data: node scripts/benchmark.mjs public/data/manifest.json
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Game } from '../public/assets/engine.js';
const start = performance.now();
const manifestPath = path.resolve(process.argv[2] || 'public/data/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
async function asset(key) {
  const record = manifest.files[key];
  const buffer = await readFile(path.resolve(path.dirname(manifestPath), record.url));
  if (buffer.length !== record.bytes || createHash('sha256').update(buffer).digest('hex') !== record.sha256) {
    throw new Error('Données corrompues');
  }
  return buffer;
}
const [vocabulary, targetsBuffer, vectorBuffer] = await Promise.all(['vocabulary', 'targets', 'vectors'].map(asset));
const words = JSON.parse(vocabulary), targets = JSON.parse(targetsBuffer);
const vectorArray = new Float32Array(vectorBuffer.buffer, vectorBuffer.byteOffset, vectorBuffer.length / 4);
const game = new Game({ id: manifest.id, words, targets, vectors: vectorArray, dimensions: manifest.dimensions });
const loaded = performance.now();
game.start();
const scored = performance.now();
const sample = words.find(word => word !== words[game.target]);
game.guess(sample);
const guessed = performance.now();
console.log(JSON.stringify({ dataId: manifest.id, words: words.length, dimensions: manifest.dimensions,
  fileLoadMs: loaded - start, newGameMs: scored - loaded, guessMs: guessed - scored,
  vectorMiB: vectorBuffer.length / 1048576,
  processRssMiB: process.memoryUsage().rss / 1048576,
  environment: `${process.version}, ${process.platform}/${process.arch}`,
  note: 'Mesure Node sur cette machine ; ne remplace pas un profilage de navigateur et Android réel.' }, null, 2));
