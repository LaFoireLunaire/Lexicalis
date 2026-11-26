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
if (saved?.preferences?.sort === 'chronological') $('sort').value = 'chronological';

function feedback(text, kind = '') {
  $('feedback').textContent = text;
  $('feedback').className = `feedback ${kind}`;
}

function controls() {
  const playing = ready && current?.outcome === 'playing';
  $('word-input').disabled = !playing;
  $('guess-button').disabled = !playing || busy;
  $('new-button').disabled = !ready || busy;
  $('hint-button').disabled = !playing || busy;
  $('give-up-button').disabled = !playing || busy;
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
    localStorage.setItem(storageKey, JSON.stringify({
      game: snapshot, preferences: { sort: $('sort').value },
    }));
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

function progression(entry, animate = false, fullLabel = false) {
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
  wrapper.append(track, element('span', fullLabel ? `${entry.progression} / 1 000` : entry.progression, 'progress-count'));
  return wrapper;
}

function renderLastGuess(animatedSequence = null) {
  const entry = current.entries.at(-1);
  $('last-guess').hidden = !entry;
  if (!entry) return;
  $('last-guess-label').textContent = entry.kind === 'hint' ? 'Dernier indice' : 'Dernière proposition';
  $('last-guess-number').textContent = entry.kind === 'hint' ? '✦' : `#${entry.attempt}`;
  $('last-guess-word').textContent = entry.word;
  $('last-guess-temperature').textContent = temperature(entry.temperature);
  $('last-guess').style.setProperty('--temperature', heat(entry.temperature));
  $('last-guess-progression').replaceChildren(entry.progression
    ? progression(entry, entry.sequence === animatedSequence, true)
    : element('span', 'Hors du top 1 000', 'outside-ranking'));
}

function renderTable({ animatedSequence = null, resetScroll = false } = {}) {
  const wrap = document.querySelector('.table-wrap');
  const scrollTop = resetScroll ? 0 : wrap.scrollTop;
  const entries = [...current.entries];
  const chronological = $('sort').value === 'chronological';
  entries.sort(chronological ? (a, b) => b.sequence - a.sequence :
    (a, b) => b.temperature - a.temperature || a.sequence - b.sequence);
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const row = element('tr');
    const latest = entry.sequence === current.entries.length - 1;
    if (latest) row.className = 'guess-latest';
    row.style.setProperty('--temperature', heat(entry.temperature));
    const number = element('td', entry.kind === 'hint' ? '✦' : entry.attempt);
    if (entry.kind === 'hint') number.title = 'Indice — ne compte pas comme un essai';
    row.append(number);
    const word = element('td', entry.word);
    if (latest) {
      const dot = element('span', undefined, 'latest-dot');
      dot.setAttribute('aria-label', 'Dernier mot');
      word.append(dot);
    }
    if (entry.kind === 'hint') word.append(element('span', ' · indice', 'hint-tag'));
    row.append(word, element('td', temperature(entry.temperature), 'numeric temperature'));
    const rank = element('td');
    if (entry.progression) {
      rank.append(progression(entry, entry.sequence === animatedSequence));
    } else {
      rank.textContent = '—';
      rank.setAttribute('aria-label', 'Hors des 1 000 mots les plus proches');
    }
    row.append(rank);
    fragment.append(row);
  }
  $('guesses').replaceChildren(fragment);
  $('entry-count').textContent = current.entries.length;
  $('empty').hidden = entries.length > 0;
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
  const best = current.entries.reduce((found, entry) => !found || entry.temperature > found.temperature ? entry : found, null);
  $('best').hidden = !best;
  if (best) {
    $('best-word').textContent = best.word;
    $('best-score').textContent = temperature(best.temperature);
    $('best').style.setProperty('--temperature', heat(best.temperature));
  }
  const finished = current.outcome !== 'playing';
  $('result').hidden = !finished;
  $('neighbors-section').hidden = !finished;
  if (finished) {
    $('result').replaceChildren(
      element('span', current.outcome === 'won' ? 'Vous avez trouvé votre étoile !' : 'Le mot mystère était…'),
      element('strong', current.answer),
      element('p', `${current.attempts} essai${current.attempts > 1 ? 's' : ''} et ${current.hints} indice${current.hints > 1 ? 's' : ''}. Une nouvelle exploration vous attend.`));
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
  busy = true;
  controls();
  try {
    const result = await call(name, payload);
    current = result.state;
    snapshot = result.snapshot;
    persist();
    render({ animateLatest: name === 'guess' || name === 'hint', resetScroll: name === 'new' });
    feedback(saveWarning || (name === 'hint' ? 'Un nouveau mot voisin a rejoint vos explorations.' :
      name === 'new' ? 'Une nouvelle partie commence. À vous de jouer.' :
      current.outcome === 'won' ? 'Bravo, vous avez trouvé le mot mystère !' :
      current.outcome === 'given-up' ? 'Vous pouvez maintenant explorer les mots voisins.' : ''), 'success');
    if (name === 'new' || (name === 'guess' && $('word-input').value === payload.word)) $('word-input').value = '';
  } catch (error) {
    feedback(error.message, 'error');
  } finally {
    busy = false;
    controls();
    if (current?.outcome === 'playing') $('word-input').focus({ preventScroll: true });
  }
}

function confirmAction(name) {
  if (!ready || busy) return;
  if (name === 'new' && (current.outcome !== 'playing' || current.entries.length === 0)) {
    void action('new');
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
  feedback('Chargement du dictionnaire…');
  worker?.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.progress) { feedback(data.progress); return; }
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
    feedback(error.message, 'error');
    $('retry-button').hidden = false;
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
    feedback(saveWarning || (result.reset ? 'Le dictionnaire a changé ou la sauvegarde était incompatible : une nouvelle partie commence.' :
      result.restored ? 'Votre exploration reprend là où vous l’aviez laissée.' : 'Le dictionnaire est prêt. À vous de jouer.'));
    // Avoid opening the mobile keyboard automatically on initial page load.
    if (matchMedia('(pointer: fine)').matches) $('word-input').focus({ preventScroll: true });
  } catch (error) {
    feedback(error.message, 'error');
    $('retry-button').hidden = false;
  } finally {
    busy = false;
    controls();
  }
}

$('guess-form').addEventListener('submit', event => {
  event.preventDefault();
  void action('guess', { word: $('word-input').value });
});
$('sort').addEventListener('change', () => { if (current) { renderTable({ resetScroll: true }); persist(); } });
$('hint-button').addEventListener('click', () => void action('hint'));
$('give-up-button').addEventListener('click', () => confirmAction('give-up'));
$('new-button').addEventListener('click', () => confirmAction('new'));
$('rules-button').addEventListener('click', () => $('rules-dialog').showModal());
$('cancel-confirm').addEventListener('click', () => $('confirm-dialog').close());
$('retry-button').addEventListener('click', () => void initialize());
void initialize();
