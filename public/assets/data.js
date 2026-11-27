import { openDatasetCache, readDatasetCache, writeDatasetCache, deleteDatasetCache } from './cache.js';

// Increase this if the rules for accepting normalized datasets change.
const VALIDATION_VERSION = 1;
const ASSETS = ['vocabulary', 'targets', 'vectors'];

function expect(condition, message = 'Données de jeu incompatibles ou endommagées.') {
  if (!condition) throw new Error(message);
}

async function fetchOK(url, options) {
  let response;
  try { response = await fetch(url, options); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Impossible de charger le dictionnaire. Vérifiez votre connexion et réessayez.');
  }
  if (!response.ok) throw new Error('Le dictionnaire n’est pas disponible pour le moment. Réessayez plus tard.');
  return response;
}

function assetRecord(record) {
  expect(record && typeof record.url === 'string' && /^[a-f0-9]{64}$/.test(record.sha256) &&
    Number.isSafeInteger(record.bytes) && record.bytes > 0);
  return record;
}

async function checkAsset(buffer, record) {
  expect(buffer instanceof ArrayBuffer && buffer.byteLength === record.bytes, 'Le téléchargement est incomplet. Réessayez.');
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  expect(actual === record.sha256, 'L’intégrité du dictionnaire n’a pas pu être vérifiée.');
}

function decodeDataset(manifest, buffers, checkNorms) {
  const [wordBuffer, targetBuffer, vectorBuffer] = buffers;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const words = JSON.parse(decoder.decode(wordBuffer));
  const targets = JSON.parse(decoder.decode(targetBuffer));
  expect(Array.isArray(words) && words.length === manifest.count &&
    words.every(word => typeof word === 'string' && word && word === word.normalize('NFC').toLocaleLowerCase('fr')) &&
    new Set(words).size === words.length && Array.isArray(targets) && targets.length === manifest.targetCount &&
    targets.length >= 1 && new Set(targets).size === targets.length &&
    targets.every(index => Number.isInteger(index) && index >= 0 && index < words.length));
  expect(vectorBuffer.byteLength === words.length * manifest.dimensions * 4);
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  let vectors;
  if (littleEndian) vectors = new Float32Array(vectorBuffer);
  else {
    const view = new DataView(vectorBuffer);
    vectors = new Float32Array(words.length * manifest.dimensions);
    for (let i = 0; i < vectors.length; i++) vectors[i] = view.getFloat32(i * 4, true);
  }
  if (checkNorms) {
    for (let row = 0; row < words.length; row++) {
      let norm = 0;
      for (let d = 0; d < manifest.dimensions; d++) {
        const value = vectors[row * manifest.dimensions + d];
        expect(Number.isFinite(value));
        norm += value * value;
      }
      expect(Math.abs(norm - 1) < 0.00001, 'Un vecteur du dictionnaire n’est pas normalisé.');
    }
  }
  return { id: manifest.id, dimensions: manifest.dimensions, words, vectors, targets,
    credits: { lexique: Boolean(manifest.lexique) } };
}

export async function loadDataset(manifestUrl, progress = () => {}) {
  if (!globalThis.crypto?.subtle) throw new Error('Une connexion HTTPS est nécessaire pour charger le jeu.');
  const source = new URL(manifestUrl).href;
  progress('Lecture du dictionnaire…');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  let cache = null;
  try {
    // Always check the small manifest for a new dataset; assets are content-addressed.
    const manifest = await (await fetchOK(source, { signal: controller.signal, cache: 'no-cache' })).json();
    expect(manifest.schemaVersion === 1 && typeof manifest.id === 'string' && manifest.id &&
      Number.isInteger(manifest.count) && manifest.count >= 1000 &&
      Number.isInteger(manifest.dimensions) && manifest.dimensions === 500 &&
      manifest.normalized === true && manifest.dtype === 'float32-le');
    const records = ASSETS.map(name => assetRecord(manifest.files?.[name]));
    const fingerprint = JSON.stringify([VALIDATION_VERSION, 'blob-v1', manifest.schemaVersion, manifest.id,
      manifest.count, manifest.targetCount, manifest.dimensions, manifest.dtype, manifest.normalized,
      ...records.map(record => [new URL(record.url, source).href, record.sha256, record.bytes])]);
    cache = await openDatasetCache();
    const cached = await readDatasetCache(cache, source, fingerprint);
    if (cached && cached.validationVersion === VALIDATION_VERSION) {
      try {
        progress('Lecture de l’espace des mots enregistré…');
        expect(Array.isArray(cached.blobs) && cached.blobs.length === ASSETS.length &&
          cached.blobs.every((blob, i) => blob instanceof Blob && blob.size === records[i].bytes));
        const buffers = await Promise.all(cached.blobs.map(blob => blob.arrayBuffer()));
        // Integrity is checked even on local copies. Identical bytes were fully normalized
        // and validated before this atomic cache entry was committed.
        await Promise.all(records.map((record, i) => checkAsset(buffers[i], record)));
        return decodeDataset(manifest, buffers, false);
      } catch {
        await deleteDatasetCache(cache, source);
      }
    }
    progress('Chargement de l’espace des mots…');
    const buffers = await Promise.all(records.map(async record => {
      const buffer = await (await fetchOK(new URL(record.url, source), { signal: controller.signal })).arrayBuffer();
      await checkAsset(buffer, record);
      return buffer;
    }));
    progress('Vérification des vecteurs…');
    const dataset = decodeDataset(manifest, buffers, true);
    // Only validated data can be cached. Quota/security/storage failures are optional.
    if (cache) {
      progress('Enregistrement de l’espace des mots…');
      await writeDatasetCache(cache, source, fingerprint, buffers, VALIDATION_VERSION);
    }
    return dataset;
  } finally {
    cache?.close();
    clearTimeout(timer);
  }
}
