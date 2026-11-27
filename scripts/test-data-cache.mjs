// Real IndexedDB and dedicated Workers, with synthetic vectors isolated to tests.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const publicRoot = path.join(root, 'public');
const count = 1005, dimensions = 500;
const words = Array.from({ length: count }, (_, i) => `mot${i}`);
words[0] = 'étoile'; words[1] = 'astre';
const vectors = Buffer.alloc(count * dimensions * 4);
for (let i = 0; i < count; i++) {
  const angle = i * Math.PI / (count - 1);
  vectors.writeFloatLE(Math.cos(angle), i * dimensions * 4);
  vectors.writeFloatLE(Math.sin(angle), i * dimensions * 4 + 4);
}
const buffers = { vocabulary: Buffer.from(JSON.stringify(words)), targets: Buffer.from('[0]'), vectors };
let dataId = 'CACHE-TEST-FIXTURE-v1';
let badNetwork = false;
let workerPolicy = 'normal';
const requests = { manifests: 0, assets: 0 };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = () => ({ schemaVersion: 1, id: dataId, dimensions, count, targetCount: 1,
  dtype: 'float32-le', normalized: true,
  files: Object.fromEntries(Object.entries(buffers).map(([name, bytes]) => [name,
    { url: name, bytes: bytes.length, sha256: digest(bytes) }])) });
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); // A warm pass must use IndexedDB, not the HTTP cache.
  const pathname = new URL(req.url, 'http://test.local').pathname;
  if (pathname === '/data/manifest.json') {
    requests.manifests++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(manifest())); return;
  }
  if (pathname.startsWith('/data/') && buffers[pathname.slice(6)]) {
    requests.assets++;
    const bytes = Buffer.from(buffers[pathname.slice(6)]);
    if (badNetwork && pathname === '/data/vectors') bytes[0] ^= 1;
    res.end(bytes); return;
  }
  try {
    const pathnameDecoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.resolve(publicRoot, '.' + pathnameDecoded);
    if (!file.startsWith(publicRoot + path.sep)) { res.writeHead(403).end(); return; }
    let bytes = await readFile(file);
    if (pathname === '/assets/worker.js') {
      let prefix = '';
      if (workerPolicy === 'denied') prefix = `Object.defineProperty(globalThis, 'indexedDB', { get() { throw new DOMException('Test only', 'SecurityError'); } });\n`;
      if (workerPolicy === 'quota') prefix = `
const originalTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function(stores, mode, ...args) {
  if (mode === 'readwrite') throw new DOMException('Test only', 'QuotaExceededError');
  return originalTransaction.call(this, stores, mode, ...args);
};\n`;
      bytes = Buffer.concat([Buffer.from(prefix), bytes]);
    }
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] || 'application/octet-stream');
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const source = url + '/data/manifest.json';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
const cases = [];
const errors = [];
async function context() {
  const context = await browser.newContext();
  // The Blogger image is unrelated to the cache and is denied by this cloud's policy.
  await context.route('https://blogger.googleusercontent.com/**', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { context, page };
}
async function ready(page, reload = false) {
  if (reload) await page.reload(); else await page.goto(url);
  await page.locator('#word-input:enabled').waitFor();
}
async function storage(page, mutation = null) {
  return page.evaluate(async ({ source, mutation }) => {
    const db = await new Promise((resolve, reject) => {
      const opened = indexedDB.open('lexicalis-vector-cache', 1);
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => resolve(opened.result);
    });
    const execute = (mode, operation) => new Promise((resolve, reject) => {
      const tx = db.transaction('datasets', mode);
      const request = operation(tx.objectStore('datasets'));
      let value;
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error);
    });
    try {
      const value = await execute('readonly', store => store.get(source));
      if (mutation && value) {
        if (mutation === 'corrupt') {
          const bytes = await value.blobs[2].arrayBuffer();
          new Uint8Array(bytes)[0] ^= 1;
          value.blobs[2] = new Blob([bytes]);
        }
        if (mutation === 'obsolete-validator') value.validationVersion = 0;
        await execute('readwrite', store => store.put(value));
      }
      return value ? { fingerprint: value.fingerprint, validationVersion: value.validationVersion } : null;
    } finally { db.close(); }
  }, { source, mutation });
}

try {
  const main = await context();
  await ready(main.page);
  assert.equal(requests.assets, 3);
  assert.equal((await storage(main.page)).validationVersion, 1);
  await main.page.locator('#word-input').fill('astre');
  await main.page.locator('#guess-button').click();
  await main.page.locator('#last-guess-row tr').waitFor();
  const firstScore = await main.page.locator('#last-guess-temperature').innerText();
  cases.push('Premier chargement : trois ressources téléchargées et cache validé écrit');

  const beforeWarm = { ...requests };
  badNetwork = true;
  await ready(main.page, true);
  assert.equal(requests.assets, beforeWarm.assets);
  assert.equal(requests.manifests, beforeWarm.manifests + 1);
  assert.equal(await main.page.locator('#attempts').innerText(), '1');
  assert.equal(await main.page.locator('#last-guess-temperature').innerText(), firstScore);
  badNetwork = false;
  cases.push('Actualisation : manifeste recontrôlé, zéro requête de données, partie et score repris');

  await storage(main.page, 'corrupt');
  const beforeRepair = requests.assets;
  await ready(main.page, true);
  assert.equal(requests.assets, beforeRepair + 3);
  const repaired = requests.assets;
  await ready(main.page, true);
  assert.equal(requests.assets, repaired);
  cases.push('Cache corrompu : SHA-256 détecté, ressources retéléchargées puis cache réparé');

  dataId = 'CACHE-TEST-FIXTURE-v2';
  buffers.vectors.writeFloatLE(0.5, dimensions * 4);
  buffers.vectors.writeFloatLE(Math.sqrt(0.75), dimensions * 4 + 4);
  const beforeVersion = requests.assets;
  await ready(main.page, true);
  assert.equal(requests.assets, beforeVersion + 3);
  assert.equal(await main.page.locator('#attempts').innerText(), '0');
  await main.page.locator('#word-input').fill('astre');
  await main.page.locator('#guess-button').click();
  await main.page.locator('#last-guess-row tr').waitFor();
  assert.equal(await main.page.locator('#last-guess-temperature').innerText(), '50,00 °C');
  cases.push('Nouvelle version : données remplacées et ancienne partie invalidée');

  buffers.vectors.writeFloatLE(0, dimensions * 4);
  buffers.vectors.writeFloatLE(1, dimensions * 4 + 4);
  const beforeNewHash = requests.assets;
  await ready(main.page, true);
  assert.equal(requests.assets, beforeNewHash + 3);
  assert.equal(await main.page.locator('#last-guess-temperature').innerText(), '0,00 °C');
  cases.push('Empreinte modifiée avec même identifiant : aucune réutilisation de données périmées');

  await storage(main.page, 'obsolete-validator');
  const beforeValidator = requests.assets;
  await ready(main.page, true);
  assert.equal(requests.assets, beforeValidator + 3);
  assert.equal((await storage(main.page)).validationVersion, 1);
  cases.push('Version de validation obsolète : nouvelle validation complète');
  await main.context.close();

  for (const policy of ['denied', 'quota']) {
    workerPolicy = policy;
    const restricted = await context();
    const before = requests.assets;
    await ready(restricted.page);
    await ready(restricted.page, true);
    assert.equal(requests.assets, before + 6);
    if (policy === 'quota') assert.equal(await storage(restricted.page), null);
    cases.push(policy === 'denied' ? 'IndexedDB refusé dans le Worker : deux chargements réseau jouables' : 'Quota insuffisant : écriture refusée, jeu utilisable et aucune entrée partielle');
    await restricted.context.close();
  }

  workerPolicy = 'normal';
  badNetwork = true;
  const invalid = await context();
  await invalid.page.goto(url);
  await invalid.page.locator('#retry-button').waitFor();
  assert.match(await invalid.page.locator('#retry-button').getAttribute('title'), /intégrité/);
  assert.equal(await storage(invalid.page), null);
  badNetwork = false;
  await invalid.page.locator('#retry-button').click();
  await invalid.page.locator('#word-input:enabled').waitFor();
  assert.equal((await storage(invalid.page)).validationVersion, 1);
  cases.push('Réseau corrompu : jeu bloqué, cache vide, reprise après ressource corrigée');
  await invalid.context.close();

  buffers.vectors.writeFloatLE(2, dimensions * 4);
  const nonUnit = await context();
  await nonUnit.page.goto(url);
  await nonUnit.page.locator('#retry-button').waitFor();
  assert.match(await nonUnit.page.locator('#retry-button').getAttribute('title'), /normalisé/);
  assert.equal(await storage(nonUnit.page), null);
  await nonUnit.context.close();
  cases.push('Vecteur non normalisé avec SHA-256 valide : refusé avant toute mise en cache');
  assert.deepEqual(errors, []);
  const report = { checks: cases.length, cases, fixtureOnly: true, httpCache: 'no-store',
    indexedDB: 'natif', execution: 'Dedicated Web Workers Chromium', browser: await browser.version() };
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await writeFile(path.join(root, 'test-results/data-cache.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
