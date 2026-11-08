// Late-90s console look:
//  - render at a low internal resolution, upscale with hard pixel edges (CSS)
//  - vertex snapping to the pixel grid (wobbly polygons)
//  - affine texture mapping (texture warp at angles)
//  - ordered Bayer dithering down to 15-bit colour in a post pass
import * as THREE from 'three';

const snapRes = { value: new THREE.Vector2(320, 240) };

/** Patch a built-in material with vertex snapping + affine texturing. */
export function retro<T extends THREE.Material>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnapRes = snapRes;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uSnapRes;\nvarying float vAffW;')
      .replace(
        '#include <fog_vertex>',
        `{
          vec4 p = gl_Position;
          vec2 half_ = uSnapRes * 0.5;
          p.xy = floor(p.xy / p.w * half_ + 0.5) / half_ * p.w;
          gl_Position = p;
        }
        vAffW = gl_Position.w;
        #ifdef USE_MAP
          vMapUv *= vAffW;
        #endif
        #include <fog_vertex>`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAffW;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          diffuseColor *= texture2D( map, vMapUv / vAffW );
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'retro';
  return mat;
}

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const POST_FRAG = /* glsl */ `
uniform sampler2D tScene;
varying vec2 vUv;
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  int m[16] = int[16](0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5);
  return float(m[idx]) / 16.0;
}
void main() {
  vec3 lin = texture2D(tScene, vUv).rgb;
  vec3 c = pow(max(lin, 0.0), vec3(1.0 / 2.2));        // to display gamma
  c = c * vec3(1.04, 1.0, 0.96) + vec3(0.015, 0.0, 0.0); // warm afternoon grade
  float levels = 31.0;                                  // 5 bits per channel
  c += (bayer4(gl_FragCoord.xy) - 0.5) / levels;
  c = floor(c * levels + 0.5) / levels;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class RetroRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private rt: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat: THREE.ShaderMaterial;
  width = 320;
  height = 240;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(1);
    this.rt = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.postMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.rt.texture } },
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat));
  }

  /** Short side gets `short` pixels; the other side follows the window aspect. */
  resize(cssW: number, cssH: number, short = 240): void {
    const aspect = cssW / cssH;
    const w = aspect >= 1 ? Math.round(short * aspect) : short;
    const h = aspect >= 1 ? short : Math.round(short / aspect);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.rt.setSize(w, h);
    snapRes.value.set(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
}
