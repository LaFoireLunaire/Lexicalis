const $ = id => document.getElementById(id);
const storageKey = 'lexicalis.save.v1';
const formatter = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let worker;
let nextId = 0;
const pending = new Map();
let current;
let snapshot;
let busy = false;
let ready = false;
let saveWarning = '';
let saved;
try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); }
catch (error) { saveWarning = error.name === 'SyntaxError'
  ? 'La sauvegarde n’a pas pu être lue : une nouvelle partie commence.'
  : 'La sauvegarde locale est indisponible dans ce navigateur.'; }
function announce(text = '') {
  $('announcer').textContent = text;
}

function clearInputError() {
  $('word-input').setCustomValidity('');
  $('word-input').removeAttribute('aria-invalid');
}

function showInputError(message) {
  const input = $('word-input');
  input.setCustomValidity(message);
  input.setAttribute('aria-invalid', 'true');
  announce(message);
  input.reportValidity();
}

function showLoading(message) {
  $('word-input').placeholder = message;
  announce(message);
}

function showLoadError(message) {
  $('word-input').placeholder = 'Chargement indisponible';
  $('retry-button').title = message;
  $('retry-button').hidden = false;
  announce(message);
}

function showSaveWarning() {
  $('word-input').title = saveWarning;
  announce(saveWarning);
}

function controls() {
  const playing = ready && current?.outcome === 'playing';
  const finished = Boolean(current && current.outcome !== 'playing');
  $('word-input').disabled = !playing;
  $('guess-button').disabled = !playing || busy;
  $('new-button').disabled = !ready || busy;
  $('new-button').hidden = !finished;
  $('hint-button').disabled = !playing || busy;
  $('give-up-button').disabled = !playing || busy;
  $('give-up-button').hidden = finished;
  $('guess-form').setAttribute('aria-busy', String(busy));
}

function call(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, payload });
  });
}

function persist() {
  if (!snapshot) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ game: snapshot }));
  } catch { saveWarning = 'La sauvegarde locale est indisponible. Gardez cette page ouverte pour conserver la partie.'; }
}

function temperature(value) {
  // Avoid displaying a negative zero introduced only by two-decimal formatting.
  return `${formatter.format(Math.abs(value) < 0.005 ? 0 : value)} °C`;
}

function heat(value) {
  if (value < 0) return '#91c7e8';
  if (value < 20) return '#8bc6b3';
  if (value < 35) return '#e1cc83';
  if (value < 50) return '#efab7d';
  return '#f29382';
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function progression(entry, animate = false) {
  const wrapper = element('div', undefined, 'progression');
  const track = element('span', undefined, 'progress-track');
  track.setAttribute('role', 'meter');
  track.setAttribute('aria-label', 'Progression du mot');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '1000');
  track.setAttribute('aria-valuenow', String(entry.progression));
  track.setAttribute('aria-valuetext', `${entry.progression} sur 1 000`);
  const fill = element('span', undefined, 'progress-fill');
  fill.setAttribute('aria-hidden', 'true');
  fill.style.setProperty('--progress', entry.progression / 1000);
  if (animate) fill.classList.add('animate-progress');
  track.append(fill);
  wrapper.append(track, element('span', entry.progression, 'progress-count'));
  return wrapper;
}

function guessRow(entry, { latest = false, animate = false, summary = false } = {}) {
  const row = element('tr');
  if (latest) row.className = 'guess-latest';
  row.style.setProperty('--temperature', heat(entry.temperature));
  const number = element('td', entry.kind === 'hint' ? '✦' : entry.attempt);
  if (entry.kind === 'hint') number.title = 'Indice — ne compte pas comme un essai';
  const word = element('td', entry.word);
  if (latest) {
    const dot = element('span', undefined, 'latest-dot');
    dot.setAttribute('aria-label', 'Dernier mot');
    word.append(dot);
  }
  if (entry.kind === 'hint') word.append(element('span', ' · indice', 'hint-tag'));
  const score = element('td', temperature(entry.temperature), 'numeric temperature');
  const rank = element('td');
  if (entry.progression) rank.append(progression(entry, animate));
  else {
    rank.textContent = '—';
    rank.setAttribute('aria-label', 'Hors des 1 000 mots les plus proches');
  }
  if (summary) {
    number.id = 'last-guess-number';
    word.id = 'last-guess-word';
    score.id = 'last-guess-temperature';
    rank.id = 'last-guess-progression';
  }
  row.append(number, word, score, rank);
  return row;
}

function renderLastGuess(animatedSequence = null) {
  const entry = current.entries[current.lastSequence ?? current.entries.length - 1];
  $('last-guess').hidden = !entry;
  $('last-guess-row').replaceChildren(...(entry ? [guessRow(entry, {
    latest: true, animate: entry.sequence === animatedSequence, summary: true,
  })] : []));
}

function renderTable({ animatedSequence = null, resetScroll = false } = {}) {
  const wrap = document.querySelector('.table-wrap');
  const scrollTop = resetScroll ? 0 : wrap.scrollTop;
  const entries = [...current.entries];
  entries.sort((a, b) => b.temperature - a.temperature || a.sequence - b.sequence);
  const fragment = document.createDocumentFragment();
  for (const entry of entries) fragment.append(guessRow(entry, {
    latest: entry.sequence === (current.lastSequence ?? current.entries.length - 1),
    animate: entry.sequence === animatedSequence,
  }));
  $('guesses').replaceChildren(fragment);
  // Keep the player's scroll position even when a new row sorts above it.
  wrap.scrollTop = scrollTop;
}

function render({ animateLatest = false, resetScroll = false } = {}) {
  $('attempts').textContent = current.attempts;
  $('attempt-label').textContent = current.attempts > 1 ? 'essais' : 'essai';
  $('hint-count').textContent = current.hints;
  $('hint-label').textContent = current.hints > 1 ? 'indices' : 'indice';
  const animatedSequence = animateLatest ? current.entries.at(-1)?.sequence : null;
  renderTable({ animatedSequence, resetScroll });
  renderLastGuess(animatedSequence);
  const finished = current.outcome !== 'playing';
  $('result').hidden = !finished;
  $('neighbors-section').hidden = !finished;
  if (finished) {
    const result = [element('strong', current.answer),
      element('p', `${current.attempts} essai${current.attempts > 1 ? 's' : ''} et ${current.hints} indice${current.hints > 1 ? 's' : ''}.`)];
    if (current.outcome === 'given-up') result.unshift(element('span', 'Le mot mystère était…'));
    $('result').replaceChildren(...result);
    const fragment = document.createDocumentFragment();
    for (const neighbor of current.neighbors) {
      const item = element('li');
      item.append(element('b', neighbor.word), element('span', `${temperature(neighbor.temperature)} · ${neighbor.progression}/1 000`));
      fragment.append(item);
    }
    $('neighbors').replaceChildren(fragment);
  } else {
    $('neighbors').replaceChildren();
  }
  controls();
}

async function action(name, payload) {
  if (busy || !ready) return;
  clearInputError();
  busy = true;
  controls();
  try {
    const result = await call(name, payload);
    const addedEntry = result.state.entries.length > current.entries.length;
    current = result.state;
    snapshot = result.snapshot;
    persist();
    render({ animateLatest: addedEntry && (name === 'guess' || name === 'hint'), resetScroll: name === 'new' });
    showSaveWarning();
    if (name === 'new' || (name === 'guess' && $('word-input').value === payload.word)) $('word-input').value = '';
  } catch (error) {
    if (ready && current?.outcome === 'playing') showInputError(error.message);
    else announce(error.message);
  } finally {
    busy = false;
    controls();
    if (current?.outcome === 'playing') $('word-input').focus({ preventScroll: true });
  }
}

function confirmAction(name) {
  if (!ready || busy) return;
  if (name === 'new') {
    if (current.outcome !== 'playing') void action('new');
    return;
  }
  const giveUp = name === 'give-up';
  $('confirm-title').textContent = giveUp ? 'Dévoiler le mot mystère ?' : 'Commencer une nouvelle partie ?';
  $('confirm-text').textContent = giveUp ? 'Cette exploration prendra fin et le mot mystère sera révélé.' :
    'Votre partie en cours sera remplacée par un nouveau mot mystère.';
  $('accept-confirm').textContent = giveUp ? 'Abandonner et révéler' : 'Nouvelle partie';
  $('accept-confirm').onclick = () => {
    $('confirm-dialog').close();
    void action(name);
  };
  $('confirm-dialog').showModal();
  $('cancel-confirm').focus();
}

async function initialize() {
  ready = false;
  busy = true;
  controls();
  $('retry-button').hidden = true;
  clearInputError();
  showLoading('Chargement du dictionnaire…');
  worker?.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.progress) { showLoading(data.progress); return; }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  worker.onerror = () => {
    const error = new Error('Le moteur du jeu n’a pas pu démarrer. Réessayez le chargement.');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    ready = false;
    busy = false;
    controls();
    showLoadError(error.message);
  };
  try {
    const manifestUrl = new URL(globalThis.LEXICALIS_CONFIG?.manifestUrl || '../data/manifest.json', import.meta.url).href;
    const result = await call('init', { manifestUrl, snapshot: snapshot || saved?.game || null });
    current = result.state;
    snapshot = result.snapshot;
    $('lexique-credit').hidden = !result.credits?.lexique;
    ready = true;
    persist();
    render();
    $('word-input').placeholder = 'Écrivez un mot…';
    showSaveWarning();
    // Avoid opening the mobile keyboard automatically on initial page load.
    if (matchMedia('(pointer: fine)').matches) $('word-input').focus({ preventScroll: true });
  } catch (error) {
    showLoadError(error.message);
  } finally {
    busy = false;
    controls();
  }
}

$('guess-form').addEventListener('submit', event => {
  event.preventDefault();
  void action('guess', { word: $('word-input').value });
});
$('word-input').addEventListener('input', clearInputError);
$('hint-button').addEventListener('click', () => void action('hint'));
$('give-up-button').addEventListener('click', () => confirmAction('give-up'));
$('new-button').addEventListener('click', () => confirmAction('new'));
$('rules-button').addEventListener('click', () => $('rules-dialog').showModal());
$('cancel-confirm').addEventListener('click', () => $('confirm-dialog').close());
$('retry-button').addEventListener('click', () => void initialize());
void initialize();
