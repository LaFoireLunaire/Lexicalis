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

async function checkedAsset(record, base, signal) {
  expect(record && typeof record.url === 'string' && /^[a-f0-9]{64}$/.test(record.sha256) &&
    Number.isSafeInteger(record.bytes) && record.bytes > 0);
  const buffer = await (await fetchOK(new URL(record.url, base), { signal })).arrayBuffer();
  expect(buffer.byteLength === record.bytes, 'Le téléchargement est incomplet. Réessayez.');
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  expect(actual === record.sha256, 'L’intégrité du dictionnaire n’a pas pu être vérifiée.');
  return buffer;
}

export async function loadDataset(manifestUrl, progress = () => {}) {
  if (!globalThis.crypto?.subtle) throw new Error('Une connexion HTTPS est nécessaire pour charger le jeu.');
  progress('Lecture du dictionnaire…');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const manifest = await (await fetchOK(manifestUrl, { signal: controller.signal, cache: 'no-cache' })).json();
    expect(manifest.schemaVersion === 1 && typeof manifest.id === 'string' && manifest.id &&
      Number.isInteger(manifest.count) && manifest.count >= 1000 &&
      Number.isInteger(manifest.dimensions) && manifest.dimensions === 500 &&
      manifest.normalized === true && manifest.dtype === 'float32-le');
    progress('Chargement de l’espace des mots…');
    const [wordBuffer, targetBuffer, vectorBuffer] = await Promise.all(
      ['vocabulary', 'targets', 'vectors'].map(name => checkedAsset(manifest.files?.[name], manifestUrl, controller.signal)));
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const words = JSON.parse(decoder.decode(wordBuffer));
    const targets = JSON.parse(decoder.decode(targetBuffer));
    expect(Array.isArray(words) && words.length === manifest.count &&
      words.every(word => typeof word === 'string' && word && word === word.normalize('NFC').toLocaleLowerCase('fr')) &&
      new Set(words).size === words.length && Array.isArray(targets) && targets.length === manifest.targetCount &&
      targets.length >= 1 && new Set(targets).size === targets.length &&
      targets.every(index => Number.isInteger(index) && index >= 0 && index < words.length));
    expect(vectorBuffer.byteLength === words.length * manifest.dimensions * 4);
    // Word2Vec and the exported data are explicitly little endian.
    const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    let vectors;
    if (littleEndian) vectors = new Float32Array(vectorBuffer);
    else {
      const view = new DataView(vectorBuffer);
      vectors = new Float32Array(words.length * manifest.dimensions);
      for (let i = 0; i < vectors.length; i++) vectors[i] = view.getFloat32(i * 4, true);
    }
    progress('Vérification des vecteurs…');
    for (let row = 0; row < words.length; row++) {
      let norm = 0;
      for (let d = 0; d < manifest.dimensions; d++) {
        const value = vectors[row * manifest.dimensions + d];
        expect(Number.isFinite(value));
        norm += value * value;
      }
      expect(Math.abs(norm - 1) < 0.00001, 'Un vecteur du dictionnaire n’est pas normalisé.');
    }
    return { id: manifest.id, dimensions: manifest.dimensions, words, vectors, targets, credits: { lexique: Boolean(manifest.lexique) } };
  } finally {
    clearTimeout(timer);
  }
}
