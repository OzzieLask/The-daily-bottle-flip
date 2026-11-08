// Entry point: a phone that scanned a QR code becomes a controller;
// everything else loads the game.
import './style.css';

const pair = new URLSearchParams(location.search).get('pair');
if (pair) {
  void import('./pair/controller').then((m) => m.runController(pair.toUpperCase()));
} else {
  void import('./main');
}
