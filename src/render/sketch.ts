// Sketchbook renderer.
//  - Every surface is paper white with ink crosshatching in shadow.
//  - Ink outlines come from a post pass that edge-detects normals + depth,
//    with a little jitter that "boils" a few times a second, like hand-drawn lines.
//  - Each material carries a hidden vibrant colour. A shared `fill` sphere,
//    grown from the landing point, floods the world with it. The bottle is
//    always in colour.
import * as THREE from 'three';

// Colours are written straight to the screen: no colour management.
THREE.ColorManagement.enabled = false;

export const PAPER = '#f8f7f4';
export const INK = '#17171a';

export const fill = {
  origin: { value: new THREE.Vector3() },
  radius: { value: 0 },
  px: { value: 1 },
};

const LIGHT = new THREE.Vector3(-0.35, 1, 0.55).normalize();

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uShade;
uniform float uAlways;
uniform float uOpacity;
uniform vec3 uFillO;
uniform float uFillR;
uniform float uPx;
uniform vec3 uLight;
varying vec3 vN;
varying vec3 vW;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
float hatch(float coord, float spacing) {
  float d = abs(fract(coord / spacing) - 0.5) * spacing;
  return 1.0 - smoothstep(0.3, 1.0, d);
}

void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float l = dot(n, uLight) * 0.5 + 0.5;

  vec3 paper = vec3(0.973, 0.969, 0.957);
  vec3 ink = vec3(0.09, 0.09, 0.1);
  vec2 fc = gl_FragCoord.xy / uPx;
  vec3 g = paper;
  if (l < 0.6) g = mix(g, ink, hatch(fc.x + fc.y, 7.0) * 0.5);
  if (l < 0.38) g = mix(g, ink, hatch(fc.x - fc.y, 7.0) * 0.5);

  vec3 c = l > 0.52 ? uColor : uShade;

  float d = distance(vW, uFillO) + (noise(vW * 9.0) - 0.5) * 0.12;
  float f = max(uAlways, step(d, uFillR) * step(0.001, uFillR));
  vec3 col = mix(g, c, f);
  // inky rim on the advancing edge of the colour
  float rim = (1.0 - uAlways) * step(0.001, uFillR) * (1.0 - smoothstep(0.0, 0.014, abs(d - uFillR)));
  col = mix(col, ink, rim);
  gl_FragColor = vec4(col, uOpacity);
}`;

export interface SketchOpts {
  always?: boolean;
  opacity?: number;
  shade?: number;
  side?: THREE.Side;
}

/** Paper-and-ink material with a hidden colour revealed by the fill. */
export function sketch(color: string, o: SketchOpts = {}): THREE.ShaderMaterial {
  const c = new THREE.Color(color);
  const s = c.clone().multiplyScalar(o.shade ?? 0.78);
  const opacity = o.opacity ?? 1;
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: c },
      uShade: { value: s },
      uAlways: { value: o.always ? 1 : 0 },
      uOpacity: { value: opacity },
      uFillO: fill.origin,
      uFillR: fill.radius,
      uPx: fill.px,
      uLight: { value: LIGHT },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    side: o.side ?? THREE.FrontSide,
  });
}

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const POST_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform float uPx;
uniform float uTest;
varying vec2 vUv;

float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float lin(float z) { return (2.0 * uNear * uFar) / (uFar + uNear - (z * 2.0 - 1.0) * (uFar - uNear)); }

void main() {
  vec2 px = 1.0 / uRes;
  // hand-drawn wobble: offset the lookup per small cell, re-rolled ~8x/s
  vec2 cell = floor(gl_FragCoord.xy / (7.0 * uPx));
  vec2 jit = (vec2(h(cell + uTime), h(cell + uTime + 17.0)) - 0.5) * px * 1.4 * uPx;
  vec2 uv = vUv + jit;
  vec2 o = px * 1.15 * uPx;

  vec3 n0 = texture2D(tNormal, uv + vec2(o.x, 0.0)).rgb;
  vec3 n1 = texture2D(tNormal, uv - vec2(o.x, 0.0)).rgb;
  vec3 n2 = texture2D(tNormal, uv + vec2(0.0, o.y)).rgb;
  vec3 n3 = texture2D(tNormal, uv - vec2(0.0, o.y)).rgb;
  float dc = lin(texture2D(tDepth, uv).x);
  float d0 = lin(texture2D(tDepth, uv + vec2(o.x, 0.0)).x);
  float d1 = lin(texture2D(tDepth, uv - vec2(o.x, 0.0)).x);
  float d2 = lin(texture2D(tDepth, uv + vec2(0.0, o.y)).x);
  float d3 = lin(texture2D(tDepth, uv - vec2(0.0, o.y)).x);

  float en = length(n0 - n1) + length(n2 - n3);
  // second derivative: flat planes (even at grazing angles) give ~0, silhouettes don't
  float ed = (abs(d0 + d1 - 2.0 * dc) + abs(d2 + d3 - 2.0 * dc)) / dc;
  float e = max(smoothstep(0.3, 0.55, en), smoothstep(0.02, 0.04, ed));

  vec3 col = texture2D(tColor, vUv).rgb;
  vec3 ink = vec3(0.09, 0.09, 0.1);

  if (uTest > 0.001) {
    // Test mode: watercolour. Soft blur, faded ink, paper grain, blue wash.
    vec3 b = col;
    float r = 3.5 * uPx * uTest;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      b += texture2D(tColor, vUv + vec2(cos(a), sin(a)) * px * r).rgb;
      b += texture2D(tColor, vUv + vec2(cos(a + 0.39), sin(a + 0.39)) * px * r * 2.0).rgb;
    }
    b /= 17.0;
    // low-frequency blotches + fine grain, like pigment settling in paper
    vec2 g = gl_FragCoord.xy / uPx;
    float blot = h(floor(g / 40.0)) * 0.5 + h(floor(g / 17.0)) * 0.5;
    float grain = h(g);
    vec3 wash = vec3(0.23, 0.45, 0.75);
    vec3 wc = b * mix(vec3(1.0), wash * 1.25, 0.35);
    wc *= 0.94 + 0.06 * blot + 0.04 * (grain - 0.5);
    col = mix(col, wc, uTest);
    e *= 1.0 - 0.6 * uTest;
  }
  gl_FragColor = vec4(mix(col, ink, e), 1.0);
}`;

export class SketchRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private colorRT: THREE.WebGLRenderTarget;
  private normalRT: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private post = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat: THREE.ShaderMaterial;
  private paperClear = new THREE.Color(PAPER);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.colorRT = new THREE.WebGLRenderTarget(1, 1);
    this.normalRT = new THREE.WebGLRenderTarget(1, 1, {
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.colorRT.texture },
        tNormal: { value: this.normalRT.texture },
        tDepth: { value: this.normalRT.depthTexture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.02 },
        uFar: { value: 12 },
        uTime: { value: 0 },
        uPx: fill.px,
        uTest: { value: 0 },
      },
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat));
  }

  resize(w: number, h: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    this.colorRT.setSize(bw, bh);
    this.normalRT.setSize(bw, bh);
    this.postMat.uniforms.uRes.value.set(bw, bh);
    fill.px.value = dpr;
  }

  /** 0..1 blend of the test-mode watercolour look. */
  set test(v: number) {
    this.postMat.uniforms.uTest.value = v;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number, overlay?: THREE.Scene): void {
    const r = this.renderer;
    this.postMat.uniforms.uNear.value = camera.near;
    this.postMat.uniforms.uFar.value = camera.far;
    this.postMat.uniforms.uTime.value = Math.floor(time * 8) / 8;

    // pass 1: normals + depth for the ink lines
    const bg = scene.background;
    scene.background = null;
    scene.overrideMaterial = this.normalMat;
    r.setRenderTarget(this.normalRT);
    r.setClearColor(0x8080ff, 1);
    r.clear();
    r.render(scene, camera);
    scene.overrideMaterial = null;
    scene.background = bg;

    // pass 2: paper, hatching and colour
    r.setRenderTarget(this.colorRT);
    r.setClearColor(this.paperClear, 1);
    r.clear();
    r.render(scene, camera);

    // pass 3: ink composite to screen
    r.setRenderTarget(null);
    r.render(this.post, this.postCam);

    // pass 4: overlays drawn on top of everything (the x-ray cutaway)
    if (overlay && overlay.visible) {
      r.autoClear = false;
      r.clearDepth();
      r.render(overlay, camera);
      r.autoClear = true;
    }
  }
}
