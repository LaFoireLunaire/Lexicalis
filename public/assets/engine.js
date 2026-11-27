// Reference engine: Float32 storage, double-precision accumulation, exact ranking.
export function normalizeWord(value) {
  return String(value).normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('fr');
}

export function randomIndex(length, draw = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  if (!Number.isInteger(length) || length < 1 || length > 0xffffffff) throw new Error('Tirage impossible.');
  const limit = 0x100000000 - (0x100000000 % length);
  let value;
  do { value = draw(); } while (value >= limit);
  return value % length;
}

export class GameError extends Error {}

export class Game {
  constructor({ id, words, vectors, dimensions, targets }, draw) {
    if (!id || !Number.isInteger(dimensions) || dimensions < 1 || !Array.isArray(words) || words.length < 2 ||
        !(vectors instanceof Float32Array) || vectors.length !== words.length * dimensions ||
        !Array.isArray(targets) || !targets.length || new Set(words).size !== words.length ||
        targets.some(i => !Number.isInteger(i) || i < 0 || i >= words.length)) {
      throw new Error('Données de jeu incompatibles.');
    }
    this.id = id;
    this.words = words;
    this.vectors = vectors;
    this.dimensions = dimensions;
    this.targets = [...new Set(targets)];
    this.lookup = new Map(words.map((word, i) => [word, i]));
    this.draw = draw;
  }

  start(snapshot = null) {
    this.entries = [];
    this.lastSequence = null;
    this.outcome = 'playing';
    const valid = this.validSnapshot(snapshot);
    this.target = valid ? snapshot.target : this.targets[randomIndex(this.targets.length, this.draw)];
    this.scores = new Float64Array(this.words.length);
    const offset = this.target * this.dimensions;
    for (let i = 0; i < this.words.length; i++) {
      let dot = 0;
      const base = i * this.dimensions;
      for (let d = 0; d < this.dimensions; d++) dot += this.vectors[base + d] * this.vectors[offset + d];
      this.scores[i] = Math.max(-100, Math.min(100, 100 * dot));
    }
    this.scores[this.target] = 100;
    // The ordered vocabulary index is the tie breaker; never round scores here.
    const order = Array.from(this.words, (_, i) => i);
    order.sort((a, b) => this.scores[b] - this.scores[a] ||
      (a === this.target ? -1 : b === this.target ? 1 : a - b));
    this.nearest = order.slice(0, Math.min(1000, order.length));
    this.ranks = new Uint16Array(this.words.length);
    this.nearest.forEach((index, position) => { this.ranks[index] = 1000 - position; });
    if (valid) {
      this.entries = snapshot.entries.map(entry => ({ ...entry }));
      this.outcome = snapshot.outcome;
      this.lastSequence = Number.isInteger(snapshot.lastSequence) && snapshot.lastSequence >= 0 &&
        snapshot.lastSequence < this.entries.length ? snapshot.lastSequence : this.entries.length - 1;
      if (!this.entries.length) this.lastSequence = null;
    }
    return { restored: valid, reset: Boolean(snapshot && !valid), ...this.result() };
  }

  validSnapshot(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.dataId !== this.id ||
        !this.targets.includes(snapshot.target) || !Array.isArray(snapshot.entries) ||
        !['playing', 'won', 'given-up'].includes(snapshot.outcome) ||
        snapshot.entries.length > this.words.length) return false;
    const seen = new Set();
    for (const entry of snapshot.entries) {
      if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= this.words.length ||
          !['guess', 'hint'].includes(entry.kind) || seen.has(entry.index) ||
          (entry.kind === 'hint' && entry.index === snapshot.target)) return false;
      seen.add(entry.index);
    }
    const found = seen.has(snapshot.target);
    return snapshot.outcome === 'won' ? found : !found;
  }

  assertPlaying() {
    if (this.outcome !== 'playing') throw new GameError('Cette partie est terminée. Commencez une nouvelle partie.');
  }

  guess(value) {
    this.assertPlaying();
    const word = normalizeWord(value);
    if (!word) throw new GameError('Écrivez un mot pour commencer.');
    const index = this.lookup.get(word);
    if (index === undefined) throw new GameError('Ce mot n’est pas dans le dictionnaire du jeu. Vérifiez les accents.');
    const existing = this.entries.findIndex(entry => entry.index === index);
    if (existing !== -1) {
      this.lastSequence = existing;
      return this.result();
    }
    this.entries.push({ index, kind: 'guess' });
    this.lastSequence = this.entries.length - 1;
    if (index === this.target) this.outcome = 'won';
    return this.result();
  }

  hint() {
    this.assertPlaying();
    const seen = new Set(this.entries.map(entry => entry.index));
    const best = this.entries.reduce((rank, entry) => Math.max(rank, this.ranks[entry.index]), 0);
    const used = this.entries.filter(entry => entry.kind === 'hint').length;
    const desired = Math.min(999, Math.max(100 + used * 150, best + 100));
    const available = this.nearest.filter(index => index !== this.target && !seen.has(index));
    if (!available.length) throw new GameError('Tous les indices ont déjà été découverts.');
    available.sort((a, b) => Math.abs(this.ranks[a] - desired) - Math.abs(this.ranks[b] - desired) || a - b);
    this.entries.push({ index: available[0], kind: 'hint' });
    this.lastSequence = this.entries.length - 1;
    return this.result();
  }

  giveUp() {
    this.assertPlaying();
    this.outcome = 'given-up';
    return this.result();
  }

  wordInfo(index) {
    return { word: this.words[index], temperature: this.scores[index], progression: this.ranks[index] || null };
  }

  result() {
    let attempt = 0;
    const entries = this.entries.map((entry, sequence) => ({
      ...this.wordInfo(entry.index), kind: entry.kind, sequence,
      attempt: entry.kind === 'guess' ? ++attempt : null,
    }));
    return {
      state: { outcome: this.outcome, entries, lastSequence: this.lastSequence, attempts: attempt,
        hints: this.entries.length - attempt,
        answer: this.outcome === 'playing' ? null : this.words[this.target],
        neighbors: this.outcome === 'playing' ? [] : this.nearest.map(index => this.wordInfo(index)) },
      snapshot: { schemaVersion: 1, dataId: this.id, target: this.target,
        entries: this.entries.map(entry => ({ ...entry })), lastSequence: this.lastSequence, outcome: this.outcome },
    };
  }
}
