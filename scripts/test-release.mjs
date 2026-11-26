// Validate the actual archive, project subpath and a separate Blogger-like origin.
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdtemp, mkdir, copyFile, rm, writeFile } from 'node:fs/promises';
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

  blogServer = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="fr"><title>Blogger — test isolé</title><style>
      body{margin:0;background:#ffe0e0}table{display:none}input{font-size:60px}iframe{display:block;width:100%;height:1500px;border:0}
      </style><iframe title="Lexicalis" src="${appUrl}"></iframe></html>`);
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
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(root, 'test-results/release-blogger.png'), fullPage: true });
  const report = { archiveIntegrity: true, allInventoryHashesValid: true, projectSubpath: '/Lexicalis/',
    realDataDesktopAndMobile: true, separateOriginIframe: true, parentStylesIsolated: true,
    iframeGuessAccepted: true, horizontalOverflow: false,
    limit: 'Test local du paquet et d’une iframe simulée ; GitHub Pages et le vrai thème Blogger ne sont pas encore publiés ou validés.' };
  await writeFile(path.join(root, 'test-results/release.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await context.close();
} finally {
  if (browser) await browser.close();
  if (blogServer) await new Promise(resolve => blogServer.close(resolve));
  if (siteServer) await new Promise(resolve => siteServer.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
