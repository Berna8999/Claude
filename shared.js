import * as THREE from 'three';

/* ─────────────────────────────────────────────────────────────
   Orbita — peças compartilhadas pelas cenas 3D
   (ambiente de reflexos, vidro, cromo e o shader de cáusticas)
   ───────────────────────────────────────────────────────────── */

export const TAU = Math.PI * 2;
export const BG_HEX = '#f8f0ea';
export const INK_HEX = '#0a090c';

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const span = (x, a, b) => clamp01((x - a) / (b - a));
export const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const smooth = (t) => t * t * (3 - 2 * t);

export function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───────────── Ambiente (reflexos do vidro e do cromo) ───────────── */

export function makeEnvironment(renderer) {
  const env = new THREE.Scene();

  const dome = new THREE.SphereGeometry(30, 48, 24);
  const p = dome.attributes.position;
  const col = new Float32Array(p.count * 3);
  const top = new THREE.Color(1.3, 1.22, 1.16);
  const mid = new THREE.Color(0.96, 0.88, 0.9);
  const bot = new THREE.Color(0.34, 0.2, 0.78);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const h = p.getY(i) / 30;
    c.copy(mid).lerp(h > 0 ? top : bot, Math.abs(h));
    col.set([c.r, c.g, c.b], i * 3);
  }
  dome.setAttribute('color', new THREE.BufferAttribute(col, 3));
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const panel = (hex, k, x, y, z, w, h) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  panel('#ffffff', 10, 0, 15, 5, 18, 8);     // softbox de cima
  panel('#ffffff', 6, -15, 5, 8, 6, 15);     // luz lateral esquerda
  panel('#7a35ff', 8, 15, -2, 6, 8, 13);     // violeta à direita
  panel('#5a1fff', 7, -10, -11, -5, 13, 7);  // violeta de baixo
  panel('#ffd4f0', 4, 6, 6, -15, 11, 10);    // rosa ao fundo
  panel('#1a0d3a', 1, 0, -16, 2, 26, 12);    // base escura: contraste do cromado

  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

/* ───────────── Materiais ───────────── */

export function makeGlass(envMap, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.03,
    metalness: 0,
    transmission: 1,
    ior: 1.33,
    thickness: 0.3,
    attenuationColor: new THREE.Color('#bda2ff'),
    attenuationDistance: 2.4,
    iridescence: 0.35,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [140, 520],
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    dispersion: 2.5,
    envMap,
    envMapIntensity: 1.15,
    side: THREE.DoubleSide,
    ...opts,
  });
}

export function makeChrome(envMap, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: '#efe8ff',
    metalness: 1,
    roughness: 0.06,
    envMap,
    envMapIntensity: 1.1,
    ...opts,
  });
}

/* ───────────── Cáusticas (GLSL) ───────────── */

export const CAUSTIC_GLSL = /* glsl */ `
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  // distância até a borda da célula (F2 - F1): desenha a malha de luz
  float cellEdge(vec2 p, float t) {
    vec2 g = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 q = o + 0.5 + 0.4 * sin(t + 6.2831 * hash2(g + o)) - f;
        float d = dot(q, q);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
    }
    return sqrt(d2) - sqrt(d1);
  }
  float caustic(vec2 p, float t) {
    p += 0.34 * sin(p.yx * 1.3 + t * 0.6) + 0.14 * sin(p.yx * 3.1 - t * 0.8);
    float e1 = cellEdge(p, t);
    float e2 = cellEdge(p * 0.56 + vec2(4.1, 1.7), t * 0.7 + 2.0);
    float fine = pow(1.0 - smoothstep(0.0, 0.24, e1), 1.6);
    float broad = 1.0 - smoothstep(0.0, 0.55, e2);
    return clamp(fine * (0.2 + 0.95 * broad) + 0.3 * broad * broad, 0.0, 1.0);
  }
`;

// mistura "por cima" sem entrar na lista transparente (aparece através do vidro)
export const OVERLAY_BLEND = {
  transparent: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};
