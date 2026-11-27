// Requires the REAL prepared dataset and a running server. No synthetic fallback.
// Usage: node scripts/smoke-real-data.mjs [http://127.0.0.1:3000]
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'public/data/manifest.json'), 'utf8'));
const words = JSON.parse(await readFile(path.join(root, 'public/data', manifest.files.vocabulary.url), 'utf8'));
const targets = JSON.parse(await readFile(path.join(root, 'public/data', manifest.files.targets.url), 'utf8'));
assert.equal(manifest.dimensions, 500);
assert.ok(manifest.count >= 1000 && manifest.targetCount >= 2000);
assert.ok(manifest.source.sha256 && manifest.source.verification === 'publisher-md5-over-https');
const virtualIndex = words.indexOf('virtuel');
const target = targets.includes(virtualIndex) ? virtualIndex : targets[0];
const answer = words[target];
const url = process.argv[2] || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
const results = [];
await mkdir(path.join(root, 'test-results'), { recursive: true });
try {
  for (const mode of ['desktop', 'mobile-emulated']) {
    const context = await browser.newContext(mode === 'desktop'
      ? { viewport: { width: 1440, height: 1080 } } : { ...devices['Pixel 7'] });
    await context.addInitScript(saved => {
      if (!localStorage.getItem('lexicalis.save.v1')) {
        localStorage.setItem('lexicalis.save.v1', JSON.stringify({ game: saved }));
      }
      window.testTicks = { last: performance.now(), longest: 0, ticks: 0 };
      setInterval(() => {
        const now = performance.now();
        window.testTicks.longest = Math.max(window.testTicks.longest, now - window.testTicks.last);
        window.testTicks.last = now;
        window.testTicks.ticks++;
      }, 20);
    }, { schemaVersion: 1, dataId: manifest.id, target, entries: [], outcome: 'playing' });
    const page = await context.newPage();
    const errors = [];
    const manifestUrl = new URL('data/manifest.json', url).href;
    const assetUrls = new Set(Object.values(manifest.files).map(record => new URL(record.url, manifestUrl).href));
    const requests = { assets: 0, manifests: 0 };
    page.on('request', request => {
      if (assetUrls.has(request.url())) requests.assets++;
      if (request.url() === manifestUrl) requests.manifests++;
    });
    page.on('pageerror', error => errors.push(error.message));
    if (mode === 'mobile-emulated') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    const started = performance.now();
    await page.goto(url);
    await page.locator('#word-input:enabled').waitFor({ timeout: 180000 });
    const loadMs = performance.now() - started;
    const dataFetchesFirstLoad = requests.assets;
    assert.equal(dataFetchesFirstLoad, 3);
    assert.equal(await page.locator('#attempts').innerText(), '0');
    const sample = ['ordinateur', 'avatar', 'univers', 'jeu'].filter(word => words.includes(word) && word !== answer);
    let lastGuessMs;
    for (const word of sample) {
      await page.locator('#word-input').fill(word);
      const guessStart = performance.now();
      await page.locator('#guess-button').click();
      await page.locator('#guess-button:enabled').waitFor();
      lastGuessMs = performance.now() - guessStart;
    }
    assert.equal(await page.locator('#attempts').innerText(), String(sample.length));
    assert.equal(await page.locator('#guesses tr').count(), sample.length);
    assert.equal(await page.locator('#last-guess-word').innerText(), sample.at(-1));
    assert.equal(await page.locator('#last-guess-temperature').innerText(),
      await page.locator('#guesses .guess-latest .temperature').innerText());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const displayedScores = await page.locator('#guesses tr').allTextContents();
    await page.screenshot({ path: path.join(root, `test-results/real-${mode}.png`), fullPage: true });
    const initialTiming = await page.evaluate(() => window.testTicks);
    const assetsBeforeReload = requests.assets;
    const manifestsBeforeReload = requests.manifests;
    const reloadStarted = performance.now();
    await page.reload();
    await page.locator('#word-input:enabled').waitFor({ timeout: 180000 });
    const reloadMs = performance.now() - reloadStarted;
    const dataFetchesOnReload = requests.assets - assetsBeforeReload;
    assert.equal(dataFetchesOnReload, 0);
    assert.equal(requests.manifests - manifestsBeforeReload, 1);
    assert.equal(await page.locator('#attempts').innerText(), String(sample.length));
    assert.equal(await page.locator('#last-guess-word').innerText(), sample.at(-1));
    await page.locator('#word-input').fill(answer);
    await page.locator('#guess-button').click();
    await page.locator('#result').waitFor();
    assert.equal(await page.locator('#result strong').innerText(), answer);
    assert.doesNotMatch(await page.locator('#result').innerText(), /votre étoile|nouvelle exploration/);
    assert.equal(await page.locator('#neighbors li').count(), 1000);
    assert.equal(await page.locator('#guesses tr:first-child .temperature').innerText(), '100,00 °C');
    const timing = await page.evaluate(() => window.testTicks);
    assert.deepEqual(errors, []);
    results.push({ mode, loadMs: Math.round(loadMs), reloadMs: Math.round(reloadMs),
      dataFetchesFirstLoad, dataFetchesOnReload, manifestRechecked: true,
      vectorBytesNotFetchedOnReload: manifest.files.vectors.bytes,
      lastGuessRoundTripMs: Math.round(lastGuessMs),
      mainThreadIntervalMaxMs: Math.round(Math.max(initialTiming.longest, timing.longest)),
      mainThreadTicks: initialTiming.ticks + timing.ticks,
      displayedScores, lastGuessDetailsMatchTable: true, restored: true, won: true, neighbors: 1000, horizontalOverflow: false,
      cpuSlowdown: mode === 'mobile-emulated' ? 4 : 1 });
    await context.close();
  }
  const report = { dataId: manifest.id, realData: true, words: manifest.count,
    mysteries: manifest.targetCount, dimensions: manifest.dimensions,
    vectorMiB: manifest.files.vectors.bytes / 1048576,
    sourceSha256: manifest.source.sha256, controlledTarget: answer,
    browser: await browser.version(), results,
    limitation: 'Serveur local sur ordinateur cloud. Le mode mobile est une émulation Chromium avec CPU ralenti, pas un appareil Android physique ni un débit Internet réel.' };
  await writeFile(path.join(root, 'test-results/real-browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
