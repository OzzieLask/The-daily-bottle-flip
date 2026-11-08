// The bottle: the only thing in colour before a landing.
// The group origin is the base centre, matching BottleSim.origin().
import * as THREE from 'three';
import { GEO, P } from '../config';
import type { BottleSim } from '../physics/bottleSim';
import { sketch } from '../render/sketch';

const SEG = 16;

export class BottleMesh {
  readonly group = new THREE.Group();
  readonly shadow: THREE.Mesh;
  private water: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    const profile = [
      [0.0, 0.0],
      [GEO.baseR, 0.0],
      [GEO.R, 0.008],
      [GEO.R, GEO.shoulder],
      [0.027, 0.162],
      [0.017, 0.178],
      [0.014, 0.186],
    ].map(([r, y]) => new THREE.Vector2(r, y));

    const shell = new THREE.Mesh(
      new THREE.LatheGeometry(profile, SEG),
      sketch('#cfeeff', { always: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    shell.renderOrder = 2;

    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(GEO.R + 0.0012, GEO.R + 0.0012, 0.05, SEG, 1, true),
      sketch('#1f5fbf', { always: true }),
    );
    label.position.y = 0.075;

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(GEO.capR, GEO.capR, 0.022, SEG), sketch('#e83a2e', { always: true }));
    cap.position.y = GEO.H - 0.011;

    const waterMat = sketch('#3a9bff', { always: true, opacity: 0.85 });
    for (let i = 0; i < 2; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(GEO.innerR - 0.002, GEO.innerR - 0.002, 1, SEG), waterMat);
      w.renderOrder = 1;
      this.water.push(w);
      this.group.add(w);
    }

    this.group.add(shell, label, cap);
    scene.add(this.group);

    // flat ink blob under the bottle, fading with height
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 16),
      new THREE.MeshBasicMaterial({ color: '#17171a', transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);
  }

  sync(sim: BottleSim): void {
    const [ox, oy] = sim.origin();
    this.group.position.set(ox, oy, 0);
    this.group.rotation.z = sim.theta;
    for (let i = 0; i < 2; i++) {
      const w = this.water[i];
      w.scale.y = sim.q;
      w.position.y = sim.slugS(i);
    }
    const h = Math.max(0, sim.y);
    this.shadow.visible = sim.x > P.counterMinX && sim.x < P.counterMaxX && sim.y > -0.05;
    this.shadow.position.set(sim.x, 0.0015, 0);
    const s = 1 + h * 2.5;
    this.shadow.scale.set(s, s, s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.04, 0.28 - h * 0.5);
  }
}
