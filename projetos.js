import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  TAU, BG_HEX, clamp01, lerp, span, smooth, mulberry32,
  makeEnvironment, makeGlass, makeChrome, CAUSTIC_GLSL, OVERLAY_BLEND,
} from './shared.js';

/* ─────────────────────────────────────────────────────────────
   Orbita — Projetos
   Uma superfície de água violeta de onde sobem três objetos de
   vidro e cromo (planeta, cubo e infinito), um sobre cada projeto.
   ───────────────────────────────────────────────────────────── */

const doc = document.documentElement;
const section = document.querySelector('.showcase');
const canvas = section.querySelector('.showcase__canvas');
const stage = section.querySelector('.showcase__stage');
const projectEls = [...section.querySelectorAll('.project')];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ?t=6 congela o relógio num instante (em segundos) para ajustes
const frozenParam = new URLSearchParams(location.search).get('t');
const FROZEN = frozenParam === null ? null : Math.max(0, parseFloat(frozenParam) || 0);

const RISE_START = 0.5;   // primeiro objeto começa a subir
const RISE_GAP = 0.45;    // intervalo entre objetos
const RISE_DUR = 2.5;     // duração da subida
const Z_FAR = -7;         // fundo da superfície d'água
const Z_NEAR = 6;         // frente (sai da tela por baixo)

/* ───────────── Renderer ───────────── */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  doc.classList.add('is-ready');
  throw err;
}

const BG = new THREE.Color(BG_HEX);
const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setClearColor(BG, 1);
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
scene.background = BG;

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);
camera.position.set(0, 0, 10);

const envMap = makeEnvironment(renderer);

/* ───────────── Materiais ───────────── */

const glass = makeGlass(envMap, {
  ior: 1.5,
  thickness: 1.1,
  attenuationColor: new THREE.Color('#9a5cff'),
  attenuationDistance: 1.5,
  iridescence: 0.75,
  envMapIntensity: 1.5,
});
const dropGlass = makeGlass(envMap, {
  ior: 1.33,
  thickness: 0.15,
  attenuationDistance: 2.4,
  iridescence: 0.3,
  envMapIntensity: 1.3,
});
const chrome = makeChrome(envMap, { envMapIntensity: 1.25 });

/* ───────────── Varredura de um perfil ao longo de uma curva ───────────── */

// frames[i] = { p, a, b }: ponto e dois eixos do perfil; profile = [[x, y], ...] fechado
function sweep(frames, profile) {
  const n = frames.length, m = profile.length;
  const pos = new Float32Array(n * m * 3);
  for (let i = 0; i < n; i++) {
    const { p, a, b } = frames[i];
    for (let j = 0; j < m; j++) {
      const [x, y] = profile[j];
      const k = (i * m + j) * 3;
      pos[k] = p.x + a.x * x + b.x * y;
      pos[k + 1] = p.y + a.y * x + b.y * y;
      pos[k + 2] = p.z + a.z * x + b.z * y;
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const A = i * m + j, B = i * m + j2, C = i2 * m + j, D = i2 * m + j2;
      idx.push(A, C, B, B, C, D);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function roundedRect(w, h, r, seg = 4) {
  const pts = [];
  const cx = w / 2 - r, cy = h / 2 - r;
  [[cx, cy, 0], [-cx, cy, 1], [-cx, -cy, 2], [cx, -cy, 3]].forEach(([x, y, q]) => {
    for (let s = 0; s <= seg; s++) {
      const a = (q + s / seg) * (Math.PI / 2);
      pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
    }
  });
  return pts;
}

/* ───────────── Objeto 1: planeta de vidro com anel cromado ───────────── */

function makePlanet() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.74, 72, 48), glass);
  g.add(body);

  const tilt = new THREE.Group();
  tilt.rotation.set(1.22, 0.32, 0);
  g.add(tilt);

  // anel achatado (perfil de fita arredondada)
  const N = 240;
  const prof = roundedRect(0.2, 0.034, 0.016);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const u = (i / N) * TAU;
    const p = new THREE.Vector3(Math.cos(u) * 1.12, Math.sin(u) * 1.12, 0);
    frames.push({ p, a: new THREE.Vector3(Math.cos(u), Math.sin(u), 0), b: new THREE.Vector3(0, 0, 1) });
  }
  const ring = new THREE.Mesh(sweep(frames, prof), chrome);
  tilt.add(ring);

  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 20), chrome);
  tilt.add(moon);

  return {
    group: g,
    update(t) {
      body.rotation.y = t * 0.3;
      tilt.rotation.z = t * 0.18;
      const a = t * 0.7;
      moon.position.set(Math.cos(a) * 1.12, Math.sin(a) * 1.12, 0.07);
    },
  };
}

/* ───────────── Objeto 2: cubo de vidro com fita cromada ───────────── */

function makeCube() {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  spin.rotation.set(0.62, 0.78, 0.08);
  g.add(spin);

  const h = 0.54;
  spin.add(new THREE.Mesh(new RoundedBoxGeometry(2 * h, 2 * h, 2 * h, 6, 0.15), glass));

  // fita no corte hexagonal (plano perpendicular à diagonal): passa pelas seis faces
  const corners = [
    [h, 0, -h], [h, -h, 0], [0, -h, h], [-h, 0, h], [-h, h, 0], [0, h, -h],
  ].map((c) => new THREE.Vector3(...c));
  const ctrl = [];
  for (let i = 0; i < 6; i++) {
    const a = corners[i], b = corners[(i + 1) % 6];
    ctrl.push(a.clone().lerp(b, 0.2), a.clone().lerp(b, 0.8));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
  const n = new THREE.Vector3(1, 1, 1).normalize();
  const N = 300;
  const frames = [];
  for (let i = 0; i < N; i++) {
    const u = i / N;
    const p = curve.getPointAt(u);
    const o = p.clone().normalize();
    // leve ondulação: a fita parece solta, não colada
    const wave = 0.035 * Math.sin(u * TAU * 3);
    p.addScaledVector(o, 0.045 + Math.max(0, wave));
    const w = n.clone().addScaledVector(o, -n.dot(o)).normalize();
    p.addScaledVector(w, 0.05 * Math.sin(u * TAU * 2 + 1));
    frames.push({ p, a: w, b: o });
  }
  spin.add(new THREE.Mesh(sweep(frames, roundedRect(0.24, 0.028, 0.013)), chrome));

  return {
    group: g,
    update(t) {
      spin.rotation.y = 0.78 + t * 0.32;
      spin.rotation.x = 0.62 + Math.sin(t * 0.5) * 0.12;
    },
  };
}

/* ───────────── Objeto 3: infinito de vidro e cromo ───────────── */

class Lemniscate extends THREE.Curve {
  getPoint(u, out = new THREE.Vector3()) {
    const t = u * TAU;
    const s = Math.sin(t), c = Math.cos(t);
    const k = 1 / (1 + s * s);
    return out.set(1.12 * c * k, 1.12 * s * c * k * 1.15, 0.24 * s);
  }
}

function makeInfinity() {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);

  const curve = new Lemniscate();
  spin.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 320, 0.2, 40, true), glass));

  // fio cromado enrolado em volta do tubo de vidro
  const N = 900, TURNS = 11;
  const fr = curve.computeFrenetFrames(N, true);
  const pts = [];
  for (let i = 0; i < N; i++) {
    const u = i / N;
    const p = curve.getPointAt(u);
    const a = u * TAU * TURNS;
    p.addScaledVector(fr.normals[i], Math.cos(a) * 0.215).addScaledVector(fr.binormals[i], Math.sin(a) * 0.215);
    pts.push(p);
  }
  const helix = new THREE.CatmullRomCurve3(pts, true);
  spin.add(new THREE.Mesh(new THREE.TubeGeometry(helix, 1800, 0.026, 10, true), chrome));

  return {
    group: g,
    update(t) {
      spin.rotation.y = Math.sin(t * 0.45) * 0.55;
      spin.rotation.x = 0.35 + Math.sin(t * 0.33) * 0.12;
      spin.rotation.z = Math.sin(t * 0.27) * 0.08;
    },
  };
}

const objects = [makePlanet(), makeCube(), makeInfinity()].map((o, i) => {
  scene.add(o.group);
  return { ...o, i, x: 0, y: 0, lift: 0, liftTarget: 0, t0: RISE_START + i * RISE_GAP, tSplash: 0, tRipple: 0 };
});

/* ───────────── Água ───────────── */

const waterUniforms = {
  uTime: { value: 0 },
  uR: { value: 1 },
  uSrc: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  uOn: { value: new THREE.Vector3() },
  uFade: { value: new THREE.Vector2(0, 1) },
  uRes: { value: new THREE.Vector2(1, 1) },
  uZFar: { value: Z_FAR },
  uDeep: { value: new THREE.Color('#3d0fd6') },
  uMid: { value: new THREE.Color('#7b45ff') },
  uPale: { value: new THREE.Color('#efe6ff') },
  uBg: { value: BG.clone() },
};

const waterMat = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uR;
    uniform vec3 uSrc[3];   // x, z, início da onda
    varying vec3 vW;

    float height(vec2 p) {
      vec2 q = p / uR;
      float h = 0.035 * sin(q.x * 0.9 + uTime * 0.8)
              + 0.025 * sin(q.y * 1.7 - uTime * 1.1 + q.x * 0.4)
              + 0.012 * sin((q.x + q.y) * 2.6 + uTime * 1.6);
      for (int i = 0; i < 3; i++) {
        float r = length(q - uSrc[i].xy / uR);
        float age = uTime - uSrc[i].z;
        if (age > 0.0) {
          float front = 0.5 + age * 1.7;
          h += 0.17 * sin(r * 5.0 - age * 6.5) * exp(-age * 0.55) * smoothstep(front, front - 1.4, r) * exp(-r * 0.3);
          h += 0.02 * sin(r * 6.0 - uTime * 3.0 + float(i) * 2.0) * exp(-r * 0.7) * smoothstep(0.0, 2.0, age);
        }
      }
      return h * uR;
    }

    void main() {
      vec3 p = position;
      p.y += height(p.xz);
      vec4 w = modelMatrix * vec4(p, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uR;
    uniform vec3 uSrc[3];
    uniform vec3 uOn;
    uniform vec2 uFade;
    uniform vec2 uRes;
    uniform float uZFar;
    uniform vec3 uDeep;
    uniform vec3 uMid;
    uniform vec3 uPale;
    uniform vec3 uBg;
    varying vec3 vW;

    ${CAUSTIC_GLSL}

    void main() {
      vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
      if (n.y < 0.0) n = -n;
      vec3 V = normalize(cameraPosition - vW);
      float ndv = max(dot(n, V), 0.0);
      float fres = pow(1.0 - ndv, 4.0);

      vec2 q = vW.xz / uR;
      float c = caustic(q * vec2(0.9, 1.6) + n.xz * 3.0, uTime * 0.8);

      // profundidade: mais escuro perto, mais claro ao fundo
      float far = smoothstep(2.0, uZFar, vW.z);
      vec3 col = mix(uDeep, uMid, 0.15 + 0.6 * far);
      col = mix(col, uPale, c * 0.42);

      // luz concentrada embaixo de cada objeto (cáustica do vidro)
      float g = 0.0;
      g += uOn.x * exp(-dot(q - uSrc[0].xy / uR, q - uSrc[0].xy / uR) * 0.9);
      g += uOn.y * exp(-dot(q - uSrc[1].xy / uR, q - uSrc[1].xy / uR) * 0.9);
      g += uOn.z * exp(-dot(q - uSrc[2].xy / uR, q - uSrc[2].xy / uR) * 0.9);
      col += uPale * g * (0.25 + 0.6 * c);

      // reflexo do céu claro no ângulo rasante + brilho especular
      col = mix(col, uPale, clamp(fres * 0.45, 0.0, 0.5));
      vec3 L = normalize(vec3(-0.35, 1.0, -0.9));
      float spec = pow(max(dot(reflect(-L, n), V), 0.0), 90.0);
      col += vec3(1.0) * spec * 0.9;

      // bordas: dissolve no fundo
      vec2 sc = gl_FragCoord.xy / uRes;
      float side = smoothstep(0.0, 0.07, sc.x) * smoothstep(1.0, 0.93, sc.x);
      float back = smoothstep(uZFar, uZFar + 6.0, vW.z);
      back *= back;
      float bottom = smoothstep(uFade.x, uFade.y, gl_FragCoord.y);
      float alpha = side * back * bottom;
      col = mix(uBg, col, smoothstep(0.0, 0.6, back));

      gl_FragColor = vec4(col, alpha);
      #include <colorspace_fragment>
    }
  `,
  ...OVERLAY_BLEND,
  depthWrite: true,
  toneMapped: false,
  extensions: { derivatives: true },
});

const water = new THREE.Mesh(new THREE.BufferGeometry(), waterMat);
water.renderOrder = -5;
water.frustumCulled = false;
scene.add(water);

/* ───────────── Gotas ───────────── */

const SPLASH = 16;     // por objeto
const FLOAT = 7;       // gotas suspensas por objeto
const rand = mulberry32(11);
const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), dropGlass, 3 * (SPLASH + FLOAT));
drops.frustumCulled = false;
scene.add(drops);

const splashSeeds = Array.from({ length: 3 * SPLASH }, () => ({
  a: rand() * TAU,
  h: 0.5 + rand() * 1.3,
  v: 2.0 + rand() * 1.8,
  r0: 0.55 + rand() * 0.35,
  size: 0.025 + Math.pow(rand(), 2) * 0.07,
  delay: rand() * 0.25,
}));
const floatSeeds = Array.from({ length: 3 * FLOAT }, () => ({
  a: rand() * TAU,
  rho: 1.25 + rand() * 0.55,
  y: (rand() - 0.3) * 1.3,
  w: (0.12 + rand() * 0.2) * (rand() < 0.5 ? -1 : 1),
  size: 0.02 + Math.pow(rand(), 2) * 0.055,
  ph: rand() * TAU,
}));

const dummy = new THREE.Object3D();
const G = -7; // gravidade, em raios por segundo²

function updateDrops(t) {
  let k = 0;
  for (const o of objects) {
    for (let j = 0; j < SPLASH; j++) {
      const s = splashSeeds[o.i * SPLASH + j];
      const tau = t - o.tSplash - s.delay;
      const y = s.v * tau + 0.5 * G * tau * tau;
      const on = tau > 0 && y > -0.05;
      const rr = s.r0 + s.h * Math.max(0, tau);
      dummy.position.set(
        o.x + Math.cos(s.a) * rr * L.R,
        L.Yw + y * L.R,
        Math.sin(s.a) * rr * L.R * 0.7,
      );
      dummy.scale.setScalar(on ? s.size * L.R * smooth(clamp01(tau * 6)) : 1e-5);
      dummy.updateMatrix();
      drops.setMatrixAt(k++, dummy.matrix);
    }
    const appear = smooth(span(t, o.t0 + RISE_DUR * 0.6, o.t0 + RISE_DUR + 0.8));
    for (let j = 0; j < FLOAT; j++) {
      const s = floatSeeds[o.i * FLOAT + j];
      const a = s.a + s.w * t;
      dummy.position.set(
        o.x + Math.cos(a) * s.rho * L.R,
        o.yNow + (s.y + 0.08 * Math.sin(t * 1.1 + s.ph)) * L.R,
        Math.sin(a) * s.rho * L.R * 0.8,
      );
      dummy.scale.setScalar(Math.max(1e-5, s.size * L.R * appear));
      dummy.updateMatrix();
      drops.setMatrixAt(k++, dummy.matrix);
    }
  }
  drops.instanceMatrix.needsUpdate = true;
}

/* ───────────── Layout ───────────── */

const L = { W: 1, H: 1, s: 1, yH: 0, R: 1, Yw: 0 };

function toWorldY(y) { return (L.yH - y) * L.s; }

// subida com um leve repique no fim
function riseEase(x) {
  const c = 1.45;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
}
// instante em que o centro do objeto passa por uma altura relativa (0 = fundo, 1 = repouso)
function timeAt(frac) {
  let a = 0, b = 1;
  for (let k = 0; k < 30; k++) {
    const m = (a + b) / 2;
    if (riseEase(m) < frac) a = m; else b = m;
  }
  return a * RISE_DUR;
}

function layout() {
  const W = section.clientWidth, H = section.clientHeight;
  L.W = W; L.H = H;
  renderer.setSize(W, H, false);

  const secR = section.getBoundingClientRect();
  const st = stage.getBoundingClientRect();
  const top = st.top - secR.top, sh = st.height;

  // horizonte no topo do palco: a câmera "olha" a água de cima
  L.yH = top + sh * 0.02;
  const Hf = 2 * Math.max(L.yH, H - L.yH);
  camera.aspect = W / Hf;
  camera.setViewOffset(W, Hf, 0, Hf / 2 - L.yH, W, H);
  camera.updateProjectionMatrix();
  L.s = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Hf;

  // colunas: centro de cada projeto (ou distribuídas, no celular)
  const rects = projectEls.map((el) => el.getBoundingClientRect());
  const inRow = rects.length === 3 && Math.abs(rects[0].top - rects[2].top) < 4;
  const xs = inRow ? rects.map((r) => r.left - secR.left + r.width / 2) : [0.19, 0.5, 0.81].map((f) => f * W);
  const colW = inRow ? rects[0].width : W / 3;

  const Rpx = Math.min(sh * 0.3, colW * (inRow ? 0.27 : 0.36));
  L.R = Rpx * L.s;
  const waterY = top + sh * 0.8;
  const objY = Math.min(top + sh * 0.44, waterY - Rpx * 1.62);
  L.Yw = toWorldY(waterY);

  objects.forEach((o, i) => {
    o.x = (xs[i] - W / 2) * L.s;
    o.y = toWorldY(objY);
    o.group.scale.setScalar(L.R * (i === 2 ? 0.95 : 1));
    // a onda nasce quando o topo rompe a superfície; o respingo, logo depois
    const y0 = L.Yw - 1.7 * L.R;
    const frac = (L.Yw - 0.9 * L.R - y0) / (o.y - y0);
    o.tRipple = o.t0 + timeAt(clamp01(frac));
    o.tSplash = o.t0 + timeAt(clamp01((L.Yw - 0.2 * L.R - y0) / (o.y - y0)));
    waterUniforms.uSrc.value[i].set(o.x, 0, o.tRipple);
  });

  // superfície: plano horizontal na altura da linha d'água
  const halfW = (10 - Z_FAR) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (W / Hf) * 1.05;
  const geo = new THREE.PlaneGeometry(2 * halfW, Z_NEAR - Z_FAR, 280, 140);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, (Z_NEAR + Z_FAR) / 2);
  water.geometry.dispose();
  water.geometry = geo;
  water.position.y = L.Yw;

  waterUniforms.uR.value = L.R;
  waterUniforms.uRes.value.set(W * pixelRatio, H * pixelRatio);
  const stBottom = H - (top + sh);
  waterUniforms.uFade.value.set(stBottom * pixelRatio, (stBottom + sh * 0.1) * pixelRatio);
}

/* ───────────── Animação ───────────── */

let clock = 0;
let last = performance.now() / 1000;
let visible = true;
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

let frozenFrames = 0;
function frame(nowMs) {
  // congelado: alguns quadros bastam (deixa a captura de tela leve)
  if (FROZEN === null || ++frozenFrames < 4) requestAnimationFrame(frame);
  step(nowMs);
}

function step(nowMs) {
  const now = nowMs / 1000;
  const dt = Math.min(0.05, Math.max(0, now - last));
  last = now;
  if (!visible || document.hidden) return;
  clock += dt;
  const t = FROZEN !== null ? FROZEN : reduceMotion ? 60 : clock;

  pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
  pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);

  for (const o of objects) {
    const x = clamp01((t - o.t0) / RISE_DUR);
    const y0 = L.Yw - 1.7 * L.R;
    o.lift += (o.liftTarget - o.lift) * Math.min(1, dt * 5);
    const settledK = smooth(span(t, o.t0 + RISE_DUR * 0.7, o.t0 + RISE_DUR + 1));
    o.yNow = lerp(y0, o.y, riseEase(x))
      + settledK * (Math.sin(t * 0.9 + o.i * 2.1) * 0.05 + o.lift * 0.12) * L.R;
    o.group.position.set(o.x, o.yNow, 0);
    o.group.rotation.set(
      pointer.y * 0.18 + (1 - x) * 0.5,
      pointer.x * 0.3 + (1 - smooth(x)) * -1.2 + o.lift * 0.4,
      0,
    );
    o.update(t + o.i * 3 + o.lift * 0.5);
  }

  updateDrops(t);

  waterUniforms.uTime.value = t;
  waterUniforms.uOn.value.set(
    ...objects.map((o) => smooth(span(t, o.tRipple, o.tRipple + 1.6))),
  );

  renderer.render(scene, camera);
}

/* ───────────── Eventos ───────────── */

window.addEventListener('pointermove', (e) => {
  pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
}, { passive: true });

projectEls.forEach((el, i) => {
  const on = () => { objects[i].liftTarget = 1; };
  const off = () => { objects[i].liftTarget = 0; };
  el.addEventListener('pointerenter', on);
  el.addEventListener('pointerleave', off);
  el.addEventListener('focus', on);
  el.addEventListener('blur', off);
});

new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(section);

let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layout, 120);
}).observe(section);

/* ───────────── Início ───────────── */

async function start() {
  try {
    await Promise.race([document.fonts.ready, new Promise((res) => setTimeout(res, 2500))]);
  } catch { /* segue */ }
  layout();
  if (FROZEN !== null) window.__orbita = { THREE, renderer, scene, camera, objects, L, waterUniforms };
  last = performance.now() / 1000;
  requestAnimationFrame((t) => {
    frame(t);
    doc.classList.add('is-ready');
  });
}

start();
