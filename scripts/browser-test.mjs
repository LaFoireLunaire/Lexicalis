// Isolated synthetic mathematical fixtures. Never writes or serves them in public/data.
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const publicRoot = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const count = 1005, dimensions = 500;
const words = Array.from({ length: count }, (_, i) => `mot${i}`);
words[0] = 'étoile'; words[1] = 'astre'; words[2] = 'lune'; words[3] = 'école';
const vectors = Buffer.alloc(count * dimensions * 4);
for (let i = 0; i < count; i++) {
  const angle = i / (count - 1) * Math.PI;
  vectors.writeFloatLE(Math.cos(angle), i * dimensions * 4);
  vectors.writeFloatLE(Math.sin(angle), i * dimensions * 4 + 4);
}
const assets = {
  vocabulary: Buffer.from(JSON.stringify(words)),
  targets: Buffer.from('[0]'), vectors,
};
const manifest = {
  schemaVersion: 1, id: 'TEST-FIXTURE-NOT-A-REAL-MODEL', dimensions, count, targetCount: 1,
  dtype: 'float32-le', normalized: true,
  files: Object.fromEntries(Object.entries(assets).map(([name, bytes]) => [name, {
    url: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  }])),
};
let mode = 'missing';
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://test.local').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (pathname.startsWith('/data/')) {
    const name = pathname.slice('/data/'.length);
    if (mode === 'missing') { res.writeHead(404).end('Absent'); return; }
    if (name === 'manifest.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(manifest)); return;
    }
    if (assets[name]) {
      const buffer = Buffer.from(assets[name]);
      if (mode === 'corrupt' && name === 'vectors') buffer[100] ^= 1;
      res.end(buffer); return;
    }
  }
  try {
    const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const filename = path.resolve(publicRoot, '.' + relative);
    if (!filename.startsWith(publicRoot + path.sep)) { res.writeHead(403).end(); return; }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(filename)] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(await readFile(filename));
  } catch { res.writeHead(404).end('Absent'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
let checks = 0;
const issues = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => issues.push(error.message));
  await page.goto(url);
  await page.getByRole('button', { name: 'Réessayer le chargement' }).waitFor();
  assert.match(await page.locator('#retry-button').getAttribute('title'), /dictionnaire.*disponible/);
  assert.ok(await page.locator('#word-input').isDisabled()); checks++;
  await page.getByRole('button', { name: 'Comment jouer' }).click();
  assert.ok(await page.locator('#rules-dialog').isVisible());
  await page.getByRole('button', { name: 'À moi de jouer' }).click(); checks++;
  mode = 'valid';
  const loadStart = performance.now();
  await page.getByRole('button', { name: 'Réessayer le chargement' }).click();
  await page.locator('#word-input:enabled').waitFor();
  const fixtureLoadMs = performance.now() - loadStart;
  assert.equal(await page.locator('.sidebar, .help-card, #empty').count(), 0);
  assert.equal(await page.getByText('Tout commence par un mot.').count(), 0);
  assert.equal(await page.locator('.game-panel #hint-button').count(), 1);
  assert.ok(await page.locator('#new-button').isHidden());
  assert.ok(await page.getByRole('button', { name: 'Abandonner la partie', exact: true }).isEnabled()); checks++;
  async function guess(word) {
    await page.locator('#word-input').fill(word);
    await page.getByRole('button', { name: 'Proposer' }).click();
    await page.locator('#guess-button:enabled').waitFor();
  }
  await guess('inconnu');
  assert.match(await page.locator('#word-input').evaluate(node => node.validationMessage), /dictionnaire/);
  assert.equal(await page.locator('#attempts').innerText(), '0'); checks++;
  await guess('  LUNE  ');
  await page.locator('#guesses tr').waitFor();
  assert.equal(await page.locator('#feedback, #sort, .list-toolbar, .compass-card').count(), 0);
  assert.equal(await page.getByText('Vos explorations', { exact: true }).count(), 0); checks++;
  const matchingRows = await page.evaluate(() => {
    const last = document.querySelector('#last-guess-row tr');
    const listed = document.querySelector('#guesses .guess-latest');
    return { last: [...last.cells].map(cell => cell.textContent), listed: [...listed.cells].map(cell => cell.textContent),
      widths: [...last.cells].map((cell, i) => Math.abs(cell.getBoundingClientRect().width - listed.cells[i].getBoundingClientRect().width)),
      sameHeight: Math.abs(last.getBoundingClientRect().height - listed.getBoundingClientRect().height) < 1,
      height: listed.getBoundingClientRect().height,
      padding: getComputedStyle(listed.cells[1]).paddingTop };
  });
  assert.deepEqual(matchingRows.last, matchingRows.listed);
  assert.ok(matchingRows.widths.every(delta => delta < 1) && matchingRows.sameHeight, JSON.stringify(matchingRows));
  assert.equal(matchingRows.padding, '8px');
  assert.ok(matchingRows.height < 45); checks++;
  assert.equal(await page.locator('#attempts').innerText(), '1');
  assert.equal(await page.locator('#guesses tr').count(), 1); checks++;
  await guess('lune');
  assert.equal(await page.locator('#word-input').evaluate(node => node.validationMessage), '');
  assert.equal(await page.locator('#attempts').innerText(), '1');
  assert.equal(await page.locator('#last-guess-number').innerText(), '1');
  assert.equal(await page.locator('.animate-progress').count(), 0); checks++;
  await page.getByRole('button', { name: 'Obtenir un indice' }).click();
  await page.waitForFunction(() => document.querySelector('#hint-count').textContent === '1');
  assert.equal(await page.locator('#attempts').innerText(), '1');
  assert.equal(await page.locator('#guesses .guess-latest').count(), 1); checks++;
  const hintWord = await page.locator('#last-guess-word').evaluate(node => node.firstChild.textContent);
  await guess('  LUNE  ');
  assert.equal(await page.locator('#last-guess-word').innerText(), 'lune');
  assert.equal(await page.locator('#last-guess-number').innerText(), '1');
  await guess(hintWord);
  assert.equal(await page.locator('#last-guess-number').innerText(), '✦');
  assert.equal(await page.locator('#attempts').innerText(), '1');
  assert.equal(await page.locator('#hint-count').innerText(), '1');
  assert.equal(await page.locator('#guesses tr').count(), 2);
  assert.equal(await page.locator('.animate-progress').count(), 0); checks++;
  assert.equal(await page.locator('#sort').count(), 0);
  await page.reload();
  await page.locator('#word-input:enabled').waitFor();
  assert.equal(await page.locator('#sort').count(), 0);
  assert.equal(await page.locator('#guesses tr').count(), 2);
  assert.equal(await page.locator('#hint-count').innerText(), '1'); checks++;
  await page.getByRole('button', { name: 'Abandonner la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Continuer à chercher' }).click();
  assert.ok(await page.locator('#word-input').isEnabled());
  assert.ok(await page.locator('#new-button').isHidden());
  await page.getByRole('button', { name: 'Abandonner la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Abandonner et révéler' }).click();
  await page.locator('#result').waitFor();
  assert.match(await page.locator('#result').innerText(), /étoile/);
  assert.equal(await page.locator('#neighbors li').count(), 1000);
  assert.ok(await page.locator('#word-input').isDisabled()); checks++;
  assert.ok(await page.locator('#give-up-button').isHidden());
  assert.ok(await page.locator('#new-button').isVisible());
  await page.getByRole('button', { name: 'Nouvelle partie', exact: false }).click();
  await page.locator('#word-input:enabled').waitFor();
  assert.ok(await page.locator('#new-button').isHidden());
  assert.ok(await page.locator('#give-up-button').isVisible());
  await page.locator('#word-input').fill(' E\u0301TOILE ');
  await page.getByRole('button', { name: 'Proposer' }).click();
  await page.waitForFunction(() => document.querySelector('#result').textContent.includes('étoile'));
  assert.equal(await page.locator('#result strong').innerText(), 'étoile');
  assert.equal((await page.locator('#result').innerText()).replace(/\s+/g, ' ').trim(), 'étoile 1 essai et 0 indice.');
  assert.equal(await page.locator('#attempts').innerText(), '1'); checks++;
  assert.ok(await page.locator('#give-up-button').isHidden());
  assert.ok(await page.locator('#new-button').isVisible());
  await page.reload();
  await page.locator('#result').waitFor();
  assert.equal(await page.locator('#result strong').innerText(), 'étoile'); checks++;
  assert.ok(await page.locator('#new-button').isVisible());
  assert.ok(await page.locator('#give-up-button').isHidden());
  await page.getByRole('button', { name: 'Nouvelle partie', exact: false }).click();
  await page.locator('#word-input:enabled').waitFor();
  await guess('école');
  await page.getByRole('button', { name: 'Abandonner la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Continuer à chercher' }).click();
  assert.equal(await page.locator('#attempts').innerText(), '1'); checks++;
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  const desktopCounters = await page.locator('.counters').evaluate(node => ({
    number: parseFloat(getComputedStyle(node.querySelector('strong')).fontSize),
    label: parseFloat(getComputedStyle(node.querySelector('p span')).fontSize),
  }));

  for (const width of [320, 360, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right })) }));
    assert.ok(overflow.scroll <= overflow.width, `Horizontal overflow: ${JSON.stringify(overflow)}`);
    assert.ok(await page.locator('#guess-button').isVisible()); checks++;
    const layout = await page.locator('.game-layout').boundingBox();
    const panel = await page.locator('.game-panel').boundingBox();
    assert.ok(Math.abs(layout.width - panel.width) < 1);
    assert.ok(await page.locator('#give-up-button').isVisible());
    assert.ok(await page.locator('.game-panel #hint-button').isVisible());
    if (width <= 680) {
      const mobileCounters = await page.locator('.counters').evaluate(node => ({
        number: parseFloat(getComputedStyle(node.querySelector('strong')).fontSize),
        label: parseFloat(getComputedStyle(node.querySelector('p span')).fontSize),
      }));
      assert.ok(mobileCounters.number < desktopCounters.number && mobileCounters.label < desktopCounters.label);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  const mobile = await browser.newContext({ ...devices['Pixel 7'] });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(url);
  await mobilePage.locator('#word-input:enabled').waitFor();
  await mobilePage.locator('#word-input').fill('étoile');
  await mobilePage.getByRole('button', { name: 'Proposer' }).tap();
  await mobilePage.locator('#result').waitFor();
  assert.equal(await mobilePage.locator('#result strong').innerText(), 'étoile'); checks++;
  await mobile.close();

  const restricted = await browser.newContext();
  await restricted.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    get() { throw new DOMException('Storage unavailable', 'SecurityError'); },
  }));
  const noStorage = await restricted.newPage();
  await noStorage.goto(url);
  await noStorage.locator('#word-input:enabled').waitFor();
  assert.match(await noStorage.locator('#word-input').getAttribute('title'), /sauvegarde locale/); checks++;
  await restricted.close();

  // A long history catches both upward jumps for hot words and downward jumps for cold words.
  const history = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'no-preference' });
  await history.addInitScript(game => {
    if (!localStorage.getItem('lexicalis.save.v1')) localStorage.setItem('lexicalis.save.v1', JSON.stringify({ game, preferences: { sort: 'chronological' } }));
  }, { schemaVersion: 1, dataId: manifest.id, target: 0,
    entries: Array.from({ length: 80 }, (_, i) => ({ index: i + 20, kind: 'guess' })), outcome: 'playing' });
  const historyPage = await history.newPage();
  historyPage.on('pageerror', error => issues.push(error.message));
  await historyPage.goto(url);
  await historyPage.locator('#word-input:enabled').waitFor();
  assert.equal(await historyPage.locator('#last-guess-word').innerText(), 'mot99');
  assert.equal(await historyPage.locator('#guesses tr:first-child td:nth-child(2)').innerText(), 'mot20');
  assert.equal(await historyPage.locator('.animate-progress').count(), 0); checks++;
  const historyScroll = historyPage.locator('.table-wrap');
  const oldPosition = await historyScroll.evaluate(node => { node.scrollTop = 170; return node.scrollTop; });
  assert.ok(oldPosition > 0);
  async function historyGuess(word) {
    await historyPage.locator('#word-input').fill(word);
    await historyPage.locator('#guess-button').click();
    await historyPage.locator('#guess-button:enabled').waitFor();
  }
  await historyGuess('astre');
  await historyPage.waitForFunction(() => document.querySelector('#last-guess-word').textContent === 'astre');
  assert.equal(await historyScroll.evaluate(node => node.scrollTop), oldPosition);
  assert.equal(await historyPage.locator('#last-guess-number').innerText(), '81');
  assert.equal(await historyPage.locator('#last-guess-progression .progress-count').innerText(), '999');
  assert.equal(await historyPage.locator('#guesses .animate-progress').count(), 1);
  assert.equal(await historyPage.locator('#last-guess .animate-progress').count(), 1); checks++;
  const animated = await historyPage.locator('#last-guess .progress-fill').evaluate(node => {
    const animation = node.getAnimations().find(animation => animation.animationName === 'fill-progress');
    if (!animation) return null;
    animation.pause();
    const values = [0, 325, 650].map(time => {
      animation.currentTime = time;
      return new DOMMatrix(getComputedStyle(node).transform).a;
    });
    animation.finish();
    return values;
  });
  assert.ok(animated && animated[0] === 0 && animated[1] > 0 && animated[1] < animated[2]);
  assert.ok(Math.abs(animated[2] - 0.999) < 0.0001); checks++;
  const previousSummary = await historyPage.locator('#last-guess').innerText();
  for (const word of ['inconnu', 'astre']) {
    await historyGuess(word);
    assert.equal(await historyPage.locator('#last-guess').innerText(), previousSummary);
    assert.equal(await historyScroll.evaluate(node => node.scrollTop), oldPosition);
    assert.equal(await historyPage.locator('#attempts').innerText(), '81');
  }
  checks++;
  assert.ok(await historyPage.locator('#guesses-table').evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16));
  assert.ok(await historyPage.locator('#word-input').evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 18)); checks++;
  const beforeRecall = await historyPage.locator('#guesses tr').allTextContents();
  const savedEntries = await historyPage.evaluate(() => JSON.parse(localStorage.getItem('lexicalis.save.v1')).game.entries);
  await historyGuess('  MOT20  ');
  assert.equal(await historyPage.locator('#last-guess-word').innerText(), 'mot20');
  assert.equal(await historyPage.locator('#last-guess-number').innerText(), '1');
  assert.equal(await historyPage.locator('#attempts').innerText(), '81');
  assert.equal(await historyScroll.evaluate(node => node.scrollTop), oldPosition);
  assert.equal(await historyPage.locator('#word-input').evaluate(node => node.validationMessage), '');
  assert.equal(await historyPage.locator('#word-input').inputValue(), '');
  assert.equal(await historyPage.locator('#guesses .guess-latest td:nth-child(2)').innerText(), 'mot20');
  assert.deepEqual(await historyPage.locator('#guesses tr').allTextContents(), beforeRecall);
  assert.deepEqual(await historyPage.evaluate(() => JSON.parse(localStorage.getItem('lexicalis.save.v1')).game.entries), savedEntries);
  assert.equal(await historyPage.locator('.animate-progress').count(), 0);
  await historyGuess('inconnu');
  assert.equal(await historyPage.locator('#last-guess-word').innerText(), 'mot20'); checks++;
  await historyPage.reload();
  await historyPage.locator('#word-input:enabled').waitFor();
  assert.equal(await historyPage.locator('#last-guess-word').innerText(), 'mot20');
  assert.equal(await historyPage.locator('#last-guess-number').innerText(), '1');
  assert.equal(await historyPage.locator('#attempts').innerText(), '81');
  assert.equal(await historyPage.locator('.animate-progress').count(), 0); checks++;
  await historyScroll.evaluate(node => { node.scrollTop = 0; });
  await historyGuess('mot1004');
  await historyPage.waitForFunction(() => document.querySelector('#last-guess-word').textContent === 'mot1004');
  assert.equal(await historyScroll.evaluate(node => node.scrollTop), 0);
  assert.equal(await historyPage.locator('#last-guess-progression').innerText(), '—');
  assert.match(await historyPage.locator('#last-guess-progression').getAttribute('aria-label'), /Hors des 1 000/);
  assert.equal(await historyPage.locator('#last-guess [role=meter]').count(), 0);
  assert.equal(await historyPage.locator('.animate-progress').count(), 0); checks++;
  await historyPage.setViewportSize({ width: 320, height: 900 });
  assert.ok(await historyPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const coldCellFits = await historyPage.locator('#guesses .guess-latest .temperature').evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const text = range.getBoundingClientRect(), cell = node.getBoundingClientRect();
    return { fits: text.left >= cell.left - 1 && text.right <= cell.right + 1, textWidth: text.width, cellWidth: cell.width };
  });
  assert.ok(coldCellFits.fits, JSON.stringify(coldCellFits)); checks++;
  assert.equal(await historyPage.locator('#sort').count(), 0);
  const nextPosition = await historyScroll.evaluate(node => { node.scrollTop = 200; return node.scrollTop; });
  await historyGuess('lune');
  await historyPage.waitForFunction(() => document.querySelector('#last-guess-word').textContent === 'lune');
  assert.equal(await historyScroll.evaluate(node => node.scrollTop), nextPosition);
  assert.equal(await historyPage.locator('#last-guess-number').innerText(), '83');
  assert.equal(await historyPage.locator('#guesses tr:first-child td:nth-child(2)').innerText(), 'astre'); checks++;
  await historyGuess('mot1004');
  assert.equal(await historyPage.locator('#last-guess-word').innerText(), 'mot1004');
  assert.equal(await historyPage.locator('#last-guess-number').innerText(), '82');
  assert.equal(await historyPage.locator('#last-guess-progression').innerText(), '—');
  assert.equal(await historyPage.locator('#attempts').innerText(), '83');
  assert.equal(await historyScroll.evaluate(node => node.scrollTop), nextPosition);
  assert.equal(await historyPage.locator('.animate-progress').count(), 0); checks++;
  assert.ok(await historyPage.locator('#new-button').isHidden());
  await historyPage.locator('#give-up-button').click();
  await historyPage.locator('#accept-confirm').click();
  await historyPage.locator('#result').waitFor();
  await historyPage.locator('#new-button').click();
  await historyPage.waitForFunction(() => document.querySelector('#attempts').textContent === '0');
  assert.ok(await historyPage.locator('#last-guess').isHidden());
  assert.equal(await historyScroll.evaluate(node => node.scrollTop), 0); checks++;
  await history.close();

  const calm = await browser.newContext({ reducedMotion: 'reduce' });
  const calmPage = await calm.newPage();
  await calmPage.goto(url);
  await calmPage.locator('#word-input:enabled').waitFor();
  await calmPage.locator('#word-input').fill('lune');
  await calmPage.locator('#guess-button').click();
  await calmPage.locator('#last-guess').waitFor();
  const calmFill = await calmPage.locator('#last-guess .progress-fill').evaluate(node => ({
    animation: getComputedStyle(node).animationName, scale: new DOMMatrix(getComputedStyle(node).transform).a,
  }));
  assert.equal(calmFill.animation, 'none');
  assert.ok(calmFill.scale > 0.99); checks++;
  await calm.close();

  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lexicalis-vector-cache');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }));
  mode = 'corrupt';
  await page.reload();
  await page.locator('#retry-button').waitFor();
  assert.match(await page.locator('#retry-button').getAttribute('title'), /intégrité/);
  assert.ok(await page.locator('#word-input').isDisabled()); checks++;
  mode = 'valid';
  const origin = new URL(url).origin;
  const external = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/manifest.json') {
      const remoteManifest = { ...manifest, files: Object.fromEntries(Object.entries(manifest.files)
        .map(([key, value]) => [key, { ...value, url: key }])) };
      // Manifest and every vector/vocabulary asset are served cross origin.
      res.end(JSON.stringify(remoteManifest));
    } else if (assets[req.url.slice(1)]) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(assets[req.url.slice(1)]);
    } else if (req.url === '/blogger.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<style>body{margin:0;background:pink}table{display:none}iframe{width:100%;height:1500px;border:0}</style><iframe title="Lexicalis" src="${url}"></iframe>`);
    } else res.writeHead(404).end();
  });
  await new Promise(resolve => external.listen(0, '127.0.0.1', resolve));
  try {
    const externalContext = await browser.newContext();
    await externalContext.addInitScript(manifestUrl => {
      window.LEXICALIS_CONFIG = { manifestUrl };
    }, `http://127.0.0.1:${external.address().port}/manifest.json`);
    const remotePage = await externalContext.newPage();
    await remotePage.goto(url);
    await remotePage.locator('#word-input:enabled').waitFor();
    assert.equal(await remotePage.locator('#word-input').getAttribute('placeholder'), 'Écrivez un mot…'); checks++;
    const embedPage = await externalContext.newPage();
    await embedPage.setViewportSize({ width: 390, height: 844 });
    await embedPage.goto(`http://127.0.0.1:${external.address().port}/blogger.html`);
    const frame = embedPage.frameLocator('iframe');
    await frame.locator('#word-input:enabled').waitFor();
    await frame.locator('#word-input').fill('étoile');
    await frame.getByRole('button', { name: 'Proposer' }).click();
    await frame.locator('#result').waitFor();
    assert.equal(await frame.locator('#result strong').innerText(), 'étoile'); checks++;
    await externalContext.close();
  } finally { await new Promise(resolve => external.close(resolve)); }
  assert.deepEqual(issues, []);
  const report = { checks, fixtureOnly: true, fixtureWords: count, fixtureDimensions: dimensions,
    fixtureLoadMs: Math.round(fixtureLoadMs), browser: await browser.version(),
    note: 'Fixtures synthétiques uniquement ; aucune mesure du modèle réel ou d’un appareil Android physique.' };
  await writeFile('test-results/browser.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
