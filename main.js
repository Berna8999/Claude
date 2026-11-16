import * as THREE from 'three';
import {
  TAU, BG_HEX, INK_HEX, clamp01, lerp, span, easeIO, easeSine, smooth, mulberry32,
  makeEnvironment, makeGlass, makeChrome, CAUSTIC_GLSL, OVERLAY_BLEND,
} from './shared.js';

/* ─────────────────────────────────────────────────────────────
   Orbita — hero
   Poça d'água → respingo → anel de vidro, enquanto as letras do
   título se afastam. O título também é desenhado na cena 3D para
   que o vidro refrate as letras de verdade.
   ───────────────────────────────────────────────────────────── */

const HOLD = 1.0;        // segundos parado na poça antes de começar
const DURATION = 4.6;    // duração da transformação
const RING_X = 0.478;     // centro do anel (fração da largura)
const MORPH_SPLIT = 0.46; // ponto em que o fio d'água vira fita torcida

const doc = document.documentElement;
const hero = document.querySelector('.hero');
const canvas = hero.querySelector('.hero__canvas');
const headline = hero.querySelector('.headline');
const pieceEls = [...headline.querySelectorAll('.piece')];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ?p=0.5 congela a animação num ponto (0 = poça, 1 = anel) para ajustes
const frozenParam = new URLSearchParams(location.search).get('p');
let FROZEN = frozenParam === null ? null : Math.min(1, Math.max(0, parseFloat(frozenParam) || 0));

/* ───────────── Renderer ───────────── */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  doc.classList.add('is-ready'); // sem WebGL: o título em HTML continua visível
  throw err;
}

const BG = new THREE.Color(BG_HEX);
const INK = INK_HEX;
const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

renderer.setPixelRatio(pixelRatio);
renderer.setClearColor(BG, 1);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = BG;

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);
camera.position.z = 10;

/* ───────────── Ambiente (reflexos do vidro) ───────────── */

const envMap = makeEnvironment(renderer);

/* ───────────── Materiais ───────────── */

const WATER_TINT = new THREE.Color('#bda2ff');
const GLASS_TINT = new THREE.Color('#9048ff');

const glass = makeGlass(envMap, { attenuationColor: WATER_TINT.clone() });
const chrome = makeChrome(envMap);

/* ───────────── Grupos ───────────── */

const root = new THREE.Group();   // posição + escala
const tilt = new THREE.Group();   // inclinação do anel
const spinG = new THREE.Group();  // giro em torno do próprio eixo
root.add(tilt);
tilt.add(spinG);
scene.add(root);

const floor = new THREE.Group();  // brilho/cáusticas no "chão"
scene.add(floor);

/* ───────────── Geometria do anel (recalculada durante a transformação) ───────────── */

const U = 288;
const V = 56;
const ringPos = new Float32Array(U * V * 3);
const ringGeo = new THREE.BufferGeometry();
ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3).setUsage(THREE.DynamicDrawUsage));
ringGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(U * V * 3), 3).setUsage(THREE.DynamicDrawUsage));

// A fita dá 1,5 volta sobre si mesma: na emenda o perfil chega girado 180°,
// então os índices da última fileira são deslocados meia volta.
function buildIndex(shift) {
  const idx = new Uint32Array(U * V * 6);
  let k = 0;
  for (let i = 0; i < U; i++) {
    const i2 = (i + 1) % U;
    const s = i === U - 1 ? shift : 0;
    for (let j = 0; j < V; j++) {
      const a = i * V + j;
      const b = i * V + ((j + 1) % V);
      const c = i2 * V + ((j + s) % V);
      const d = i2 * V + ((j + 1 + s) % V);
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
  }
  return new THREE.BufferAttribute(idx, 1);
}
const indexFlat = buildIndex(0);
const indexTwist = buildIndex(V / 2);
ringGeo.setIndex(indexFlat);

const ring = new THREE.Mesh(ringGeo, glass);
ring.frustumCulled = false;
spinG.add(ring);

// parâmetros do quadro atual
const P = { t: 0, eR: 0, eZ: 0, e1: 0, e2: 0, turb: 0, twist: false };

function setParams(m, t) {
  P.t = t;
  P.eR = easeIO(span(m, 0.04, 0.66));
  P.eZ = easeIO(span(m, 0.25, 1));
  P.e1 = easeIO(span(m, 0, MORPH_SPLIT));
  P.e2 = easeIO(span(m, MORPH_SPLIT, 1));
  P.turb = Math.pow(Math.sin(Math.PI * clamp01(m)), 1.2);
  P.twist = m >= MORPH_SPLIT;
}

// contorno irregular da poça
function puddleR(u, t) {
  return 1.22 * (1 + 0.2 * Math.cos(2 * u + 0.3) + 0.085 * Math.sin(3 * u + 2.1) + 0.05 * Math.sin(5 * u + 4.2 + t * 0.7));
}

// raio do fio d'água no meio da transformação (gomos grossos e pescoços finos)
function streamR(u, t) {
  return 0.092 * (1 + 0.5 * Math.sin(3 * u + 1.1 * t + 0.5) + 0.28 * Math.sin(5 * u - 1.7 * t + 2.0));
}

// curva central do anel; devolve o raio
function curveAt(u, out, o = 0) {
  const rA = 0.5 * puddleR(u, P.t);
  const rC = 1 + 0.07 * Math.sin(2 * u + 0.6) + 0.035 * Math.sin(3 * u + 1.9);
  const r = lerp(rA, rC, P.eR)
    + P.turb * (0.1 * Math.sin(3 * u - 1.9 * P.t + 1) + 0.06 * Math.sin(5 * u + 2.6 * P.t));
  const z = P.eZ * 0.24 * Math.sin(2 * u + 0.4)
    + P.turb * (0.2 * Math.sin(2 * u + 1.4 * P.t) + 0.09 * Math.sin(4 * u - 2.2 * P.t + 2));
  out[o] = r * Math.cos(u);
  out[o + 1] = r * Math.sin(u);
  out[o + 2] = z;
  return r;
}

const curvePts = new Float32Array(U * 3);
const curveRad = new Float32Array(U);
const secX = new Float32Array(V);
const secY = new Float32Array(V);
let currentIndex = indexFlat;

function updateRing() {
  // perfil: superelipse (achatado na poça, círculo no fio, fita arredondada no anel)
  const expo = P.twist ? 2 + 0.6 * P.e2 : lerp(5, 2, P.e1);
  const pw = 2 / expo;
  for (let j = 0; j < V; j++) {
    const a = (j / V) * TAU;
    const cs = Math.cos(a), sn = Math.sin(a);
    secX[j] = Math.sign(cs) * Math.pow(Math.abs(cs), pw);
    secY[j] = Math.sign(sn) * Math.pow(Math.abs(sn), pw);
  }

  for (let i = 0; i < U; i++) curveRad[i] = curveAt((i / U) * TAU, curvePts, i * 3);

  for (let i = 0; i < U; i++) {
    const u = (i / U) * TAU;
    const ip = ((i + 1) % U) * 3, im = ((i - 1 + U) % U) * 3, ic = i * 3;

    let tx = curvePts[ip] - curvePts[im];
    let ty = curvePts[ip + 1] - curvePts[im + 1];
    let tz = curvePts[ip + 2] - curvePts[im + 2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;

    const nx = Math.cos(u), ny = Math.sin(u); // N radial
    let bx = -tz * ny, by = tz * nx, bz = tx * ny - ty * nx; // B = T × N
    const bl = Math.hypot(bx, by, bz) || 1;
    bx /= bl; by /= bl; bz /= bl;

    const s = streamR(u, P.t);
    let a, b, phi;
    if (!P.twist) {
      a = Math.min(lerp(0.5 * puddleR(u, P.t), s, P.e1), curveRad[i] * 0.999);
      b = lerp(0.03, s, P.e1);
      phi = 0;
    } else {
      a = lerp(s, 0.3 * (1 + 0.12 * Math.sin(2 * u + 1)), P.e2);
      b = lerp(s, 0.08, P.e2);
      phi = 1.5 * u + 0.6;
    }
    const cp = Math.cos(phi), sp = Math.sin(phi);

    for (let j = 0; j < V; j++) {
      const x = a * secX[j], y = b * secY[j];
      const n = x * cp - y * sp;
      const w = x * sp + y * cp;
      const k = (i * V + j) * 3;
      ringPos[k] = curvePts[ic] + nx * n + bx * w;
      ringPos[k + 1] = curvePts[ic + 1] + ny * n + by * w;
      ringPos[k + 2] = curvePts[ic + 2] + bz * w;
    }
  }

  const wanted = P.twist ? indexTwist : indexFlat;
  if (wanted !== currentIndex) { ringGeo.setIndex(wanted); currentIndex = wanted; }
  ringGeo.attributes.position.needsUpdate = true;
  ringGeo.computeVertexNormals();
}

/* ───────────── Gotas do respingo ───────────── */

const DROPS = 72;
const rand = mulberry32(7);
const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), glass, DROPS);
drops.frustumCulled = false;
spinG.add(drops);

const dropSeeds = Array.from({ length: DROPS }, () => {
  const th = rand() * TAU;
  const el = (rand() - 0.5) * Math.PI;
  const az = rand() * TAU;
  return {
    th,
    dir: [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)],
    dist: 0.16 + rand() * 0.6,
    size: 0.016 + Math.pow(rand(), 2.4) * 0.07,
    d1: rand() * 0.14,
    d2: rand() * 0.2,
    w: (rand() - 0.5) * 2,
    ph: rand() * TAU,
  };
});

const dummy = new THREE.Object3D();
const tmp3 = [0, 0, 0];

function updateDrops(m, flow) {
  const spread = Math.pow(Math.sin(Math.PI * span(m, 0.05, 0.98)), 0.7);
  for (let i = 0; i < DROPS; i++) {
    const d = dropSeeds[i];
    curveAt(d.th + d.w * 0.5 * flow, tmp3);
    const env = smooth(span(m, 0.08 + d.d1, 0.3 + d.d1)) * (1 - smooth(span(m, 0.6 + d.d2, 0.97)));
    const wob = 0.05 * Math.sin(P.t * 2.1 + d.ph) * spread;
    const k = d.dist * spread;
    dummy.position.set(
      tmp3[0] + d.dir[0] * k + wob,
      tmp3[1] + d.dir[1] * k - wob,
      tmp3[2] + d.dir[2] * k + wob,
    );
    dummy.scale.setScalar(Math.max(1e-4, d.size * env));
    dummy.updateMatrix();
    drops.setMatrixAt(i, dummy.matrix);
  }
  drops.instanceMatrix.needsUpdate = true;
}

/* ───────────── Esferas em órbita ───────────── */

const REST_TILT = -1.32;                  // poça deitada, vista um pouco de cima
const FINAL_TILT = [-0.5, 0.3, -0.16];    // anel de frente, levemente inclinado

// `rest` = posição no plano da poça; depois cada esfera entra numa órbita
// inclinada em volta do anel, passando pela frente e por trás dele.
const orbiters = [
  { rest: [-1.9, 0.45, 0.05], rho: 1.62, inc: 0.36, node: 0.16, a0: 0.6, w: 0.2, size: 0.085, restSize: 0.05 },
  { rest: [1.82, -0.2, 0.05], rho: 1.8, inc: -0.28, node: -0.2, a0: 3.5, w: -0.15, size: 0.068, restSize: 0.042 },
  { rest: [-1.72, -0.72, 0.06], rho: 1.5, inc: 0.5, node: -0.1, a0: 5.0, w: 0.25, size: 0.092, restSize: 0.06 },
].map((o) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), chrome);
  root.add(mesh);
  const c = Math.cos(REST_TILT), sn = Math.sin(REST_TILT);
  const rest = [o.rest[0], o.rest[1] * c - o.rest[2] * sn, o.rest[1] * sn + o.rest[2] * c];
  return { ...o, rest, mesh };
});

function updateOrbiters(m, t) {
  const e = easeIO(span(m, 0.16, 0.96));
  for (const o of orbiters) {
    const a = o.a0 + o.w * t;
    const x0 = o.rho * Math.cos(a);
    const y0 = o.rho * Math.sin(a) * Math.sin(o.inc);
    const z0 = o.rho * Math.sin(a) * Math.cos(o.inc);
    const cn = Math.cos(o.node), sn = Math.sin(o.node);
    o.mesh.position.set(
      lerp(o.rest[0], x0 * cn - y0 * sn, e),
      lerp(o.rest[1], x0 * sn + y0 * cn, e) + Math.sin(Math.PI * e) * 0.25,
      lerp(o.rest[2], z0, e),
    );
    o.mesh.scale.setScalar(lerp(o.restSize, o.size, e));
  }
}

/* ───────────── Brilho e cáusticas no chão ───────────── */

const glowMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uMix: { value: 0 },
    uDeep: { value: new THREE.Color('#7a3cff') },
    uPale: { value: new THREE.Color('#f3ebff') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform float uTime;
    uniform float uMix;
    uniform vec3 uDeep;
    uniform vec3 uPale;

    ${CAUSTIC_GLSL}
    float puddleR(float u) {
      return 1.22 * (1.0 + 0.2 * cos(2.0 * u + 0.3) + 0.085 * sin(3.0 * u + 2.1) + 0.05 * sin(5.0 * u + 4.2 + uTime * 0.7));
    }

    void main() {
      vec2 p = (vUv - 0.5) * 6.0;
      float r = length(p);
      float ang = atan(p.y, p.x);
      float c = caustic(p * 1.6, uTime * 0.9);

      float rb = puddleR(ang);
      float maskA = 1.0 - smoothstep(0.74 * rb, 0.95 * rb, r);
      float maskC = pow(1.0 - smoothstep(0.0, 1.75, length(p * vec2(0.9, 1.0))), 2.0);

      // sombra violeta mais densa perto da borda da poça
      float rim = smoothstep(0.25 * rb, 0.9 * rb, r);
      float alphaA = maskA * (0.1 + 0.42 * rim + 0.6 * c);
      float alphaC = maskC * (0.5 + 0.4 * c);
      float alpha = mix(alphaA, alphaC, uMix);

      vec3 col = mix(uDeep, uPale, c * mix(0.92, 0.7, uMix));
      gl_FragColor = vec4(col, alpha);
      #include <colorspace_fragment>
    }
  `,
  // fica na lista "opaca" (para aparecer através do vidro), mas mistura com alpha
  ...OVERLAY_BLEND,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});
const glow = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), glowMat);
glow.renderOrder = -9;
floor.add(glow);

/* ───────────── Título na cena 3D ───────────── */

const textGroup = new THREE.Group();
scene.add(textGroup);
let textItems = []; // { mesh, baseX, dxWorld, dxPx, el }

const L = { W: 1, H: 1, s: 1, fs: 100, S: 1, A: [0, 0], C: [0, 0] };

function toWorld(x, y) {
  return [(x - L.W / 2) * L.s, (L.H / 2 - y) * L.s];
}

function makeTextMesh(text, font, fs, ls, w, h) {
  const pad = Math.ceil(fs * 0.22);
  const cw = w + pad * 2, ch = h + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(cw * pixelRatio);
  cv.height = Math.ceil(ch * pixelRatio);
  const ctx = cv.getContext('2d');
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${ls}px`;
  ctx.textBaseline = 'alphabetic';
  const mt = ctx.measureText(text);
  const asc = mt.fontBoundingBoxAscent, desc = mt.fontBoundingBoxDescent;
  ctx.fillStyle = INK;
  ctx.fillText(text, pad, pad + (h - (asc + desc)) / 2 + asc);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;

  // Preto sobre branco com mistura "mínimo": o branco some, o preto fica,
  // e peças vizinhas podem se sobrepor sem recortar uma à outra.
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MinEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation, // mantém o alfa do canvas em 1
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(cw * L.s, ch * L.s), mat);
  mesh.renderOrder = -10;
  return mesh;
}

function layout() {
  const W = hero.clientWidth, H = hero.clientHeight;
  L.W = W; L.H = H;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  L.s = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / H;

  // medidas do título em HTML (sem as translações da animação)
  pieceEls.forEach((el) => { el.style.transform = ''; });
  const hr = hero.getBoundingClientRect();
  const cs = getComputedStyle(headline);
  const hs = getComputedStyle(hero);
  const fs = parseFloat(cs.fontSize);
  const ls = parseFloat(cs.letterSpacing) || 0;
  const font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
  const left = parseFloat(hs.paddingLeft), right = W - parseFloat(hs.paddingRight);
  L.fs = fs;

  const rects = pieceEls.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
  });
  const [ideias, fora, de, or, bita] = rects;

  // posição final: linhas abertas até as margens, "ór" e "bita." separados
  const dx = [0, 0, 0, 0, 0];
  dx[0] = Math.min(0, left - ideias.x);
  dx[1] = Math.max(0, right - (fora.x + fora.w) - ls);
  dx[2] = Math.min(0, left - de.x);
  dx[4] = Math.max(0, right - (bita.x + bita.w) - ls);
  const deRight = de.x + dx[2] + de.w;
  const bitaLeft = bita.x + dx[4];
  // "ór" termina centralizado no vão do anel
  const ringX = W * RING_X;
  let orX = ringX - (or.w + ls) / 2;
  orX = Math.min(orX, bitaLeft - or.w - fs * 0.1);
  orX = Math.max(orX, deRight + fs * 0.14);
  dx[3] = orX - or.x;

  for (const it of textItems) {
    textGroup.remove(it.mesh);
    it.mesh.material.map.dispose();
    it.mesh.material.dispose();
    it.mesh.geometry.dispose();
  }
  textItems = pieceEls.map((el, i) => {
    const r = rects[i];
    const mesh = makeTextMesh(el.textContent, font, fs, ls, r.w, r.h);
    const [x, y] = toWorld(r.x + r.w / 2, r.y + r.h / 2);
    mesh.position.set(x, y, 0);
    textGroup.add(mesh);
    return { mesh, el, baseX: x, dxPx: dx[i], dxWorld: dx[i] * L.s };
  });

  // palco: onde a poça descansa e onde o anel termina
  const hl = headline.getBoundingClientRect();
  const portrait = H > W;
  L.S = fs * L.s * (portrait ? 1.5 : 1.0);
  const floorY = Math.min(hl.bottom - hr.top + fs * 0.26, H - fs * 0.6);
  L.A = toWorld(W * 0.48, floorY);
  L.C = toWorld(ringX, (hl.top + hl.bottom) / 2 - hr.top + fs * 0.24);

  root.scale.setScalar(L.S);
  floor.position.set(L.A[0], L.A[1], 0);
  floor.rotation.x = REST_TILT;
  floor.scale.setScalar(L.S);

  lastTextE = -1;
}

/* ───────────── Animação ───────────── */

let clock = 0;
let last = performance.now() / 1000;
let spin = 0;
let flow = 0;
let settled = false;
let visible = true;
let lastTextE = -1;
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

function frame(nowMs) {
  requestAnimationFrame(frame);
  step(nowMs);
}

function step(nowMs) {
  const now = nowMs / 1000;
  const dt = Math.min(0.05, Math.max(0, now - last));
  last = now;
  if (!visible || document.hidden) return;
  clock += dt;

  const p = FROZEN !== null ? FROZEN : reduceMotion ? 1 : clamp01((clock - HOLD) / DURATION);
  if (FROZEN !== null) settled = false;
  const m = easeSine(p);
  setParams(m, clock);

  // geometria líquida: só enquanto ainda está se transformando
  if (!settled) {
    updateRing();
    updateDrops(m, flow);
    settled = m >= 1;
  }
  flow += dt * P.turb;
  spin += dt * (0.1 * P.eR + 1.5 * P.turb);
  spinG.rotation.z = spin;

  // água → vidro violeta
  glass.ior = lerp(1.33, 1.52, m);
  glass.thickness = lerp(0.25, 0.7, m);
  glass.attenuationDistance = lerp(2.4, 1.15, m);
  glass.attenuationColor.copy(WATER_TINT).lerp(GLASS_TINT, m);
  glass.iridescence = lerp(0.2, 0.85, m);
  glass.clearcoat = smooth(span(m, 0.1, 0.8));
  glass.envMapIntensity = lerp(0.7, 1.55, smooth(span(m, 0.05, 0.6)));

  // sobe do chão e se inclina
  const eLift = easeIO(span(m, 0.1, 0.9));
  const eTilt = easeIO(span(m, 0.08, 0.94));
  pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
  pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);
  const scrollK = clamp01(window.scrollY / Math.max(1, L.H));
  const idle = eTilt * (reduceMotion ? 0 : 1);

  root.position.set(
    lerp(L.A[0], L.C[0], eLift),
    lerp(L.A[1], L.C[1], eLift) + Math.sin(clock * 0.9) * 0.03 * L.S * idle,
    0,
  );
  tilt.rotation.set(
    lerp(REST_TILT, FINAL_TILT[0], eTilt) + (pointer.y * 0.14 + Math.sin(clock * 0.5) * 0.04 - scrollK * 0.6) * idle,
    lerp(0, FINAL_TILT[1], eTilt) + (pointer.x * 0.2 + Math.cos(clock * 0.4) * 0.05) * idle,
    lerp(0, FINAL_TILT[2], eTilt),
  );

  updateOrbiters(m, clock);

  glowMat.uniforms.uTime.value = clock;
  glowMat.uniforms.uMix.value = smooth(span(m, 0.02, 0.4));

  // letras se afastando
  const eText = easeIO(span(p, 0.14, 0.76));
  if (eText !== lastTextE) {
    lastTextE = eText;
    for (const it of textItems) {
      it.mesh.position.x = it.baseX + it.dxWorld * eText;
      it.el.style.transform = `translate3d(${(it.dxPx * eText).toFixed(2)}px,0,0)`;
    }
  }

  renderer.render(scene, camera);
}

function restart() {
  clock = 0;
  spin = 0;
  flow = 0;
  settled = false;
  lastTextE = -1;
}

/* ───────────── Eventos ───────────── */

window.addEventListener('pointermove', (e) => {
  pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
}, { passive: true });

new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(hero);

let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { layout(); settled = false; }, 120);
}).observe(hero);

// clicar no logo (já no topo) repete a animação
document.querySelector('.logo').addEventListener('click', () => {
  if (reduceMotion || window.scrollY > 40) return;
  canvas.style.opacity = '0';
  setTimeout(() => { restart(); canvas.style.opacity = '1'; }, 360);
});

/* ───────────── Início ───────────── */

async function start() {
  try {
    const cs = getComputedStyle(headline);
    await Promise.race([
      Promise.all([document.fonts.load(`${cs.fontWeight} 100px ${cs.fontFamily}`, 'Ideias fora de órbita.'), document.fonts.ready]),
      new Promise((res) => setTimeout(res, 2500)),
    ]);
  } catch { /* segue com a fonte de reserva */ }

  layout();
  if (FROZEN !== null) window.__orbita = { THREE, renderer, scene, camera, glass, chrome, glowMat, L, step, setP(v) { FROZEN = v; }, get textItems() { return textItems; } };
  doc.classList.add('webgl-on');
  last = performance.now() / 1000;
  requestAnimationFrame((t) => {
    frame(t);
    doc.classList.add('is-ready');
  });
}

start();
