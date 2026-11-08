// "01 · Kitchen counter": a kitchen island seen from behind the thrower's hand.
// World units are metres. The island top is y = 0, the flip runs along +x in z = 0.
// Every object is drawn as a sketch; its colour only appears when the fill reaches it.
import * as THREE from 'three';
import { FLOOR_Y, P } from '../config';
import { PAPER, sketch } from '../render/sketch';
import { LAMP, WALL_X } from '../physics/world';

export const STAGE = { number: '01', name: 'Kitchen counter' };

function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), sketch(color));
  m.position.set(x, y, z);
  return m;
}

function cyl(rt: number, rb: number, h: number, color: string, x: number, y: number, z: number, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), sketch(color));
  m.position.set(x, y, z);
  return m;
}

export function buildKitchen(scene: THREE.Scene): void {
  scene.background = new THREE.Color(PAPER);

  const x0 = P.counterMinX;
  const x1 = P.counterMaxX;
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const half = 0.32;

  // island: top, body, toe kick
  scene.add(box(len, 0.04, half * 2, '#ffd23f', cx, -0.02, 0));
  const bodyH = -FLOOR_Y - 0.04 - 0.08;
  scene.add(box(len - 0.04, bodyH, half * 2 - 0.06, '#2f6bff', cx, -0.04 - bodyH / 2, 0));
  scene.add(box(len - 0.08, 0.08, half * 2 - 0.12, '#1b3fa8', cx, FLOOR_Y + 0.04, 0));
  // cabinet door seams on the near side
  for (let i = 1; i < 4; i++) {
    scene.add(box(0.006, bodyH - 0.1, 0.006, '#1b3fa8', x0 + (len * i) / 4, -0.04 - bodyH / 2, half - 0.03));
    scene.add(box(0.006, bodyH - 0.1, 0.006, '#1b3fa8', x0 + (len * i) / 4, -0.04 - bodyH / 2, -half + 0.03));
  }

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), sketch('#19b39c'));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0.8, FLOOR_Y, 0);
  scene.add(floor);

  // back wall with a window, past the end of the island
  const wallX = WALL_X;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), sketch('#ff6a4d'));
  wall.rotation.y = -Math.PI / 2;
  wall.position.set(wallX, FLOOR_Y + 1.5, 0);
  scene.add(wall);
  scene.add(box(0.03, 0.62, 0.9, '#ffffff', wallX - 0.02, 0.62, 0)); // frame
  scene.add(box(0.035, 0.54, 0.82, '#7fd3ff', wallX - 0.025, 0.62, 0)); // glass
  scene.add(box(0.04, 0.54, 0.02, '#ffffff', wallX - 0.03, 0.62, 0)); // mullion
  scene.add(box(0.12, 0.025, 0.96, '#ffffff', wallX - 0.06, 0.3, 0)); // sill

  // back counter along the wall
  scene.add(box(0.6, 0.04, 2.6, '#ffd23f', wallX - 0.3, -0.02, 0));
  scene.add(box(0.56, bodyH, 2.56, '#2f6bff', wallX - 0.3, -0.04 - bodyH / 2, 0));
  scene.add(cyl(0.05, 0.035, 0.08, '#e2733f', wallX - 0.2, 0.04, -0.7, 8)); // plant pot
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.16, 4), sketch('#3fae4d'));
    const a = (i / 5) * Math.PI * 2;
    leaf.position.set(wallX - 0.2 + Math.cos(a) * 0.025, 0.15, -0.7 + Math.sin(a) * 0.025);
    leaf.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    scene.add(leaf);
  }

  // fridge to the side
  scene.add(box(0.7, 1.8, 0.7, '#9be7c4', wallX - 0.4, FLOOR_Y + 0.9, -1.75));
  scene.add(box(0.02, 0.5, 0.03, '#17171a', wallX - 0.76, 0.05, -1.5));

  // pendant lamp over the island
  const cordLen = 1.8 - (LAMP.y + LAMP.h / 2);
  scene.add(box(0.006, cordLen, 0.006, '#17171a', LAMP.x, LAMP.y + LAMP.h / 2 + cordLen / 2, 0));
  const shade = new THREE.Mesh(new THREE.ConeGeometry(LAMP.r, LAMP.h, 16, 1, true), sketch('#ff3d7f', { side: THREE.DoubleSide }));
  shade.position.set(LAMP.x, LAMP.y, 0);
  scene.add(shade);

  // a few props on the island, clear of the flip line (z = 0)
  addFruitBowl(scene, 0.32, -0.19);
  scene.add(cyl(0.038, 0.034, 0.09, '#ff9f1c', -0.42, 0.045, 0.21, 12)); // mug
  scene.add(box(0.26, 0.015, 0.16, '#c98a4b', -0.05, 0.0075, 0.21)); // cutting board

  // stools along the near side
  for (const sx of [-0.45, 0.2]) {
    scene.add(cyl(0.16, 0.16, 0.05, '#ff6a4d', sx, -0.3, 0.62, 16));
    scene.add(cyl(0.025, 0.025, 0.56, '#17171a', sx, -0.6, 0.62, 6));
    scene.add(cyl(0.14, 0.14, 0.02, '#17171a', sx, FLOOR_Y + 0.01, 0.62, 12));
  }
}

function addFruitBowl(scene: THREE.Scene, x: number, z: number) {
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.06, 0.06, 16, 1, true),
    sketch('#7a5cff', { side: THREE.DoubleSide }),
  );
  bowl.position.set(x, 0.03, z);
  scene.add(bowl);
  const fruit: [string, number, number, number][] = [
    ['#ff8a1f', -0.03, 0.07, 0.01],
    ['#e83a2e', 0.04, 0.07, -0.02],
    ['#ffd23f', 0.0, 0.1, 0.03],
    ['#7cc242', 0.05, 0.075, 0.04],
  ];
  for (const [c, dx, y, dz] of fruit) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), sketch(c));
    m.position.set(x + dx, y, z + dz);
    scene.add(m);
  }
}
