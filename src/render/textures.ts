// Tiny procedural pixel textures drawn on canvases. No asset pipeline.
import * as THREE from 'three';

type Draw = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function pixelTexture(w: number, h: number, draw: Draw, seed = 1, repeat: [number, number] = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  draw(g, w, h, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, colors: string[], n: number) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
  }
}

/** Speckled laminate counter top. */
export const counterTex = (repeat: [number, number]) =>
  pixelTexture(
    32,
    32,
    (g, w, h, r) => {
      g.fillStyle = '#e9dcc0';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, r, ['#d8c8a6', '#f5ecd6', '#c9b48e', '#bfa780'], 140);
    },
    3,
    repeat,
  );

/** Glossy square backsplash tiles. */
export const tileTex = (repeat: [number, number]) =>
  pixelTexture(
    16,
    16,
    (g) => {
      g.fillStyle = '#9fd4d0';
      g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#c4ebe6';
      g.fillRect(1, 1, 6, 2);
      g.fillStyle = '#7dbab6';
      g.fillRect(1, 13, 14, 2);
      g.fillStyle = '#f2ead8';
      g.fillRect(0, 0, 16, 1);
      g.fillRect(0, 0, 1, 16);
    },
    5,
    repeat,
  );

/** Cabinet door: wood with a frame. */
export const cabinetTex = (repeat: [number, number]) =>
  pixelTexture(
    32,
    32,
    (g, w, h, r) => {
      g.fillStyle = '#b5703a';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y++) {
        if (r() < 0.35) {
          g.fillStyle = r() < 0.5 ? '#a4622f' : '#c27e45';
          g.fillRect(0, y, w, 1);
        }
      }
      g.strokeStyle = '#7f4520';
      g.lineWidth = 2;
      g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = '#e8d38a';
      g.fillRect(w - 9, 13, 2, 6); // handle
    },
    7,
    repeat,
  );

/** Warm striped wallpaper. */
export const wallTex = (repeat: [number, number]) =>
  pixelTexture(
    16,
    16,
    (g) => {
      g.fillStyle = '#f4d58d';
      g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#eec574';
      g.fillRect(0, 0, 3, 16);
      g.fillRect(8, 0, 1, 16);
      g.fillStyle = '#e46f4b';
      g.fillRect(4, 4, 2, 2);
      g.fillRect(12, 12, 2, 2);
    },
    11,
    repeat,
  );

/** Checkerboard lino floor. */
export const floorTex = (repeat: [number, number]) =>
  pixelTexture(
    16,
    16,
    (g, w, h, r) => {
      g.fillStyle = '#f1ebdf';
      g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#c0453b';
      g.fillRect(0, 0, 8, 8);
      g.fillRect(8, 8, 8, 8);
      speckle(g, w, h, r, ['#d9d0c0', '#a83a31'], 20);
    },
    13,
    repeat,
  );

/** Sky seen through the window. */
export const skyTex = () =>
  pixelTexture(
    16,
    32,
    (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#5fb3ff');
      grad.addColorStop(0.7, '#bfe3ff');
      grad.addColorStop(1, '#ffe6b0');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.fillRect(3, 8, 6, 2);
      g.fillRect(5, 7, 3, 1);
      g.fillRect(10, 14, 4, 1);
    },
    17,
  );

/** Bottle label: an invented "AQUA" brand with a wave. */
export const labelTex = () =>
  pixelTexture(
    64,
    16,
    (g, w, h) => {
      g.fillStyle = '#1f5fbf';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      for (let x = 0; x < w; x++) {
        const y = Math.round(11 + Math.sin(x / 3) * 1.5);
        g.fillRect(x, y, 1, 2);
      }
      g.fillStyle = '#ffd23f';
      // chunky 3x5 pixel letters "AQUA"
      const glyph: Record<string, string[]> = {
        A: ['010', '101', '111', '101', '101'],
        Q: ['010', '101', '101', '111', '011'],
        U: ['101', '101', '101', '101', '111'],
      };
      const draw = (s: string, x0: number) =>
        [...s].forEach((ch, i) =>
          glyph[ch].forEach((row, y) =>
            [...row].forEach((b, x) => b === '1' && g.fillRect(x0 + i * 4 + x, 3 + y, 1, 1)),
          ),
        );
      draw('AQUA', 2);
      draw('AQUA', 34);
    },
    19,
  );
