import { Game } from './engine.js';
import { loadDataset } from './data.js';

let game;
self.onmessage = async ({ data: message }) => {
  const { id, action, payload } = message;
  try {
    let result;
    if (action === 'init') {
      const dataset = await loadDataset(payload.manifestUrl, text => self.postMessage({ progress: text }));
      game = new Game(dataset);
      result = { ...game.start(payload.snapshot), credits: dataset.credits };
    } else {
      if (!game) throw new Error('Le dictionnaire est en cours de chargement.');
      switch (action) {
        case 'new': result = game.start(); break;
        case 'guess': result = game.guess(payload.word); break;
        case 'hint': result = game.hint(); break;
        case 'give-up': result = game.giveUp(); break;
        default: throw new Error('Action inconnue.');
      }
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.name === 'AbortError'
      ? 'Le chargement a pris trop de temps. Vérifiez votre connexion et réessayez.' :
      ['SyntaxError', 'TypeError', 'RangeError'].includes(error.name)
        ? 'Les données du dictionnaire sont invalides. Réessayez le chargement.' : error.message });
  }
};
