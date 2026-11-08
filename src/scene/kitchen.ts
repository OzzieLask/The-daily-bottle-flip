// "STAGE 01 · KITCHEN COUNTER": a small low-poly diorama built in code.
// World units are metres. The counter top is y = 0; the flip happens in z = 0.
import * as THREE from 'three';
import { FLOOR_Y, P } from '../config';
import { retro } from '../render/retro';
import { cabinetTex, counterTex, floorTex, skyTex, tileTex, wallTex } from '../render/textures';

const lambert = (opts: THREE.MeshLambertMaterialParameters) => retro(new THREE.MeshLambertMaterial(opts));

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, seg = 1) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, seg, seg, seg), mat);
  m.position.set(x, y, z);
  return m;
}

export const STAGE = { number: '01', name: 'KITCHEN COUNTER' };

export function buildKitchen(scene: THREE.Scene): void {
  scene.background = new THREE.Color('#f3d9b1');
  scene.fog = new THREE.Fog('#f3d9b1', 1.6, 4.2);

  scene.add(new THREE.HemisphereLight('#fff1d6', '#8a6a4a', 1.4));
  const sun = new THREE.DirectionalLight('#ffd6a0', 2.2);
  sun.position.set(-0.6, 1.4, 1.0);
  scene.add(sun);

  const x0 = P.counterMinX;
  const x1 = P.counterMaxX;
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const zBack = -0.32;
  const zFront = 0.3;
  const depth = zFront - zBack;

  // counter top + front lip
  scene.add(box(len, 0.04, depth, lambert({ map: counterTex([len * 6, depth * 6]) }), cx, -0.02, (zBack + zFront) / 2, 4));
  scene.add(box(len + 0.01, 0.012, 0.012, lambert({ color: '#c9b48e' }), cx, -0.006, zFront, 1));

  // base cabinets
  const cabH = -FLOOR_Y - 0.04 - 0.08;
  scene.add(
    box(len - 0.02, cabH, depth - 0.06, lambert({ map: cabinetTex([len / 0.4, 1]) }), cx, -0.04 - cabH / 2, (zBack + zFront) / 2 - 0.03, 3),
  );
  scene.add(box(len - 0.04, 0.08, depth - 0.1, lambert({ color: '#3b2a20' }), cx, FLOOR_Y + 0.04, -0.03)); // kick plate

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 4, 12, 8), lambert({ map: floorTex([24, 16]) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0.5, FLOOR_Y, 0.8);
  scene.add(floor);

  // back wall: tiles behind counter, wallpaper above
  const tiles = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.45, 12, 3), lambert({ map: tileTex([30, 4.5]) }));
  tiles.position.set(0.2, 0.225, zBack);
  scene.add(tiles);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4, 8, 6), lambert({ map: wallTex([20, 12]) }));
  wall.position.set(0.2, 1.65, zBack - 0.001);
  scene.add(wall);
  const lowerWall = new THREE.Mesh(new THREE.PlaneGeometry(4, 1, 8, 2), lambert({ map: wallTex([20, 5]) }));
  lowerWall.position.set(0.2, -0.5, zBack - 0.05);
  scene.add(lowerWall);

  // window with afternoon sky
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42), new THREE.MeshBasicMaterial({ map: skyTex(), fog: false }));
  sky.position.set(0.05, 0.72, zBack + 0.002);
  scene.add(sky);
  const frame = lambert({ color: '#fdf6e6' });
  scene.add(box(0.68, 0.03, 0.04, frame, 0.05, 0.505, zBack + 0.01));
  scene.add(box(0.68, 0.03, 0.04, frame, 0.05, 0.935, zBack + 0.01));
  scene.add(box(0.03, 0.46, 0.04, frame, -0.275, 0.72, zBack + 0.01));
  scene.add(box(0.03, 0.46, 0.04, frame, 0.375, 0.72, zBack + 0.01));
  scene.add(box(0.02, 0.42, 0.03, frame, 0.05, 0.72, zBack + 0.01));
  scene.add(box(0.7, 0.025, 0.09, frame, 0.05, 0.49, zBack + 0.04)); // sill

  // upper cabinets either side of the window
  const upper = lambert({ map: cabinetTex([1, 1]) });
  scene.add(box(0.5, 0.6, 0.3, upper, -0.62, 1.0, zBack + 0.15, 2));
  scene.add(box(0.5, 0.6, 0.3, upper, 0.72, 1.0, zBack + 0.15, 2));

  // props, all kept behind the flip plane (z = 0)
  addToaster(scene, -0.55, -0.17);
  addFruitBowl(scene, 0.3, -0.19);
  addPlant(scene, 0.22, zBack + 0.05);
  addMug(scene, -0.32, -0.1);
  addPaperTowel(scene, 0.47, -0.22);

  // fridge past the end of the counter
  const fridge = lambert({ color: '#eef3f2' });
  scene.add(box(0.7, 1.8, 0.66, fridge, x1 + 0.6, FLOOR_Y + 0.9, -0.0, 2));
  scene.add(box(0.03, 0.4, 0.03, lambert({ color: '#9aa7a6' }), x1 + 0.3, 0.1, 0.34));
}

function addToaster(scene: THREE.Scene, x: number, z: number) {
  const body = lambert({ color: '#d74d3a' });
  scene.add(box(0.26, 0.17, 0.15, body, x, 0.085, z, 2));
  scene.add(box(0.2, 0.01, 0.025, lambert({ color: '#2b1b17' }), x, 0.171, z - 0.035));
  scene.add(box(0.2, 0.01, 0.025, lambert({ color: '#2b1b17' }), x, 0.171, z + 0.035));
  scene.add(box(0.02, 0.03, 0.03, lambert({ color: '#222' }), x + 0.14, 0.12, z));
}

function addFruitBowl(scene: THREE.Scene, x: number, z: number) {
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.06, 0.06, 8, 1, true),
    lambert({ color: '#4d8fd6', side: THREE.DoubleSide }),
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
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04, 0), lambert({ color: c, flatShading: true }));
    m.position.set(x + dx, y, z + dz);
    m.rotation.set(dx * 20, dz * 30, 0);
    scene.add(m);
  }
}

function addPlant(scene: THREE.Scene, x: number, z: number) {
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.07, 6), lambert({ color: '#c8643c', flatShading: true }));
  pot.position.set(x, 0.535, z);
  scene.add(pot);
  const leaf = lambert({ color: '#3f9e4d', flatShading: true });
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.14, 4), leaf);
    const a = (i / 5) * Math.PI * 2;
    l.position.set(x + Math.cos(a) * 0.025, 0.62, z + Math.sin(a) * 0.02);
    l.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    scene.add(l);
  }
}

function addMug(scene: THREE.Scene, x: number, z: number) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 8), lambert({ color: '#fefaf0', flatShading: true }));
  m.position.set(x, 0.045, z);
  scene.add(m);
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 4, 6), lambert({ color: '#fefaf0' }));
  h.position.set(x + 0.045, 0.05, z);
  scene.add(h);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.035, 8), lambert({ color: '#4a2a17' }));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.set(x, 0.082, z);
  scene.add(coffee);
}

function addPaperTowel(scene: THREE.Scene, x: number, z: number) {
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.26, 8), lambert({ color: '#fbfbf4', flatShading: true }));
  roll.position.set(x, 0.14, z);
  scene.add(roll);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), lambert({ color: '#888' }));
  pole.position.set(x, 0.15, z);
  scene.add(pole);
}
