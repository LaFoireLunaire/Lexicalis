// Validate the actual archive, project subpath and a separate Blogger-like origin.
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdtemp, mkdir, copyFile, rm, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const release = path.resolve(process.argv[2] || path.join(root, 'dist/release'));
const temp = await mkdtemp(path.join(os.tmpdir(), 'lexicalis-release-'));
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command}: exit ${code}`)));
  });
}
let siteServer, blogServer, browser;
try {
  await run('python3', ['-c', `
import hashlib,json,sys,zipfile
from pathlib import Path
release=Path(sys.argv[1]); target=Path(sys.argv[2])/'Lexicalis'
archive=release/'lexicalis-site.zip'
expected=(release/'lexicalis-site.zip.sha256').read_text().split()[0]
assert hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()==expected
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 for info in z.infolist():
  assert not Path(info.filename).is_absolute() and '..' not in Path(info.filename).parts
  assert not info.filename.startswith(('.git/', '.cache/', '.venv/', 'node_modules/'))
 z.extractall(target)
report=json.loads((release/'release.json').read_text())
for record in report['files']:
 p=target/record['path']
 assert p.stat().st_size==record['bytes']
 assert hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==record['sha256']
print('Archive : CRC, SHA-256 et inventaire vérifiés ; extraction sous /Lexicalis/.')
`, release, temp]);
  siteServer = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://local.test').pathname);
      let filename = path.resolve(temp, '.' + pathname);
      if (!filename.startsWith(temp + path.sep)) { res.writeHead(403).end(); return; }
      let info = await stat(filename);
      if (info.isDirectory()) {
        if (!pathname.endsWith('/')) { res.writeHead(302, { Location: pathname + '/' }).end(); return; }
        filename = path.join(filename, 'index.html');
        info = await stat(filename);
      }
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json' }[path.extname(filename)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size });
      createReadStream(filename).pipe(res);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => siteServer.listen(0, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${siteServer.address().port}/Lexicalis/`;
  await run('node', ['scripts/smoke-real-data.mjs', appUrl]);
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await copyFile(path.join(root, 'test-results/real-browser.json'), path.join(root, 'test-results/release-browser.json'));

  const releaseInfo = JSON.parse(await readFile(path.join(release, 'release.json'), 'utf8'));
  const embed = (await readFile(path.join(release, 'blogger.html'), 'utf8')).replace(releaseInfo.siteUrl, appUrl);
  blogServer = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="fr"><title>Blogger — test isolé</title><style>
      body{margin:0;background:#ffe0e0}table{display:none}input{font-size:60px}
      .blog-column{width:440px;max-width:80%;margin:100px auto;transform:translateZ(0);overflow:hidden}
      iframe{max-width:300px!important;height:200px!important;border:8px solid red}
      </style><header>En-tête du blog</header><main class="blog-column"><h1>Titre Blogger</h1>${embed}</main><aside>Colonne du blog</aside></html>`);
  });
  await new Promise(resolve => blogServer.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${blogServer.address().port}/`);
  const frame = page.frameLocator('iframe');
  await frame.locator('#word-input:enabled').waitFor({ timeout: 180000 });
  assert.equal(await frame.locator('#guesses-table').evaluate(node => getComputedStyle(node).display), 'table');
  assert.ok(await frame.locator('html').evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await frame.locator('#word-input').fill('ordinateur');
  await frame.locator('#guess-button').click();
  await frame.locator('#guesses tr').waitFor();
  assert.equal(await frame.locator('#attempts').innerText(), '1');
  assert.equal(await page.locator('#lexicalis-blogger-frame').evaluate(node => node.parentNode === document.body), true);
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const bounds = await page.locator('#lexicalis-blogger-frame').boundingBox();
    assert.ok(Math.abs(bounds.x) < 1 && Math.abs(bounds.y) < 1);
    assert.ok(Math.abs(bounds.width - viewport.width) < 1 && Math.abs(bounds.height - viewport.height) < 1, JSON.stringify({ bounds, viewport }));
    assert.ok(await frame.locator('html').evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await frame.getByRole('heading', { name: 'Lexicalis', exact: true }).count(), 1);
    const logo = await frame.locator('.game-logo').boundingBox();
    assert.ok(Math.abs(logo.width - (viewport.width <= 680 ? 120 : 150)) < 1);
    assert.ok(Math.abs(logo.width / logo.height - 2048 / 683) < 0.01);
    assert.equal(await frame.locator('.brand, .introduction, .unlimited, .panel-foot, .privacy, .compass-card, .list-toolbar, #feedback, #sort').count(), 0);
    assert.equal(await frame.locator('.help-card h2').innerText(), 'Un petit coup de pouce ?');
    assert.equal(await frame.locator('.help-card p').innerText(), 'Un indice dévoile un mot voisin.');
    const gameWidth = await frame.locator('.lexicalis').evaluate(node => node.getBoundingClientRect().width);
    assert.ok(Math.abs(gameWidth - viewport.width) < 1);
  }
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(root, 'test-results/release-blogger.png'), fullPage: true });
  const report = { archiveIntegrity: true, allInventoryHashesValid: true, projectSubpath: '/Lexicalis/',
    realDataDesktopAndMobile: true, separateOriginIframe: true, parentStylesIsolated: true,
    iframeGuessAccepted: true, horizontalOverflow: false, fullViewportIframe: true,
    themeColumnEscaped: true, compactHeaderAndRequestedRemovals: true,
    limit: 'Test local du paquet et d’une iframe simulée ; le rendu du nouveau bloc sur le vrai thème Blogger reste à vérifier après remplacement.' };
  await writeFile(path.join(root, 'test-results/release.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await context.close();
} finally {
  if (browser) await browser.close();
  if (blogServer) await new Promise(resolve => blogServer.close(resolve));
  if (siteServer) await new Promise(resolve => siteServer.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
