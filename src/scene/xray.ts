// X-ray cutaway: when the bottle is hidden behind something (a cabinet, the
// island, the fridge), a paper circle with an ink rim opens over it and the
// bottle is drawn inside, on top of everything.
import * as THREE from 'three';
import type { BottleSim } from '../physics/bottleSim';
import { INK, PAPER } from '../render/sketch';
import { BottleMesh } from './bottleMesh';

const RADIUS = 0.15;

export class XRay {
  readonly scene = new THREE.Scene();
  private bottle: BottleMesh;
  private badge = new THREE.Group();
  private disc: THREE.MeshBasicMaterial;
  private ring: THREE.MeshBasicMaterial;
  private ray = new THREE.Raycaster();
  amount = 0; // 0..1 fade

  constructor() {
    this.disc = new THREE.MeshBasicMaterial({ color: PAPER, transparent: true, opacity: 0, depthWrite: false });
    this.ring = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0, depthWrite: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 40), this.disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(RADIUS, RADIUS * 1.035, 48), this.ring);
    disc.renderOrder = -2;
    ring.renderOrder = -1;
    this.badge.add(disc, ring);
    this.scene.add(this.badge);
    this.bottle = new BottleMesh(this.scene);
    this.scene.visible = false;
  }

  /**
   * Show the cutaway if the bottle is hidden from the camera.
   * `occluders` are the scene's solid meshes (not the bottle itself).
   */
  update(sim: BottleSim, camera: THREE.Camera, occluders: THREE.Object3D[], dt: number): void {
    const [ox, oy] = sim.origin();
    const sn = Math.sin(sim.theta);
    const cs = Math.cos(sim.theta);
    // base, middle and cap of the bottle
    const pts = [0.02, 0.1, 0.19].map((s) => new THREE.Vector3(ox - sn * s, oy + cs * s, 0));
    let hidden = 0;
    for (const p of pts) {
      const dir = p.clone().sub(camera.position);
      const dist = dir.length();
      this.ray.set(camera.position, dir.normalize());
      this.ray.far = dist - 0.02;
      if (this.ray.intersectObjects(occluders, false).length) hidden++;
    }
    const want = hidden >= 2 ? 1 : 0;
    this.amount += (want - this.amount) * (1 - Math.exp(-dt * 10));
    this.scene.visible = this.amount > 0.02;
    if (!this.scene.visible) return;

    this.disc.opacity = 0.94 * this.amount;
    this.ring.opacity = this.amount;
    this.badge.position.copy(pts[1]);
    this.badge.quaternion.copy(camera.quaternion);
    this.bottle.sync(sim);
    this.bottle.shadow.visible = false;
    this.bottle.group.visible = this.amount > 0.5;
  }
}
