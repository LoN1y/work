import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import ak47Icon from '../icons/ak47.png';
import m4a4Icon from '../icons/m4a4.png';
import uspIcon from '../icons/usp.png';
import awpIcon from '../icons/awp.png';
import awpGlbUri from './awpModel.js';
import m4a4GlbUri from './m4a4Model.js';
import ak47GlbUri from './ak47Model.js';
import uspGlbUri from './uspModel.js';

/* ============================================================
   AIM//RANGE — CS:GO 风格第一人称射击训练场
   纯程序化几何 + Web Audio 合成音效，无外部素材依赖
   ============================================================ */

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------------- GLB 模型加载（poly.pizza / Quaternius, CC0） ---------------- */
function dataUriToArrayBuffer(uri) {
  const bin = atob(uri.split(',')[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function loadGlb(uri) {
  const gltf = await new GLTFLoader().parseAsync(dataUriToArrayBuffer(uri), '');
  return gltf.scene;
}
let glbAwp = null, glbM4 = null, glbAk = null, glbUsp = null;
try {
  [glbAwp, glbM4, glbAk, glbUsp] = await Promise.all([
    loadGlb(awpGlbUri), loadGlb(m4a4GlbUri), loadGlb(ak47GlbUri), loadGlb(uspGlbUri)
  ]);
} catch (e) {
  console.warn('GLB 加载失败，使用程序化模型兜底', e);
}

// GLB 模型归一化：量取原始包围盒，等比缩放到目标长度，并把中心/朝向调整到
// 视图模型坐标系（枪口朝 -Z、枪身水平），避免依赖模型自带的单位与轴向。
function buildFromGlb(template, targetLength, rotY, offsetY = 0, rotX = 0) {
  const g = new THREE.Group();
  if (!template) return g;
  const model = template.clone(true);
  model.rotation.set(rotX, rotY, 0, 'YXZ');
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // 旋转后最长轴为枪管方向（Z），按它归一化
  const longest = Math.max(size.x, size.y, size.z);
  const scale = targetLength / longest;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  const center2 = box2.getCenter(new THREE.Vector3());
  // 平移：模型的中心对齐原点，再上移 offsetY
  model.position.set(-center2.x, -center2.y + offsetY, -center2.z);
  model.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone();
      o.material.envMapIntensity = 0.7;
      o.material.roughness = Math.min(1, (o.material.roughness ?? 0.5) + 0.15);
    }
  });
  g.add(model);
  g.userData.model = model;
  g.userData.normalized = { scale, size: size.toArray(), center: center.toArray() };
  // 枪口坐标：取归一化后最靠 -Z 端顶点的平均位置（枪管/消音器中心）。
  // 模型自带单位与枪管高度各异，不能沿用程序化模型的 weapon.muzzle。
  model.updateMatrixWorld(true);
  // 注意：box2 是平移前的包围盒，顶点已按 -center2 平移，必须重新量取
  const box3 = new THREE.Box3().setFromObject(model);
  const muzzleZ = box3.min.z;
  const frontZ = muzzleZ + (box3.max.z - muzzleZ) * 0.08;
  const vTmp = new THREE.Vector3();
  let sumX = 0, sumY = 0, cnt = 0;
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const attr = o.geometry.getAttribute('position');
    if (!attr) return;
    for (let i = 0; i < attr.count; i++) {
      vTmp.fromBufferAttribute(attr, i).applyMatrix4(o.matrixWorld);
      if (vTmp.z <= frontZ) { sumX += vTmp.x; sumY += vTmp.y; cnt++; }
    }
  });
  g.userData.muzzle = cnt
    ? new THREE.Vector3(sumX / cnt, sumY / cnt, muzzleZ)
    : new THREE.Vector3(0, 0, muzzleZ);
  return g;
}

/* ---------------- 武器配置 ---------------- */
// CS:GO 弹道图（30 发，单位弧度）：[垂直上跳, 水平偏移]，相对第 1 发的落点。
// 数据取自 AK-47 / M4A4 官方 spray pattern 图，逐帧解码弹着点后换算。
// 用法：第 N 发的后坐增量 = pattern[N] - pattern[N-1]，累积为相机 view punch。
const AK_PATTERN = [
  [0,0],[0.00717,-0.00371],[0.02373,0.00037],[0.05068,-0.00247],[0.07911,-0.00309],
  [0.1089,0.00828],[0.13486,0.0157],[0.15278,0.02769],[0.16576,0.01236],[0.16205,-0.02645],
  [0.17021,-0.04722],[0.178,-0.03523],[0.17948,-0.04957],[0.1707,-0.07293],[0.17689,-0.07651],
  [0.18356,-0.04203],[0.18739,-0.02151],[0.19295,-0.00828],[0.19048,0.01656],[0.18294,0.04697],
  [0.18727,0.03028],[0.18752,0.03671],[0.19382,0.02719],[0.19642,0.01965],[0.19394,0.03782],
  [0.19802,0.04363],[0.2,0.02472],[0.19654,-0.00396],[0.19283,0.02954],[0.19592,-0.00618]
];
const M4_PATTERN = [
  [0,0],[0.0062,-0.00101],[0.0152,0],[0.03026,-0.00519],[0.0504,0.00013],
  [0.07269,-0.00684],[0.09751,-0.01152],[0.11232,0.00405],[0.12448,0.01368],[0.12916,0.03444],
  [0.13967,0.03026],[0.14537,0.01368],[0.14081,-0.01482],[0.14094,-0.03723],[0.1355,-0.06218],
  [0.14157,-0.06243],[0.14423,-0.05382],[0.14626,-0.06483],[0.14183,-0.07851],[0.1455,-0.07421],
  [0.14474,-0.04407],[0.15006,-0.03318],[0.15246,-0.00785],[0.15449,0.00089],[0.15474,0.01152],
  [0.15753,0.01317],[0.16095,0.0062],[0.165,0.01102],[0.16487,0.01583],[0.16272,0.0195]
];

const WEAPONS = {
  ak47: {
    name: 'AK-47', label: '突击步枪', icon: ak47Icon, meta: '600 RPM · 30 发',
    rpm: 600, mag: 30, reserve: 120, auto: true, reload: 2.35,
    recoilPitch: 0.0125, recoilYaw: 0.0055, kick: 0.032,
    pattern: AK_PATTERN, recoverDelay: 0.25, recoverTime: 0.35,
    // 武器数据表（AK-47 行）：连射间隔 0.1s、精度恢复时间 0.381/0.46s
    fireInterval: 0.10, recoveryTime: 0.381, recoveryFull: 0.460,
    kickBackMax: 0.14,
    accuracy: { base: 0.0009, step: 0.0050, max: 0.030, delay: 0.12, recover: 0.38, ads: 0.45 },
    adsFov: 52, sound: 'rifle', model: 'ak47',
    muzzle: new THREE.Vector3(0, 0.015, -0.70), eject: new THREE.Vector3(0.09, 0.06, 0.05)
  },
  m4a4: {
    name: 'M4A4', label: '突击步枪', icon: m4a4Icon, meta: '666 RPM · 30 发',
    rpm: 666, mag: 30, reserve: 120, auto: true, reload: 2.9,
    recoilPitch: 0.0095, recoilYaw: 0.0042, kick: 0.024,
    pattern: M4_PATTERN, recoverDelay: 0.22, recoverTime: 0.32,
    // 武器数据表（M4A4 行）：连射间隔 0.09s、精度恢复时间 0.302/0.423s
    fireInterval: 0.09, recoveryTime: 0.302, recoveryFull: 0.423,
    kickBackMax: 0.12,
    accuracy: { base: 0.0008, step: 0.0038, max: 0.023, delay: 0.11, recover: 0.32, ads: 0.42 },
    adsFov: 55, sound: 'm4', model: 'm4a4',
    muzzle: new THREE.Vector3(0, 0.02, -0.62), eject: new THREE.Vector3(0.09, 0.06, 0.05)
  },
  usp: {
    name: 'USP-S', label: '消音手枪', icon: uspIcon, meta: '400 RPM · 12 发',
    rpm: 400, mag: 12, reserve: 60, auto: false, reload: 2.1,
    recoilPitch: 0.010, recoilYaw: 0.003, kick: 0.022,
    accuracy: { base: 0.0007, step: 0.0022, max: 0.013, delay: 0.08, recover: 0.22, ads: 0.35 },
    adsFov: 48, sound: 'usp', model: 'usp',
    muzzle: new THREE.Vector3(0, 0.045, -0.36), eject: new THREE.Vector3(0.07, 0.05, 0.02)
  },
  awp: {
    name: 'AWP', label: '狙击步枪', icon: awpIcon, meta: '41 RPM · 5 发',
    rpm: 41, mag: 5, reserve: 25, auto: false, reload: 3.6,
    recoilPitch: 0.038, recoilYaw: 0.006, kick: 0.085,
    accuracy: { base: 0.00025, step: 0.0016, max: 0.009, delay: 0.25, recover: 0.55, ads: 0.05 },
    adsFov: 16, sound: 'awp', model: 'awp', scope: true,
    // 追踪数据：AWP 盲狙（腰射）命中率仅 52.9%，远低于开镜
    blindHitRate: 0.529,
    muzzle: new THREE.Vector3(0, 0.025, -0.92), eject: new THREE.Vector3(0.09, 0.06, 0.08)
  }
};

/* ============================================================
   音效引擎 — 程序化合成 CS:GO 风格枪声
   ============================================================ */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.reverb = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.62;
    this.master.connect(this.ctx.destination);

    // 短房间混响脉冲
    const len = Math.floor(this.ctx.sampleRate * 0.55);
    const ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.55;
      }
    }
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.28;
    this.reverb.connect(wet);
    wet.connect(this.master);
    this.wetNode = this.reverb;

    // 白噪声缓冲
    const nlen = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, nlen, this.ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
  }

  _noiseBurst(t, dur, filterType, freq, q, gain, wet = 0.35) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rand(0.92, 1.08);
    const flt = ctx.createBiquadFilter();
    flt.type = filterType; flt.frequency.value = freq; flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    if (wet > 0) { const wg = ctx.createGain(); wg.gain.value = wet; g.connect(wg); wg.connect(this.wetNode); }
    src.start(t); src.stop(t + dur + 0.02);
    return { flt, g };
  }

  _tone(t, f0, f1, dur, gain, type = 'sine', wet = 0.2) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    if (wet > 0) { const wg = ctx.createGain(); wg.gain.value = wet; g.connect(wg); wg.connect(this.wetNode); }
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  shot(kind) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const p = {
      rifle: { body: 0.115, crack: 0.052, low: 165, high: 2900, vol: 0.95, tail: 0.36 },
      m4:    { body: 0.095, crack: 0.046, low: 195, high: 3400, vol: 0.82, tail: 0.30 },
      usp:   { body: 0.070, crack: 0.040, low: 235, high: 4200, vol: 0.62, tail: 0.22 },
      awp:   { body: 0.190, crack: 0.075, low: 120, high: 2300, vol: 1.15, tail: 0.55 }
    }[kind] || { body: 0.1, crack: 0.05, low: 170, high: 3000, vol: 0.9, tail: 0.3 };

    // 枪口爆裂：宽频噪声
    this._noiseBurst(t, p.body, 'lowpass', 4800, 0.7, 0.62 * p.vol, 0.4);
    // 清脆的高频 crack
    this._noiseBurst(t + 0.002, p.crack, 'bandpass', p.high, 1.1, 0.42 * p.vol, 0.45);
    // 低频枪身震动
    this._tone(t, p.low, 48, p.body * 1.5, 0.42 * p.vol, 'triangle', 0.25);
    // 机械动作声
    this._noiseBurst(t + 0.012, 0.035, 'highpass', 2200, 0.8, 0.12 * p.vol, 0.15);
    // 远处回声尾巴
    this._noiseBurst(t + 0.045, p.tail, 'lowpass', 1100, 0.5, 0.085 * p.vol, 1.0);
    if (kind === 'awp') this._tone(t + 0.02, 320, 90, 0.30, 0.16, 'sawtooth', 0.6);
    if (kind === 'usp') {
      // 消音器：压低高频，增加闷响
      this._noiseBurst(t, 0.085, 'lowpass', 900, 0.6, 0.22, 0.5);
      this._tone(t, 150, 70, 0.09, 0.16, 'sine', 0.2);
    }
  }

  hit(head = false) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (head) {
      this._tone(t, 2400, 1600, 0.075, 0.16, 'sine', 0.12);
      this._tone(t + 0.045, 3200, 2100, 0.085, 0.11, 'sine', 0.12);
    } else {
      this._tone(t, 1500, 900, 0.065, 0.13, 'sine', 0.1);
    }
  }

  targetBreak() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._noiseBurst(t, 0.16, 'bandpass', 1800, 1.4, 0.16, 0.5);
    this._tone(t + 0.02, 900, 1400, 0.13, 0.10, 'triangle', 0.3);
    this._tone(t + 0.09, 1500, 2100, 0.16, 0.08, 'sine', 0.3);
  }

  empty() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._noiseBurst(t, 0.025, 'highpass', 3500, 2, 0.16, 0.2);
    this._tone(t, 800, 500, 0.03, 0.05, 'square', 0.1);
  }

  reloadClick(step) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (step === 0) {
      this._noiseBurst(t, 0.045, 'bandpass', 1300, 2.5, 0.22, 0.25);
      this._tone(t, 420, 260, 0.05, 0.08, 'square', 0.15);
    } else if (step === 1) {
      this._noiseBurst(t, 0.055, 'bandpass', 2300, 3, 0.24, 0.3);
      this._tone(t, 700, 430, 0.06, 0.09, 'triangle', 0.2);
    } else {
      this._noiseBurst(t, 0.04, 'highpass', 2600, 2, 0.25, 0.2);
      this._tone(t, 980, 620, 0.055, 0.1, 'square', 0.15);
    }
  }

  uiClick() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 1200, 800, 0.04, 0.07, 'sine', 0.05);
  }
}
const audio = new SoundEngine();

/* ============================================================
   程序化武器模型
   ============================================================ */
const MAT = {
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x41464e, metalness: 0.6, roughness: 0.38 }),
  blackMetal: new THREE.MeshStandardMaterial({ color: 0x25292f, metalness: 0.55, roughness: 0.36 }),
  gunmetal: new THREE.MeshStandardMaterial({ color: 0x5d6670, metalness: 0.75, roughness: 0.28 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x936033, metalness: 0.02, roughness: 0.65 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x6e4323, metalness: 0.02, roughness: 0.72 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x3a414a, metalness: 0.08, roughness: 0.7 }),
  polymerDark: new THREE.MeshStandardMaterial({ color: 0x282e36, metalness: 0.06, roughness: 0.75 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xb9c3ce, metalness: 0.8, roughness: 0.22 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xe5b355, metalness: 0.8, roughness: 0.25 }),
  // 第一人称手部：战术手套 + 迷彩袖
  glove: new THREE.MeshStandardMaterial({ color: 0x272b31, metalness: 0.05, roughness: 0.88 }),
  gloveSeam: new THREE.MeshStandardMaterial({ color: 0x3b414a, metalness: 0.05, roughness: 0.82 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x4c5340, metalness: 0.02, roughness: 0.96 }),
  sleeveDark: new THREE.MeshStandardMaterial({ color: 0x343a2c, metalness: 0.02, roughness: 0.96 })
};

function box(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  return m;
}
function cyl(r1, r2, h, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  return m;
}

function buildAK() {
  const g = new THREE.Group();
  g.add(box(0.15, 0.115, 0.36, MAT.darkMetal, 0, 0, 0));
  g.add(box(0.152, 0.035, 0.31, MAT.blackMetal, 0, 0.073, -0.02));
  g.add(box(0.13, 0.028, 0.25, MAT.gunmetal, 0, 0.096, -0.02));
  g.add(cyl(0.017, 0.017, 0.42, MAT.blackMetal, 0, 0.018, -0.40, Math.PI / 2));
  g.add(cyl(0.027, 0.027, 0.085, MAT.gunmetal, 0, 0.018, -0.65, Math.PI / 2));
  g.add(cyl(0.012, 0.012, 0.34, MAT.darkMetal, 0, 0.062, -0.33, Math.PI / 2));
  // 木质护木
  g.add(box(0.115, 0.09, 0.27, MAT.wood, 0, -0.005, -0.30));
  g.add(box(0.10, 0.045, 0.24, MAT.woodDark, 0, -0.065, -0.30));
  // 弹匣（弧形分节）—— 独立组，换弹时拔出/插入
  const mag = new THREE.Group();
  mag.add(box(0.088, 0.14, 0.115, MAT.blackMetal, 0, -0.13, 0.025, -0.28));
  mag.add(box(0.086, 0.13, 0.11, MAT.blackMetal, 0, -0.245, -0.005, -0.5));
  mag.add(box(0.09, 0.03, 0.12, MAT.darkMetal, 0, -0.31, -0.045, -0.5));
  g.add(mag);
  // 握把与扳机
  g.add(box(0.075, 0.17, 0.085, MAT.wood, 0, -0.145, 0.17, 0.22));
  g.add(box(0.055, 0.012, 0.10, MAT.darkMetal, 0, -0.07, 0.14));
  g.add(box(0.012, 0.055, 0.012, MAT.gunmetal, 0, -0.10, 0.11));
  // 枪托
  g.add(box(0.085, 0.095, 0.24, MAT.wood, 0, -0.045, 0.30, -0.06));
  g.add(box(0.11, 0.13, 0.035, MAT.woodDark, 0, -0.055, 0.435));
  g.add(box(0.06, 0.035, 0.16, MAT.woodDark, 0, 0.012, 0.36));
  // 瞄具
  g.add(box(0.06, 0.06, 0.025, MAT.blackMetal, 0, 0.115, -0.53));
  g.add(box(0.09, 0.045, 0.06, MAT.blackMetal, 0, 0.115, 0.10));
  // 拉机柄（AK 无空仓挂机，换弹末需手动拉栓上膛）
  const handle = new THREE.Group();
  handle.add(box(0.04, 0.022, 0.035, MAT.gunmetal, 0.082, 0.03, 0.02));
  handle.add(box(0.012, 0.045, 0.025, MAT.accent, 0.104, 0.03, 0.02, 0, 0, 0.2));
  g.add(handle);
  g.userData.parts = { mag, handle };
  return g;
}

function buildM4() {
  const g = new THREE.Group();
  g.add(box(0.14, 0.12, 0.35, MAT.polymer, 0, 0, 0));
  g.add(box(0.145, 0.022, 0.34, MAT.blackMetal, 0, 0.071, -0.01));
  for (let i = 0; i < 7; i++) g.add(box(0.125, 0.008, 0.02, MAT.darkMetal, 0, 0.084, -0.14 + i * 0.045));
  g.add(cyl(0.016, 0.016, 0.38, MAT.blackMetal, 0, 0.015, -0.38, Math.PI / 2));
  g.add(cyl(0.024, 0.024, 0.06, MAT.gunmetal, 0, 0.015, -0.60, Math.PI / 2));
  g.add(box(0.10, 0.09, 0.25, MAT.polymerDark, 0, -0.01, -0.27));
  for (let i = 0; i < 5; i++) g.add(box(0.105, 0.012, 0.03, MAT.blackMetal, 0, 0.04, -0.17 - i * 0.05));
  // 直弹匣 —— 独立组
  const mag = new THREE.Group();
  mag.add(box(0.082, 0.20, 0.105, MAT.polymerDark, 0, -0.155, 0.015, -0.12));
  mag.add(box(0.086, 0.026, 0.11, MAT.darkMetal, 0, -0.26, 0.0));
  g.add(mag);
  g.add(box(0.07, 0.16, 0.08, MAT.polymer, 0, -0.14, 0.165, 0.2));
  g.add(box(0.012, 0.05, 0.012, MAT.gunmetal, 0, -0.10, 0.11));
  // 伸缩枪托
  g.add(cyl(0.018, 0.018, 0.19, MAT.darkMetal, 0, 0.005, 0.27, Math.PI / 2));
  g.add(box(0.075, 0.085, 0.16, MAT.polymerDark, 0, -0.025, 0.40));
  g.add(box(0.09, 0.115, 0.03, MAT.polymer, 0, -0.03, 0.49));
  g.add(box(0.055, 0.055, 0.055, MAT.blackMetal, 0, 0.105, -0.48));
  g.add(box(0.085, 0.05, 0.045, MAT.blackMetal, 0, 0.105, 0.10));
  // 拉机柄 / 空仓挂机杆（M4 有空仓挂机，换弹末用左手拍击）
  const handle = new THREE.Group();
  handle.add(box(0.035, 0.02, 0.028, MAT.gunmetal, 0.078, 0.03, 0.0));
  handle.add(box(0.026, 0.04, 0.02, MAT.accent, 0.096, 0.01, 0.0));
  g.add(handle);
  g.userData.parts = { mag, handle };
  return g;
}

function buildUSP() {
  const g = new THREE.Group();
  // 套筒 —— 独立组，换弹末后拉上膛
  const slide = new THREE.Group();
  slide.add(box(0.095, 0.065, 0.30, MAT.darkMetal, 0, 0.045, 0));
  slide.add(box(0.097, 0.02, 0.28, MAT.blackMetal, 0, 0.082, 0));
  slide.add(box(0.035, 0.035, 0.02, MAT.darkMetal, 0, 0.105, -0.13));
  slide.add(box(0.055, 0.025, 0.025, MAT.darkMetal, 0, 0.105, 0.105));
  g.add(slide);
  g.add(box(0.09, 0.075, 0.25, MAT.polymerDark, 0, -0.02, 0.015));
  g.add(box(0.075, 0.16, 0.085, MAT.polymer, 0, -0.13, 0.105, 0.2));
  g.add(box(0.05, 0.012, 0.085, MAT.darkMetal, 0, -0.058, 0.045));
  g.add(box(0.01, 0.045, 0.01, MAT.gunmetal, 0, -0.085, 0.045));
  // 弹匣底板 —— 独立组
  const mag = new THREE.Group();
  mag.add(box(0.062, 0.022, 0.075, MAT.blackMetal, 0, -0.213, 0.10, 0.2));
  g.add(mag);
  // 消音器
  g.add(cyl(0.013, 0.013, 0.10, MAT.blackMetal, 0, 0.045, -0.19, Math.PI / 2));
  g.add(cyl(0.033, 0.033, 0.24, MAT.blackMetal, 0, 0.045, -0.32, Math.PI / 2));
  g.add(cyl(0.034, 0.034, 0.012, MAT.gunmetal, 0, 0.045, -0.445, Math.PI / 2));
  g.userData.parts = { mag, slide };
  return g;
}

function buildAWP() {
  const g = new THREE.Group();
  g.add(box(0.13, 0.12, 0.34, MAT.darkMetal, 0, 0, 0));
  g.add(cyl(0.017, 0.017, 0.52, MAT.blackMetal, 0, 0.025, -0.44, Math.PI / 2));
  g.add(cyl(0.030, 0.030, 0.075, MAT.gunmetal, 0, 0.025, -0.72, Math.PI / 2));
  g.add(box(0.10, 0.075, 0.22, MAT.polymerDark, 0, -0.015, -0.26));
  // 瞄准镜
  g.add(cyl(0.045, 0.045, 0.30, MAT.blackMetal, 0, 0.14, -0.05, Math.PI / 2));
  g.add(cyl(0.052, 0.052, 0.035, MAT.gunmetal, 0, 0.14, -0.20, Math.PI / 2));
  g.add(cyl(0.052, 0.052, 0.035, MAT.gunmetal, 0, 0.14, 0.10, Math.PI / 2));
  g.add(cyl(0.038, 0.038, 0.02, MAT.accent, 0, 0.14, -0.21, Math.PI / 2));
  g.add(box(0.02, 0.055, 0.02, MAT.darkMetal, 0, 0.095, -0.05));
  g.add(box(0.02, 0.055, 0.02, MAT.darkMetal, 0, 0.095, 0.08));
  // 枪机与拉柄 —— 独立组：开火后自动抛壳拉栓，换弹末也要拉栓
  const bolt = new THREE.Group();
  bolt.add(box(0.075, 0.06, 0.13, MAT.gunmetal, 0.08, 0.035, 0.05, 0, 0, 0.1));
  const handle = new THREE.Group();
  handle.position.set(0.08, 0.035, 0.05);
  handle.add(cyl(0.012, 0.012, 0.06, MAT.accent, 0.035, 0.045, 0.02, 0, 0, Math.PI / 2));
  handle.add(box(0.022, 0.022, 0.03, MAT.accent, 0.065, 0.045, 0.02));
  bolt.add(handle);
  g.add(bolt);
  // 枪托
  g.add(box(0.085, 0.10, 0.28, MAT.polymer, 0, -0.045, 0.30, -0.05));
  g.add(box(0.10, 0.13, 0.035, MAT.polymerDark, 0, -0.055, 0.45));
  g.add(box(0.06, 0.03, 0.14, MAT.polymer, 0, 0.02, 0.38));
  g.add(box(0.07, 0.15, 0.085, MAT.polymer, 0, -0.14, 0.17, 0.2));
  g.add(box(0.01, 0.05, 0.01, MAT.gunmetal, 0, -0.10, 0.11));
  // 弹匣 —— 独立组
  const mag = new THREE.Group();
  mag.add(box(0.065, 0.10, 0.08, MAT.polymerDark, 0, -0.16, -0.02, -0.2));
  g.add(mag);
  g.userData.parts = { mag, bolt, handle };
  return g;
}

// GLB 版：poly.pizza 低模作为视觉主体。模型为单一 mesh（弹匣/枪机无独立节点），
// 换弹/拉栓靠整体姿态 + 手部动作驱动；不额外叠加程序化部件以免风格冲突。
function buildM4Glb() {
  return buildFromGlb(glbM4, 1.0, Math.PI / 2, 0.06);
}
function buildAwpGlb() {
  return buildFromGlb(glbAwp, 1.2, Math.PI / 2, 0.06);
}
function buildAkGlb() {
  return buildFromGlb(glbAk, 1.05, Math.PI / 2, 0.06);
}

// USP-S：poly.pizza Quaternius 低模手枪主体 + 同风格程序化消音器。
// GLB 单一 mesh（无独立套筒节点），换弹靠整体姿态 + 手部驱动。
function buildUspGlb() {
  // 手枪原始轴向：枪管 +X、握把 -Z、厚度 Y。先绕 X -90° 把握把朝下，再绕 Y +90° 让枪管朝 -Z。
  const g = buildFromGlb(glbUsp, 0.36, Math.PI / 2, 0.06, -Math.PI / 2);
  // 消音器：低多边形深色圆柱，套在枪口（模型前端 -Z），风格与低模主体一致。
  // 注意：muzzle 是外层 g 坐标系（模型已归一化到 g），消音器必须加到 g 上，
  // 加到带 scale/position 的 model 上会被二次变换、飞到错误位置。
  const muzzle = g.userData.muzzle;
  const silencer = new THREE.Group();
  silencer.add(cyl(0.024, 0.026, 0.16, MAT.blackMetal, 0, 0, -0.08, Math.PI / 2));
  silencer.add(cyl(0.027, 0.027, 0.012, MAT.darkMetal, 0, 0, -0.16, Math.PI / 2));
  silencer.position.set(muzzle.x, muzzle.y, muzzle.z + 0.04);
  g.add(silencer);
  // 枪口更新到消音器前端，供枪焰/曳光弹使用
  g.userData.muzzle = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z - 0.12);
  return g;
}

const BUILDERS = { ak47: buildAkGlb, m4a4: buildM4Glb, usp: buildUspGlb, awp: buildAwpGlb };

/* ---------------- 第一人称手部模型 ---------------- */
// 手与武器同处 viewCamera 局部空间，跟随 sway/后坐/上抬/ADS/换弹一起运动。
// 每只手 = 手掌 + 四指 + 拇指 + 小臂(袖)，用 quaternion 把圆柱从 Y 轴对齐到小臂方向。
function makeHand(palm, armTo, opts = {}) {
  const h = new THREE.Group();
  h.position.set(...palm);
  // 手掌
  h.add(box(0.095, 0.078, 0.105, MAT.glove, 0, 0, 0));
  // 四指：在手掌前下方（-z），略微下扣握住枪身
  const fingers = opts.fingers ?? 4;
  for (let i = 0; i < fingers; i++) {
    h.add(box(0.020, 0.024, 0.072, MAT.gloveSeam, -0.034 + i * 0.023, 0.040, -0.045, 0.45));
  }
  // 拇指
  h.add(box(0.026, 0.052, 0.048, MAT.gloveSeam, 0.055, 0.005, 0.018, 0, 0, -0.5));
  // 小臂：从手掌中心指向 armTo（相对手掌的偏移）
  const a = new THREE.Vector3(0, 0, 0);
  const b = new THREE.Vector3(...armTo);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
  const arm = cyl(0.055, 0.072, len, MAT.sleeve, 0, 0, 0);
  arm.position.copy(a).add(b).multiplyScalar(0.5);
  arm.quaternion.copy(q); h.add(arm);
  // 袖口（靠手掌一侧）
  const cuff = cyl(0.068, 0.068, 0.05, MAT.sleeveDark, 0, 0, 0);
  cuff.position.copy(a).addScaledVector(dir.clone().normalize(), 0.045);
  cuff.quaternion.copy(q); h.add(cuff);
  return h;
}

// 各枪左右手在武器局部坐标中的位置（palm / armTo 为相对偏移）
const HAND_LAYOUT = {
  ak47: {
    right: { palm: [0.02, -0.16, 0.20], armTo: [0.30, -0.62, 0.55] },
    left:  { palm: [0.0, -0.10, -0.29], armTo: [-0.34, -0.56, 0.10] }
  },
  m4a4: {
    right: { palm: [0.02, -0.15, 0.19], armTo: [0.30, -0.62, 0.55] },
    left:  { palm: [0.0, -0.09, -0.26], armTo: [-0.34, -0.56, 0.10] }
  },
  usp: {
    right: { palm: [0.01, -0.14, 0.13], armTo: [0.28, -0.60, 0.52] },
    left:  { palm: [-0.01, -0.06, -0.12], armTo: [-0.28, -0.55, 0.20] }
  },
  awp: {
    right: { palm: [0.02, -0.15, 0.19], armTo: [0.30, -0.62, 0.55] },
    left:  { palm: [0.0, -0.08, -0.32], armTo: [-0.34, -0.56, 0.10] }
  }
};

function buildHands(model) {
  const g = new THREE.Group();
  const L = HAND_LAYOUT[model];
  if (!L) return g;
  const right = makeHand(L.right.palm, L.right.armTo);
  const left = makeHand(L.left.palm, L.left.armTo);
  g.add(right, left);
  g.userData.right = right;
  g.userData.left = left;
  g.userData.rightBase = right.position.clone();
  g.userData.leftBase = left.position.clone();
  return g;
}

/* ---------------- 换弹 / 拉栓动画曲线 ---------------- */
// seg: p 在 [a,b] 内平滑过渡 0→1；pulse: 区间内 0→1→0 的脉冲
function seg(p, a, b) {
  if (p <= a) return 0;
  if (p >= b) return 1;
  const t = (p - a) / (b - a);
  return t * t * (3 - 2 * t);
}
function pulse(p, a, b) {
  if (p <= a || p >= b) return 0;
  return Math.sin((p - a) / (b - a) * Math.PI);
}

// 每把枪的换弹姿态：参考 CS:GO 对应枪械的实际动作时序
// AK：枪身左倾横置 → 左手插弹匣 → 右手拉机柄上膛
// M4A4：枪身斜上举 → 弹匣直插 → 左手拍击空仓挂机杆（有空仓挂机）
// USP-S：握把底部插弹匣 → 套筒后拉上膛
// AWP：弹匣直插 → 拉栓上膛
function reloadPose(key, p) {
  const P = {
    roll: 0, pitch: 0, yaw: 0, dropY: 0,
    magY: 0, magZ: 0, magRot: 0,
    slideZ: 0, boltZ: 0, handleRot: 0,
    leftX: 0, leftY: 0, leftZ: 0, leftRot: 0,
    rightY: 0, shake: 0
  };
  if (key === 'ak47') {
    // 倾斜 → 插弹匣 → 卡入 → 回正 → 拉机柄
    const tilt = seg(p, 0.05, 0.22) * (1 - seg(p, 0.80, 0.98));
    P.roll = -0.92 * tilt;
    P.pitch = 0.12 * tilt;
    P.dropY = -0.08 * tilt;
    const magIn = seg(p, 0.20, 0.58);
    P.magY = -0.52 * (1 - magIn);
    P.magZ = -0.14 * (1 - magIn);
    P.magRot = -0.25 * (1 - magIn);
    // 左手下移去够弹匣，插入阶段跟随
    P.leftY = -0.14 * seg(p, 0.10, 0.24) * (1 - seg(p, 0.58, 0.78));
    P.leftZ = 0.06 * seg(p, 0.10, 0.24) * (1 - seg(p, 0.58, 0.78));
    P.shake = 0.010 * pulse(p, 0.56, 0.66);
    // 拉机柄：后拉→前推（AK 无空仓挂机，必须上膛）
    P.slideZ = 0.13 * pulse(p, 0.72, 0.94);
    P.rightY = -0.02 * pulse(p, 0.72, 0.94);
  } else if (key === 'm4a4') {
    // 斜上举枪 → 弹匣直插 → 拍击空仓挂机 → 回正
    const tilt = seg(p, 0.05, 0.20) * (1 - seg(p, 0.84, 0.99));
    P.roll = 0.38 * tilt;
    P.pitch = -0.18 * tilt;
    P.dropY = 0.03 * tilt;
    const magIn = seg(p, 0.18, 0.60);
    P.magY = -0.48 * (1 - magIn);
    P.magRot = 0.05 * (1 - magIn);
    P.leftY = -0.16 * seg(p, 0.08, 0.22) * (1 - seg(p, 0.62, 0.80));
    // 拍击空仓挂机：左手在 0.72-0.84 快速上拍一下
    const slap = pulse(p, 0.70, 0.86);
    P.leftY += 0.10 * slap;
    P.leftRot = -0.5 * slap;
    P.shake = 0.016 * slap;
    P.slideZ = 0.012 * slap; // 拍击时机枪轻微回弹
  } else if (key === 'usp') {
    // 枪身微沉 → 弹匣插入 → 套筒后拉 → 回正
    const dip = seg(p, 0.05, 0.18) * (1 - seg(p, 0.86, 0.99));
    P.roll = 0.28 * dip;
    P.pitch = 0.18 * dip;
    P.dropY = -0.05 * dip;
    const magIn = seg(p, 0.16, 0.52);
    P.magY = -0.34 * (1 - magIn);
    P.leftY = -0.12 * seg(p, 0.10, 0.22) * (1 - seg(p, 0.54, 0.72));
    // 套筒后拉上膛
    const rack = pulse(p, 0.60, 0.90);
    P.slideZ = 0.085 * rack;
    P.leftZ = 0.05 * rack;
    P.shake = 0.008 * pulse(p, 0.50, 0.60);
  } else if (key === 'awp') {
    // 枪身微倾 → 弹匣插入 → 拉栓 → 回正
    const tilt = seg(p, 0.04, 0.18) * (1 - seg(p, 0.90, 0.99));
    P.roll = -0.34 * tilt;
    P.pitch = 0.10 * tilt;
    P.dropY = -0.05 * tilt;
    const magIn = seg(p, 0.14, 0.50);
    P.magY = -0.44 * (1 - magIn);
    P.magRot = -0.15 * (1 - magIn);
    P.leftY = -0.14 * seg(p, 0.08, 0.22) * (1 - seg(p, 0.52, 0.70));
    // 拉栓：抬柄→后拉→前推→压柄
    const cycle = pulse(p, 0.60, 0.92);
    P.boltZ = 0.16 * cycle;
    P.handleRot = 1.05 * cycle;
    P.leftZ = 0.07 * cycle;
    P.leftY += 0.05 * cycle;
  }
  return P;
}

// AWP 开火后自动拉栓：约 0.62s 的抬柄→后拉→前推→压柄
function boltCyclePose(p) {
  const P = { boltZ: 0, handleRot: 0, leftZ: 0, leftY: 0, roll: 0 };
  if (p < 0 || p >= 1) return P;
  const lift = seg(p, 0.02, 0.18) * (1 - seg(p, 0.74, 0.94));
  const pull = pulse(p, 0.18, 0.80);
  P.handleRot = 1.05 * lift;
  P.boltZ = 0.17 * pull;
  P.leftZ = 0.08 * pull;
  P.leftY = 0.04 * lift;
  P.roll = -0.05 * pull;
  return P;
}

/* ============================================================
   场景搭建
   ============================================================ */
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1118);
scene.fog = new THREE.Fog(0x0c1118, 26, 72);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(0, 1.65, 4);

// 第一人称武器使用独立场景，避免穿模
const viewScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 20);
viewScene.add(viewCamera);
viewScene.add(new THREE.HemisphereLight(0xdcecff, 0x58544c, 3.2));
const vmKey = new THREE.DirectionalLight(0xffe9d0, 3.6);
vmKey.position.set(-1.5, 3, 2); viewScene.add(vmKey);
const vmFill = new THREE.DirectionalLight(0x9fd4ff, 2.0);
vmFill.position.set(2, -1, 1.5); viewScene.add(vmFill);
const vmFront = new THREE.PointLight(0xffd9b0, 4, 8);
vmFront.position.set(0.6, 0.8, 1.4); viewScene.add(vmFront);

// 环境光
scene.add(new THREE.HemisphereLight(0xa8c4e0, 0x1a1f27, 1.35));
const sun = new THREE.DirectionalLight(0xffdbb0, 1.5);
sun.position.set(-8, 14, 6); scene.add(sun);
const rim = new THREE.DirectionalLight(0x4aa7ff, 0.8);
rim.position.set(8, 5, -16); scene.add(rim);
const wallFillA = new THREE.PointLight(0x62b6ff, 55, 34, 2);
wallFillA.position.set(-8, 7, -14); scene.add(wallFillA);
const wallFillB = new THREE.PointLight(0xffa357, 38, 34, 2);
wallFillB.position.set(9, 6, -14); scene.add(wallFillB);

function gridTexture(base, line, repeat) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4200; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.028})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  ctx.strokeStyle = line; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 510, 510);
  ctx.beginPath(); ctx.moveTo(256, 0); ctx.lineTo(256, 512); ctx.moveTo(0, 256); ctx.lineTo(512, 256); ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 地面
const floorMat = new THREE.MeshStandardMaterial({ map: gridTexture('#222932', 'rgba(120,180,220,.20)', 12), roughness: 0.92, metalness: 0.05 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -8); scene.add(floor);

// 后墙（靶场墙）
const wallMat = new THREE.MeshStandardMaterial({ map: gridTexture('#1b222c', 'rgba(120,180,220,.13)', 8), roughness: 0.9 });
const backWall = new THREE.Mesh(new THREE.PlaneGeometry(34, 16), wallMat);
backWall.position.set(0, 8, -19); scene.add(backWall);

// 侧墙与天花板
for (const sx of [-13, 13]) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(50, 16), wallMat);
  w.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
  w.position.set(sx, 8, -8); scene.add(w);
}
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(60, 50), new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 1 }));
ceiling.rotation.x = Math.PI / 2; ceiling.position.set(0, 15.9, -8); scene.add(ceiling);

// 墙面装饰：横向标尺灯带
for (let i = 0; i < 4; i++) {
  const strip = new THREE.Mesh(new THREE.BoxGeometry(30, 0.035, 0.035),
    new THREE.MeshBasicMaterial({ color: i % 2 ? 0x2d6c8a : 0x8a5a2d }));
  strip.position.set(0, 2.3 + i * 3.3, -18.96); scene.add(strip);
}
// 顶部灯管
for (let i = 0; i < 6; i++) {
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 6),
    new THREE.MeshBasicMaterial({ color: 0xc7dcf0 }));
  lamp.position.set(-9 + i * 3.6, 15.7, -8); scene.add(lamp);
}
// 地面射击线
const lineMat = new THREE.MeshBasicMaterial({ color: 0xff9b42, transparent: true, opacity: 0.4 });
const shootLine = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.05), lineMat);
shootLine.rotation.x = -Math.PI / 2; shootLine.position.set(0, 0.012, 0.5); scene.add(shootLine);

/* ---------------- 靶子 ---------------- */
const TARGET_RADIUS = 0.66;

const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
const gctx = glowCanvas.getContext('2d');
const gg = gctx.createRadialGradient(64, 64, 2, 64, 64, 64);
gg.addColorStop(0, 'rgba(130,235,255,.8)'); gg.addColorStop(0.25, 'rgba(50,190,255,.35)');
gg.addColorStop(0.6, 'rgba(30,140,220,.10)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
gctx.fillStyle = gg; gctx.fillRect(0, 0, 128, 128);
const glowTex = new THREE.CanvasTexture(glowCanvas);
const targetSlots = [];
// 三排靶心高度：最低排也留足空间（外环半径约 1.02 + 浮动 0.07），确保整颗球露出地面
const TARGET_ROW_Y = [1.55, 2.95, 4.35];
for (let col = -2; col <= 2; col++) {
  for (let row = 0; row < TARGET_ROW_Y.length; row++) {
    targetSlots.push(new THREE.Vector3(
      col * 3.25 + rand(-0.45, 0.45),
      TARGET_ROW_Y[row] + rand(-0.2, 0.2),
      -18.2 + rand(-0.5, 0.5)
    ));
  }
}
const outerMat = new THREE.MeshStandardMaterial({ color: 0x27b6ec, emissive: 0x158fc4, emissiveIntensity: 1.35, roughness: 0.25, metalness: 0.1 });
const coreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9ff2ff, emissiveIntensity: 2.0, roughness: 0.18 });
const ringMat = new THREE.MeshBasicMaterial({ color: 0x57d8ff, transparent: true, opacity: 0.65, side: THREE.DoubleSide });

const targets = [];
const effects = [];
const decals = [];

function spawnTarget() {
  const used = new Set(targets.map(t => t.slotIndex));
  const free = targetSlots.map((_, i) => i).filter(i => !used.has(i));
  if (!free.length) return null;
  // 优先挑离现有靶子远的空位，避免多个靶子扎堆同一排；加随机抖动保持变化
  let slotIndex;
  if (!targets.length) {
    slotIndex = free[Math.floor(Math.random() * free.length)];
  } else {
    let best = -1, bestScore = -Infinity;
    for (const i of free) {
      const p = targetSlots[i];
      let nearest = Infinity;
      for (const t of targets) {
        const q = targetSlots[t.slotIndex];
        nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.y - q.y));
      }
      const score = nearest + Math.random() * 2.5;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    slotIndex = best;
  }
  const base = targetSlots[slotIndex].clone();
  const group = new THREE.Group();
  group.position.copy(base);

  const outer = new THREE.Mesh(new THREE.SphereGeometry(TARGET_RADIUS, 28, 20), outerMat.clone());
  const core = new THREE.Mesh(new THREE.SphereGeometry(TARGET_RADIUS * 0.42, 20, 14), coreMat.clone());
  core.position.z = TARGET_RADIUS * 0.78;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(TARGET_RADIUS * 1.3, 0.018, 6, 40), ringMat.clone());
  ring.position.z = 0.02;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(TARGET_RADIUS * 1.55, 0.009, 6, 40), ringMat.clone());
  ring2.position.z = 0.02;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7
  }));
  glow.scale.setScalar(TARGET_RADIUS * 4.2);
  glow.position.z = -0.2;
  glow.raycast = () => {};
  group.add(glow, outer, core, ring, ring2);

  const target = {
    group, outer, core, ring, ring2, base, slotIndex,
    born: performance.now(), phase: rand(0, Math.PI * 2), scale: 0.001, dead: false
  };
  group.scale.setScalar(0.001);
  scene.add(group);
  targets.push(target);
  return target;
}

function killTarget(target, point, isHead) {
  target.dead = true;
  scene.remove(target.group);
  const idx = targets.indexOf(target); if (idx >= 0) targets.splice(idx, 1);
  // 碎片爆发
  const burst = new THREE.Group();
  burst.position.copy(point);
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(rand(0.025, 0.07), 6, 5),
      new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xffffff : 0x4fd6ff }));
    p.userData.vel = new THREE.Vector3(rand(-2.5, 2.5), rand(-2.5, 2.5), rand(0.5, 3.5));
    burst.add(p);
  }
  scene.add(burst);
  effects.push({ obj: burst, life: 0.5, max: 0.5, kind: 'burst' });

  // 扩散光环
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 32),
    new THREE.MeshBasicMaterial({ color: isHead ? 0xff9b42 : 0x57d8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  halo.position.copy(point); halo.position.z += 0.05;
  scene.add(halo);
  effects.push({ obj: halo, life: 0.35, max: 0.35, kind: 'halo' });
}

/* ---------------- 弹着点 / 弹道 ---------------- */
const decalCanvas = document.createElement('canvas'); decalCanvas.width = decalCanvas.height = 64;
const dctx = decalCanvas.getContext('2d');
const grad = dctx.createRadialGradient(32, 32, 2, 32, 32, 30);
grad.addColorStop(0, 'rgba(0,0,0,.9)'); grad.addColorStop(0.35, 'rgba(20,15,10,.65)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
dctx.fillStyle = grad; dctx.fillRect(0, 0, 64, 64);
const decalTex = new THREE.CanvasTexture(decalCanvas);

function addDecal(point) {
  const d = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false }));
  d.position.copy(point); d.position.z += 0.012;
  scene.add(d); decals.push(d);
  if (decals.length > 28) { scene.remove(decals.shift()); }
}

function addTracer(from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(0.006, 0.012, len, 5);
  geo.translate(0, len / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xffd79b, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  m.position.copy(from);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  scene.add(m);
  effects.push({ obj: m, life: 0.09, max: 0.09, kind: 'tracer' });
}

/* ---------------- 枪口火焰与弹壳（视图场景） ---------------- */
const flashCanvas = document.createElement('canvas'); flashCanvas.width = flashCanvas.height = 128;
const fctx = flashCanvas.getContext('2d');
const fg = fctx.createRadialGradient(64, 64, 2, 64, 64, 62);
fg.addColorStop(0, 'rgba(255,255,235,1)'); fg.addColorStop(0.25, 'rgba(255,190,80,.95)');
fg.addColorStop(0.55, 'rgba(255,110,30,.5)'); fg.addColorStop(1, 'rgba(255,90,20,0)');
fctx.fillStyle = fg; fctx.fillRect(0, 0, 128, 128);
const flashTex = new THREE.CanvasTexture(flashCanvas);

const muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
muzzleFlash.scale.setScalar(0.32);
viewScene.add(muzzleFlash);
const flashLight = new THREE.PointLight(0xffa040, 0, 4);
viewScene.add(flashLight);
let flashTimer = 0;

const shells = [];
function ejectShell(pos) {
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.045, 7), MAT.brass);
  s.position.copy(pos);
  s.userData.vel = new THREE.Vector3(rand(1.2, 2.1), rand(1.0, 1.8), rand(0.4, 1.2));
  s.userData.spin = new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12));
  viewScene.add(s); shells.push({ mesh: s, life: 0.85 });
}

/* ---------------- 视口武器控制 ---------------- */
let weaponGroup = null;
let currentWeaponKey = 'ak47';
let weapon = WEAPONS.ak47;
const vmBase = new THREE.Vector3(0.31, -0.32, -0.72);
const vmRot = new THREE.Euler(0.02, -0.12, -0.02);
const vm = {
  swayX: 0, swayY: 0,
  // 后坐视图模型：上抬/横摆/侧倾与相机 view punch 同源（见 animate），保证枪口指向=弹道方向。
  // kickZ 为沿枪轴的后坐后移，独立小幅累加，用于准星动态张开。
  kickZ: 0, kickPitch: 0, kickYaw: 0, kickRoll: 0,
  kickZTarget: 0, kickT: 0,
  returnPose: null, returnT: 0, // 换弹/拉栓结束后的归位过渡
  deployT: 0,                   // 切枪取出（deploy）过渡
  bob: 0, reloadT: -1, ads: 0, boltCycle: -1 // boltCycle: AWP 拉栓动画进度（-1 为未激活）
};
const RETURN_TIME = 0.24;   // 动作结束 → 归位的过渡时长
const DEPLOY_TIME = 0.34;   // 切枪取出时长
// 归位过渡：记住动作最后一帧姿态，按 smoothstep 衰减回默认，避免瞬间跳回
function beginReturn(pose) {
  if (!pose) return;
  vm.returnPose = { ...pose };
  vm.returnT = RETURN_TIME;
}
function scalePose(p, k) {
  const out = {};
  for (const key in p) out[key] = (p[key] || 0) * k;
  return out;
}

function equipWeapon(key) {
  currentWeaponKey = key;
  weapon = WEAPONS[key];
  if (weaponGroup) viewCamera.remove(weaponGroup);
  weaponGroup = BUILDERS[weapon.model]();
  // 手部模型作为武器子物体：跟随 sway / 后坐 / 上抬 / ADS / 换弹一起运动
  const hands = buildHands(weapon.model);
  weaponGroup.add(hands);
  weaponGroup.userData.hands = hands;
  weaponGroup.position.copy(vmBase);
  weaponGroup.rotation.copy(vmRot);
  viewCamera.add(weaponGroup);
  // 兜底：模型未测算枪口时回退到配置里的局部偏移（四把枪现均来自 GLB 测算）
  if (!weaponGroup.userData.muzzle) weaponGroup.userData.muzzle = weapon.muzzle.clone();
  const muzzleWorldLocal = weaponGroup.localToWorld(weaponGroup.userData.muzzle.clone());
  muzzleFlash.position.copy(muzzleWorldLocal);
  flashLight.position.copy(muzzleWorldLocal);
  ammo = weapon.mag; reserve = weapon.reserve;
  bloom = 0; shotStreak = 0; recoilPitch = 0; recoilYaw = 0;
  vm.kickZ = vm.kickPitch = vm.kickYaw = vm.kickRoll = 0;
  vm.kickZTarget = 0; vm.kickT = 0;
  vm.returnPose = null; vm.returnT = 0;
  vm.deployT = DEPLOY_TIME;   // 切枪：从下方抬起归位
  vm.boltCycle = -1; // AWP 拉栓动画进度
  $('hud-weapon').textContent = weapon.name;
  updateAmmoHUD();
}

/* ============================================================
   游戏状态
   ============================================================ */
let state = 'menu'; // menu | playing | paused | result
let ammo = 30, reserve = 120;
// 无限弹药：训练模式下不消耗弹药、不触发换弹（瞄准/手感练习用）
let infiniteAmmo = false;
try { infiniteAmmo = localStorage.getItem('aimrange.infiniteAmmo') === '1'; } catch (e) {}
let yaw = 0, pitch = 0;
let recoilPitch = 0, recoilYaw = 0;
let lastShot = 0, nextTargetAt = 0, firing = false, adsHeld = false;
// CS:GO 精度模型：bloom 为连发累积的不准确度，随停火按恢复时间回落
let bloom = 0, shotStreak = 0;
let duration = 60, targetCount = 3;
let timeLeft = 60;
let stats = null;
let usingPointerLock = true;
let lastMouse = { x: 0, y: 0 };
// 鼠标灵敏度：玩家看到的是 CS:GO 风格数值（默认 2.1 @ 400 DPI），
// 换算成弧度/像素系数。反转 Y 轴与灵敏度持久化到 localStorage。
const SENS_SCALE = 0.001;
let sensValue = 2.1;
let invertY = false;
let sensitivity = sensValue * SENS_SCALE;
try {
  const savedSens = parseFloat(localStorage.getItem('aimrange.sens'));
  if (!isNaN(savedSens) && savedSens >= 0.1 && savedSens <= 10) sensValue = savedSens;
  invertY = localStorage.getItem('aimrange.invertY') === '1';
  sensitivity = sensValue * SENS_SCALE;
} catch (e) { /* 隐私模式下 localStorage 不可用，用默认值 */ }

// 准星配置：默认值对齐 xhair.pro 录屏里的配置
// （静态十字 / 无中心点 / 无轮廓 / 不跟随后坐力 / 长度2 粗细2 间距1 / 纯绿）
const CH_PRESETS = ['#00ff00', '#57d8ff', '#ff9b42', '#ff4d6d', '#ffffff', '#ffd400'];
const chCfg = { len: 2, thick: 2, gap: 1, color: '#00ff00', dot: false, outline: false, tshape: false, follow: false };
try {
  const saved = JSON.parse(localStorage.getItem('aimrange.crosshair') || 'null');
  if (saved && typeof saved === 'object') Object.assign(chCfg, saved);
} catch (e) {}

function resetStats() {
  stats = { score: 0, shots: 0, hits: 0, headshots: 0, combo: 0, maxCombo: 0, reactions: [], misses: 0 };
}

function updateAmmoHUD() {
  const el = $('hud-ammo');
  if (infiniteAmmo) {
    el.textContent = '∞';
    el.classList.remove('low');
    $('hud-reserve').textContent = '∞';
  } else {
    el.textContent = ammo;
    el.classList.toggle('low', ammo <= Math.max(1, Math.floor(weapon.mag * 0.2)));
    $('hud-reserve').textContent = reserve;
  }
}

function updateStatsHUD() {
  $('hud-score').textContent = stats.score;
  $('hud-acc').textContent = stats.shots ? Math.round(stats.hits / stats.shots * 100) + '%' : '--';
  $('hud-hits').textContent = stats.hits;
  $('hud-react').textContent = stats.reactions.length
    ? Math.round(stats.reactions.reduce((a, b) => a + b, 0) / stats.reactions.length) + ' ms' : '-- ms';
  $('hud-combo').textContent = stats.combo;
}

function showHitmarker(head) {
  const hm = $('hitmarker');
  hm.classList.remove('show');
  hm.classList.toggle('head', head);
  void hm.offsetWidth;
  hm.classList.add('show');
}

function toast(text) {
  const t = $('toast'); t.textContent = text;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
}

/* ---------------- 射击 ---------------- */
function tryShoot() {
  if (state !== 'playing') return;
  if (vm.reloadT >= 0) return;
  const now = performance.now();
  if (now - lastShot < 60000 / weapon.rpm) return;
  if (ammo <= 0 && !infiniteAmmo) {
    audio.empty();
    toast('弹匣已空 · 按 R 换弹');
    lastShot = now;
    return;
  }

  lastShot = now;
  vm.kickT = 0;
  if (!infiniteAmmo) ammo--;
  stats.shots++;
  updateAmmoHUD();

  audio.shot(weapon.sound);
  // AWP 栓动：每发开火后自动拉栓抛壳
  if (weapon.scope) {
    vm.boltCycle = 0;
    audio.reloadClick(0);
  }

  // 后坐力：AK/M4 按 CS:GO 弹道图逐发设定 view punch（确定性图案），其余武器随机
  if (weapon.pattern) {
    const idx = Math.min(shotStreak, weapon.pattern.length - 1);
    recoilPitch = weapon.pattern[idx][0];
    recoilYaw = weapon.pattern[idx][1];
  } else {
    recoilPitch += weapon.recoilPitch * (0.82 + Math.random() * 0.36);
    recoilYaw += rand(-weapon.recoilYaw, weapon.recoilYaw);
  }
  // 枪模上抬/横摆/侧倾不再独立累加，而是直接由相机 view punch（recoilPitch/recoilYaw）
  // 派生——CS:GO 的 viewmodel_recoil 就是视角后坐的视觉映射，枪口指向永远与弹道一致。
  // 仅保留沿枪轴的后坐后移 kickZ（不旋转枪口，只做位移反馈）。
  const backMax = weapon.kickBackMax ?? 0.16;
  vm.kickZTarget = Math.min(backMax, vm.kickZTarget + weapon.kick);
  flashTimer = 0.055;
  // 弹壳从枪的抛壳口生成：把模型局部坐标换算到视口场景坐标
  ejectShell(weaponGroup.localToWorld(weapon.eject.clone()));

  // CS:GO 精度模型：首发精准 → 连发 Bloom 递增触顶 → 停火按 RecoveryTime 回落
  const acc = weapon.accuracy;
  const spread = (acc.base + bloom) * (adsHeld ? acc.ads : 1);
  // 圆盘均匀采样：半径开方才是面积均匀，方形采样会让角落方向偏多
  const angle = Math.random() * Math.PI * 2;
  const radius = spread * Math.sqrt(Math.random());
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  dir.addScaledVector(right, Math.cos(angle) * radius);
  dir.addScaledVector(up, Math.sin(angle) * radius);
  dir.normalize();
  // 弹道从枪口发出：先用相机中心射线求"准星瞄准点"，再让子弹从枪口世界位置
  // 收敛到该点。弹道起点是真正的枪口，弹着点仍落在准星所指处，二者合一。
  const aimRay = new THREE.Raycaster(camera.position.clone(), dir, 0, 100);
  const aimHit = aimRay.intersectObjects(targets.map(t => t.group), true)[0]
    || aimRay.intersectObjects([backWall, floor], false)[0];
  const aimPoint = aimHit ? aimHit.point.clone()
    : camera.position.clone().add(dir.clone().multiplyScalar(60));
  weaponGroup.updateMatrixWorld(true);
  const muzzleLocal = weaponGroup.localToWorld(weaponGroup.userData.muzzle.clone());
  const origin = camera.position.clone().add(muzzleLocal.applyQuaternion(camera.quaternion));
  const bulletDir = aimPoint.clone().sub(origin).normalize();
  const ray = new THREE.Raycaster(origin, bulletDir, 0, 100);

  const hitTargets = ray.intersectObjects(targets.map(t => t.group), true);
  let hitPoint = origin.clone().add(bulletDir.clone().multiplyScalar(60));
  let hitTarget = null;
  let hitObject = null;

  if (hitTargets.length) {
    const hit = hitTargets[0];
    hitPoint = hit.point.clone();
    hitObject = hit.object;
    let obj = hit.object;
    while (obj) {
      const found = targets.find(t => t.group === obj);
      if (found && !found.dead) { hitTarget = found; break; }
      obj = obj.parent;
    }
  } else {
    // 墙面 / 环境
    const envHits = ray.intersectObjects([backWall, floor], false);
    if (envHits.length) { hitPoint = envHits[0].point.clone(); if (envHits[0].object === backWall) addDecal(hitPoint); }
  }

  // AWP 盲狙（腰射）：命中率按追踪数据 52.9%。掷骰未通过时判为脱靶，
  // 把弹着点落到靶子后方的墙上（保留弹孔与 tracer），但不算命中。
  if (hitTarget && isBlindMiss(weapon, adsHeld)) {
    const envHits = ray.intersectObjects([backWall, floor], false);
    if (envHits.length) {
      hitPoint = envHits[0].point.clone();
      if (envHits[0].object === backWall) addDecal(hitPoint);
    }
    hitTarget = null;
    hitObject = null;
  }

  // 曳光弹从枪口世界位置（射线起点）出发，沿真实弹道飞向命中点
  addTracer(origin, hitPoint);

  if (hitTarget) {
    const isHead = hitObject === hitTarget.core ||
      hitPoint.distanceTo(hitTarget.core.getWorldPosition(new THREE.Vector3())) < TARGET_RADIUS * 0.55;
    const reaction = Math.round(performance.now() - hitTarget.born);
    stats.hits++;
    stats.combo++;
    stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
    stats.reactions.push(reaction);
    if (isHead) {
      stats.headshots++;
      stats.score += 150 + stats.combo * 5;
      toast('爆头 +' + (150 + stats.combo * 5));
    } else {
      stats.score += 100 + stats.combo * 5;
    }
    audio.hit(isHead);
    audio.targetBreak();
    showHitmarker(isHead);
    killTarget(hitTarget, hitPoint, isHead);
    updateStatsHUD();
  } else {
    stats.combo = 0;
    stats.misses++;
    updateStatsHUD();
  }

  // 本发打完后累积不准确度：前几发增幅小，第 4 发起加大并很快触顶
  shotStreak++;
  const ramp = shotStreak <= 2 ? 0.35 : shotStreak <= 5 ? 0.8 : 1.25;
  bloom = Math.min(acc.max, bloom + acc.step * ramp);
}

function startReload() {
  if (state !== 'playing' || vm.reloadT >= 0 || ammo >= weapon.mag || reserve <= 0 || infiniteAmmo) return;
  vm.reloadT = 0;
  $('reload-bar').classList.add('show');
  audio.reloadClick(0);
}

/* ---------------- 输入 ---------------- */
function lockPointer() {
  if (!usingPointerLock || !canvas.requestPointerLock) return;
  try {
    const result = canvas.requestPointerLock();
    if (result && typeof result.catch === 'function') result.catch(() => { usingPointerLock = false; });
  } catch (e) {
    usingPointerLock = false;
  }
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) return;
  if (state === 'playing') pauseGame();
});

canvas.addEventListener('mousemove', (e) => {
  if (state !== 'playing') return;
  let dx = 0, dy = 0;
  if (document.pointerLockElement === canvas) {
    dx = e.movementX; dy = e.movementY;
  } else if (usingPointerLock === false) {
    dx = e.clientX - lastMouse.x; dy = e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };
  }
  yaw -= dx * sensitivity;
  pitch = clamp(pitch - dy * sensitivity * (invertY ? -1 : 1), -1.45, 1.45);
  vm.swayX = clamp(vm.swayX - dx * 0.00035, -0.035, 0.035);
  vm.swayY = clamp(vm.swayY + dy * 0.00035, -0.035, 0.035);
});

canvas.addEventListener('mousedown', (e) => {
  if (state !== 'playing') return;
  if (e.button === 0) { firing = true; tryShoot(); }
  if (e.button === 2) adsHeld = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) firing = false;
  if (e.button === 2) adsHeld = false;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Escape' && state === 'playing') pauseGame();
});

/* ---------------- 流程控制 ---------------- */
function clearWorldObjects() {
  for (const t of targets) scene.remove(t.group);
  targets.length = 0;
  for (const e of effects) scene.remove(e.obj);
  effects.length = 0;
  for (const d of decals) scene.remove(d);
  decals.length = 0;
  for (const s of shells) viewScene.remove(s.mesh);
  shells.length = 0;
}

function startGame() {
  audio.init(); audio.uiClick();
  clearWorldObjects();
  resetStats();
  timeLeft = duration;
  ammo = weapon.mag; reserve = weapon.reserve;
  recoilPitch = recoilYaw = 0;
  yaw = 0; pitch = 0;
  vm.reloadT = -1; vm.ads = 0; vm.kickZ = 0; vm.kickPitch = 0; vm.kickYaw = 0; vm.kickRoll = 0;
  vm.kickZTarget = 0; vm.kickT = 0; vm.boltCycle = -1;
  vm.returnPose = null; vm.returnT = 0; vm.deployT = DEPLOY_TIME;
  firing = false; adsHeld = false;
  lastShot = 0; bloom = 0; shotStreak = 0;
  nextTargetAt = performance.now() + 250;

  $('start-screen').classList.add('hidden');
  $('pause-screen').classList.add('hidden');
  $('result-screen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('reload-bar').classList.remove('show');
  state = 'playing';
  updateStatsHUD(); updateAmmoHUD();
  $('hud-time').textContent = timeLeft.toFixed(1);
  lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  lockPointer();
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused'; firing = false; adsHeld = false;
  $('pause-screen').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function resumeGame() {
  if (state !== 'paused') return;
  audio.uiClick();
  $('pause-screen').classList.add('hidden');
  state = 'playing';
  lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  lockPointer();
}

function endGame() {
  state = 'result';
  firing = false; adsHeld = false; vm.ads = 0;
  updateScope(false);
  if (document.pointerLockElement) document.exitPointerLock();
  $('hud').classList.add('hidden');
  $('result-screen').classList.remove('hidden');
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  const avg = stats.reactions.length ? Math.round(stats.reactions.reduce((a, b) => a + b, 0) / stats.reactions.length) : 0;
  $('final-score').textContent = stats.score;
  $('final-hits').textContent = `${stats.hits} / ${stats.shots}`;
  $('final-acc').textContent = acc + '%';
  $('final-react').textContent = avg ? avg + ' ms' : '-- ms';
  $('final-combo').textContent = stats.maxCombo;
  $('final-head').textContent = stats.headshots;
  const hitsPerSec = stats.hits / duration;
  const rank = hitsPerSec > 1.1 ? 'S' : hitsPerSec > 0.8 ? 'A' : hitsPerSec > 0.55 ? 'B' : hitsPerSec > 0.3 ? 'C' : 'D';
  $('final-rank').textContent = rank;
}

function toMenu() {
  state = 'menu';
  vm.ads = 0;
  updateScope(false);
  clearWorldObjects();
  $('result-screen').classList.add('hidden');
  $('pause-screen').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('start-screen').classList.remove('hidden');
}

// AWP 盲狙命中判定：仅盲狙（未开镜）且该枪配置了 blindHitRate 时生效
function isBlindMiss(w, ads) {
  return w.blindHitRate != null && !ads && Math.random() > w.blindHitRate;
}

/* ---------------- UI 绑定 ---------------- */
function buildWeaponCards() {
  const grid = $('weapon-grid');
  grid.innerHTML = '';
  for (const [key, w] of Object.entries(WEAPONS)) {
    const card = document.createElement('div');
    card.className = 'weapon-card' + (key === currentWeaponKey ? ' active' : '');
    card.innerHTML = `<div class="wpn-icon"><img src="${w.icon}" alt="${w.name}" /></div><div class="wpn-name">${w.name}</div>
      <div class="wpn-type">${w.label}</div><div class="wpn-meta">${w.meta}</div>`;
    card.addEventListener('click', () => {
      audio.init(); audio.uiClick();
      document.querySelectorAll('.weapon-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      equipWeapon(key);
    });
    grid.appendChild(card);
  }
}
function bindSegmented(id, apply) {
  const parent = $(id);
  parent.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      audio.init(); audio.uiClick();
      parent.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      apply(Number(b.dataset.value));
    });
  });
}

function applySensitivity(v) {
  sensValue = clamp(v, 0.1, 10);
  sensitivity = sensValue * SENS_SCALE;
  $('sens-input').value = sensValue.toFixed(1);
  $('sens-slider').value = sensValue;
  $('sens-edpi').textContent = Math.round(sensValue * 400);
  $('sens-current').textContent = '当前 ' + sensValue.toFixed(1);
  try { localStorage.setItem('aimrange.sens', sensValue.toFixed(1)); } catch (e) {}
}
function applyInvertY(on) {
  invertY = on;
  $('invert-y').checked = on;
  try { localStorage.setItem('aimrange.invertY', on ? '1' : '0'); } catch (e) {}
}
function applyInfiniteAmmo(on) {
  infiniteAmmo = on;
  $('infinite-ammo').checked = on;
  try { localStorage.setItem('aimrange.infiniteAmmo', on ? '1' : '0'); } catch (e) {}
  updateAmmoHUD();
}
function bindSensitivityUI() {
  const slider = $('sens-slider'), input = $('sens-input'), inv = $('invert-y');
  slider.addEventListener('input', () => applySensitivity(parseFloat(slider.value)));
  input.addEventListener('change', () => applySensitivity(parseFloat(input.value) || 2.1));
  input.addEventListener('blur', () => applySensitivity(parseFloat(input.value) || sensValue));
  inv.addEventListener('change', () => applyInvertY(inv.checked));
  $('infinite-ammo').addEventListener('change', (e) => applyInfiniteAmmo(e.target.checked));
  // 初始化为已保存的值
  applySensitivity(sensValue);
  applyInvertY(invertY);
  applyInfiniteAmmo(infiniteAmmo);
}

/* -------- 准星设置 -------- */
function applyCrosshair() {
  const setVars = (el) => {
    if (!el) return;
    el.style.setProperty('--ch-len', chCfg.len + 'px');
    el.style.setProperty('--ch-thick', chCfg.thick + 'px');
    el.style.setProperty('--ch-gap', chCfg.gap + 'px');
    el.style.setProperty('--ch-color', chCfg.color);
    // 轮廓：黑色描边（CS:GO 风格），关闭时为 0
    el.style.setProperty('--ch-outline', chCfg.outline ? '1px' : '0');
    // 中心点、T形（T形隐藏底下一横）
    el.classList.toggle('ch-dot', !!chCfg.dot);
    el.classList.toggle('ch-tshape', !!chCfg.tshape);
  };
  setVars($('crosshair'));
  setVars($('ch-preview-ch'));
  // 面板控件数值回填
  $('ch-len').value = chCfg.len; $('ch-len-val').textContent = chCfg.len;
  $('ch-thick').value = chCfg.thick; $('ch-thick-val').textContent = chCfg.thick;
  $('ch-gap').value = chCfg.gap; $('ch-gap-val').textContent = chCfg.gap;
  $('ch-color-pick').value = chCfg.color;
  $('ch-dot').checked = !!chCfg.dot;
  $('ch-outline').checked = !!chCfg.outline;
  $('ch-tshape').checked = !!chCfg.tshape;
  $('ch-follow').checked = !!chCfg.follow;
  // 色块选中态
  document.querySelectorAll('#ch-colors button').forEach(b => {
    b.classList.toggle('active', b.dataset.color.toLowerCase() === chCfg.color.toLowerCase());
  });
  try { localStorage.setItem('aimrange.crosshair', JSON.stringify(chCfg)); } catch (e) {}
}
function bindCrosshairUI() {
  // 预设色块
  const box = $('ch-colors');
  CH_PRESETS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.style.background = c; b.dataset.color = c;
    b.addEventListener('click', () => { chCfg.color = c; applyCrosshair(); });
    box.appendChild(b);
  });
  const bindNum = (id, key) => {
    $(id).addEventListener('input', () => {
      chCfg[key] = parseInt($(id).value, 10);
      applyCrosshair();
    });
  };
  bindNum('ch-len', 'len');
  bindNum('ch-thick', 'thick');
  bindNum('ch-gap', 'gap');
  $('ch-color-pick').addEventListener('input', () => { chCfg.color = $('ch-color-pick').value; applyCrosshair(); });
  const bindCheck = (id, key) => $(id).addEventListener('change', () => { chCfg[key] = $(id).checked; applyCrosshair(); });
  bindCheck('ch-dot', 'dot');
  bindCheck('ch-outline', 'outline');
  bindCheck('ch-tshape', 'tshape');
  bindCheck('ch-follow', 'follow');
  applyCrosshair();
}

buildWeaponCards();
bindSegmented('duration-options', v => duration = v);
bindSegmented('target-options', v => targetCount = v);
bindSensitivityUI();
bindCrosshairUI();
$('start-btn').addEventListener('click', startGame);
$('resume-btn').addEventListener('click', resumeGame);
$('quit-btn').addEventListener('click', toMenu);
$('again-btn').addEventListener('click', startGame);
$('menu-btn').addEventListener('click', toMenu);

// 如果浏览器不支持/拒绝指针锁定，退化为移动鼠标瞄准
if (!('requestPointerLock' in canvas)) usingPointerLock = false;
document.addEventListener('pointerlockerror', () => { usingPointerLock = false; });

/* ---------------- 主循环 ---------------- */
const clock = new THREE.Clock();
const cross = $('crosshair');
const reloadFill = $('reload-bar').firstElementChild;
let scopeOverlay = null;

function updateScope(active) {
  const scoped = !!(weapon.scope && active);
  if (scoped) {
    if (!scopeOverlay) {
      scopeOverlay = document.createElement('div');
      scopeOverlay.style.cssText = `position:absolute;inset:0;z-index:9;pointer-events:none;
        background:radial-gradient(circle at 50% 50%, transparent 0 31vh, #000 31.2vh 100%);
        display:flex;align-items:center;justify-content:center;`;
      scopeOverlay.innerHTML = `<div style="position:absolute;left:50%;top:50%;width:62vh;height:62vh;transform:translate(-50%,-50%);border:2px solid rgba(0,0,0,.9);border-radius:50%;"></div>
        <div style="position:absolute;left:50%;top:50%;width:100%;height:1px;background:rgba(0,0,0,.85);"></div>
        <div style="position:absolute;left:50%;top:50%;height:100%;width:1px;background:rgba(0,0,0,.85);"></div>
        <div style="position:absolute;left:50%;top:50%;width:8px;height:8px;background:#000;border-radius:50%;"></div>`;
      $('app').appendChild(scopeOverlay);
    }
    cross.style.opacity = '0';
  } else {
    if (scopeOverlay) { scopeOverlay.remove(); scopeOverlay = null; }
    cross.style.opacity = '1';
  }
  return scoped;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const now = performance.now();

  // 视角旋转（后坐力叠加，随后回正）
  const idleNow = state === 'playing' && lastShot > 0 ? now - lastShot : Infinity;
  camera.rotation.set(pitch + recoilPitch, yaw + recoilYaw, 0, 'YXZ');
  if (weapon.pattern) {
    // CS:GO 弹道图：停火 recoverDelay 后才开始回正，recoverTime 内平滑归位；
    // 图案在停火后重置（下一轮扫射从第 1 发开始）
    if (idleNow > weapon.recoverDelay * 1000) {
      const k = 1 - Math.pow(0.0015, dt / weapon.recoverTime);
      recoilPitch = lerp(recoilPitch, 0, k);
      recoilYaw = lerp(recoilYaw, 0, k);
      if (Math.abs(recoilPitch) < 0.0002) recoilPitch = 0;
      if (Math.abs(recoilYaw) < 0.0002) recoilYaw = 0;
      if (recoilPitch === 0 && recoilYaw === 0) shotStreak = 0;
    }
  } else {
    recoilPitch = lerp(recoilPitch, 0, 1 - Math.pow(0.0015, dt));
    recoilYaw = lerp(recoilYaw, 0, 1 - Math.pow(0.002, dt));
  }

  // CS:GO 精度恢复：停火 recoveryDelay 后开始，按 recoveryTime 线性回落到首发精度
  const idleMs = state === 'playing' && lastShot > 0 ? now - lastShot : Infinity;
  if (bloom > 0 && idleMs > weapon.accuracy.delay * 1000) {
    bloom = Math.max(0, bloom - (weapon.accuracy.max / weapon.accuracy.recover) * dt);
    if (bloom === 0 && !weapon.pattern) shotStreak = 0;
  }

  // 持续开火
  if (firing && weapon.auto && state === 'playing') tryShoot();

  if (state === 'playing') {
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; endGame(); }
    $('hud-time').textContent = timeLeft.toFixed(1);

    // 补充靶子
    if (now >= nextTargetAt && targets.length < targetCount) {
      if (spawnTarget()) nextTargetAt = now + 130;
    }
    // 靶子动画
    for (const target of targets) {
      target.scale = lerp(target.scale, 1, 1 - Math.pow(0.00001, dt));
      target.group.scale.setScalar(target.scale);
      // 浮动幅度受限，且最低球心不低于半径+环半径，防止沉入地面
      target.group.position.y = Math.max(TARGET_RADIUS * 1.55, target.base.y + Math.sin(t * 2.2 + target.phase) * 0.07);
      target.ring.rotation.z += dt * 0.35;
      target.ring2.rotation.z -= dt * 0.22;
      const pulse = 1 + Math.sin(t * 4 + target.phase) * 0.06;
      target.core.scale.setScalar(pulse);
    }
    // 自动换弹（无限弹药不换弹）
    if (!infiniteAmmo && ammo === 0 && reserve > 0 && vm.reloadT < 0) startReload();
  }

  // 换弹动画（姿态在视口武器动画段应用）
  vm.reloadPose = null;
  if (vm.reloadT >= 0) {
    const prev = vm.reloadT;
    vm.reloadT += dt;
    const p = Math.min(1, vm.reloadT / weapon.reload);
    reloadFill.style.width = (p * 100) + '%';
    if (prev < weapon.reload * 0.42 && vm.reloadT >= weapon.reload * 0.42) audio.reloadClick(1);
    if (prev < weapon.reload * 0.78 && vm.reloadT >= weapon.reload * 0.78) audio.reloadClick(2);
    if (p >= 1) {
      const need = weapon.mag - ammo;
      const take = Math.min(need, reserve);
      ammo += take; reserve -= take;
      vm.reloadT = -1;
      beginReturn(vm.reloadPose); // 从最后姿态平滑归位，避免瞬间跳回
      vm.reloadPose = null;
      bloom = 0; shotStreak = 0; recoilPitch = 0; recoilYaw = 0;
      vm.kickZTarget = 0; vm.kickT = 0;
      $('reload-bar').classList.remove('show');
      updateAmmoHUD();
    } else {
      vm.reloadPose = reloadPose(currentWeaponKey, p);
    }
  }

  // AWP 开火后自动拉栓推进
  vm.boltPose = null;
  if (vm.boltCycle >= 0) {
    vm.boltCycle += dt;
    const bp = vm.boltCycle / 0.62;
    if (bp >= 1) { beginReturn(vm.boltPose); vm.boltCycle = -1; }
    else vm.boltPose = boltCyclePose(bp);
  }

  // 特效更新
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; e.life -= dt;
    const k = Math.max(0, e.life / e.max);
    if (e.kind === 'burst') {
      for (const p of e.obj.children) {
        p.position.addScaledVector(p.userData.vel, dt);
        p.userData.vel.y -= 6 * dt;
        p.material.opacity = k; p.material.transparent = true;
      }
    } else if (e.kind === 'halo') {
      e.obj.scale.setScalar(1 + (1 - k) * 5);
      e.obj.material.opacity = k * 0.9;
    } else if (e.kind === 'tracer') {
      e.obj.material.opacity = k * 0.85;
    }
    if (e.life <= 0) { scene.remove(e.obj); effects.splice(i, 1); }
  }

  // 弹壳
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i]; s.life -= dt;
    s.mesh.position.addScaledVector(s.mesh.userData.vel, dt);
    s.mesh.userData.vel.y -= 5.5 * dt;
    s.mesh.rotation.x += s.mesh.userData.spin.x * dt;
    s.mesh.rotation.y += s.mesh.userData.spin.y * dt;
    s.mesh.rotation.z += s.mesh.userData.spin.z * dt;
    if (s.life <= 0) { viewScene.remove(s.mesh); shells.splice(i, 1); }
  }

  // 枪口火焰
  if (flashTimer > 0) {
    flashTimer -= dt;
    muzzleFlash.material.opacity = Math.min(1, flashTimer / 0.055);
    muzzleFlash.material.rotation = Math.random() * Math.PI;
    muzzleFlash.scale.setScalar(0.26 + Math.random() * 0.14);
    flashLight.intensity = flashTimer > 0 ? 9 : 0;
  } else { muzzleFlash.material.opacity = 0; flashLight.intensity = 0; }

  // 视口武器动画
  const ads = adsHeld && state === 'playing' && vm.reloadT < 0 ? 1 : 0;
  vm.ads = lerp(vm.ads, ads, 1 - Math.pow(0.0008, dt));
  vm.swayX = lerp(vm.swayX, 0, 1 - Math.pow(0.0001, dt));
  vm.swayY = lerp(vm.swayY, 0, 1 - Math.pow(0.0001, dt));
  // 枪模上抬/横摆/侧倾 = 相机 view punch 的视觉映射（CS:GO viewmodel_recoil）。
  // 二者同源，枪口指向永远与弹道一致；系数 <1 让枪口略低于准星抬升（与 CS2 录屏一致）。
  // recoilPitch/recoilYaw 自身在视角段已按 recoverDelay/recoverTime 平滑回正，枪模跟随即可。
  const VM_RECOIL = 0.82;   // 枪模抬升 = 视角后坐 × 0.82（不再独立累加到 0.36rad）
  const follow = 1 - Math.pow(0.00002, dt);
  vm.kickPitch = lerp(vm.kickPitch, recoilPitch * VM_RECOIL, follow);
  vm.kickYaw = lerp(vm.kickYaw, recoilYaw * VM_RECOIL, follow);
  vm.kickRoll = lerp(vm.kickRoll, recoilYaw * 0.28, follow);

  // 沿枪轴后坐后移：停火后按数据表恢复时间归位（只位移，不改变枪口指向）
  const fireGap = weapon.fireInterval ?? (60000 / weapon.rpm / 1000);
  const recT = weapon.recoveryTime ?? weapon.accuracy.recover;
  vm.kickT += dt;
  if (vm.kickT > fireGap * 2) {
    const k = 1 - Math.pow(0.01, dt / recT);
    vm.kickZTarget = lerp(vm.kickZTarget, 0, k);
    if (vm.kickZTarget < 0.0002) vm.kickZTarget = 0;
  }
  vm.kickZ = lerp(vm.kickZ, vm.kickZTarget, follow);
  vm.bob = Math.sin(t * 1.7) * 0.0035;

  const adsPos = weapon.scope ? new THREE.Vector3(0.055, -0.135, -0.36) : new THREE.Vector3(0.015, -0.205, -0.46);
  const basePos = vmBase.clone();
  const targetPos = basePos.lerp(adsPos, vm.ads);
  targetPos.x += vm.swayX; targetPos.y += vm.swayY + vm.bob; targetPos.z += vm.kickZ;

  // 换弹 / 拉栓姿态（优先换弹，其次开火拉栓），动作结束后由 returnPose 平滑归位
  let RP = vm.reloadPose || (vm.boltPose ? {
    roll: vm.boltPose.roll, pitch: 0, dropY: 0,
    magY: 0, magZ: 0, magRot: 0, slideZ: 0,
    boltZ: vm.boltPose.boltZ, handleRot: vm.boltPose.handleRot,
    leftX: 0, leftY: vm.boltPose.leftY, leftZ: vm.boltPose.leftZ, leftRot: 0,
    rightY: 0, shake: 0
  } : null);
  if (!RP && vm.returnT > 0) {
    vm.returnT = Math.max(0, vm.returnT - dt);
    const k = vm.returnT / RETURN_TIME;
    RP = vm.returnPose ? scalePose(vm.returnPose, k * k * (3 - 2 * k)) : null;
    if (vm.returnT <= 0) vm.returnPose = null;
  }

  // 切枪取出（deploy）：从下方/后方抬起回正，模拟 CS:GO 的 weapon deploy 过渡
  let deployK = 0;
  if (vm.deployT > 0) {
    vm.deployT = Math.max(0, vm.deployT - dt);
    const p = 1 - vm.deployT / DEPLOY_TIME;
    deployK = 1 - p * p * (3 - 2 * p);
  }

  targetPos.y -= RP ? RP.dropY : 0;
  targetPos.y -= deployK * 0.30;
  targetPos.z += deployK * 0.16;
  weaponGroup.position.lerp(targetPos, 1 - Math.pow(0.00001, dt));
  weaponGroup.rotation.set(
    vmRot.x + vm.kickPitch + deployK * 0.38 + vm.swayY * 0.7 + (RP ? RP.pitch : 0),
    vmRot.y - vm.ads * vmRot.y + vm.kickYaw,
    vmRot.z + vm.kickRoll + deployK * -0.30 + vm.swayX * 0.6 + (RP ? RP.roll : 0) + (RP ? RP.shake * Math.sin(t * 90) : 0),
    'YXZ'
  );

  // 枪焰与枪口灯光跟随当前枪口（含 sway、后坐、上抬、ADS、换弹姿态）
  const muzzleScene = weaponGroup.localToWorld(weaponGroup.userData.muzzle.clone());
  muzzleFlash.position.copy(muzzleScene);
  flashLight.position.copy(muzzleScene);

  // 可动部件：弹匣 / 套筒 / 枪机 / 拉柄
  const P = weaponGroup.userData.parts || {};
  if (P.mag) {
    P.mag.position.y = RP ? RP.magY : 0;
    P.mag.position.z = RP ? RP.magZ : 0;
    P.mag.rotation.z = RP ? RP.magRot : 0;
  }
  if (P.slide) P.slide.position.z = RP ? RP.slideZ : 0;   // USP 套筒
  if (P.bolt) P.bolt.position.z = RP ? RP.boltZ : 0;       // AWP 枪机
  if (P.handle) {
    if (currentWeaponKey === 'awp') P.handle.rotation.z = RP ? RP.handleRot : 0;
    else P.handle.position.z = RP ? RP.slideZ : 0;         // AK / M4 拉机柄后拉
  }

  // 手部动画：跟随枪身，同时左手做够弹匣/拍击/拉栓的相对位移
  const H = weaponGroup.userData.hands;
  if (H) {
    const lb = H.userData.leftBase, rb = H.userData.rightBase;
    // 手部部分抵消枪身换弹倾斜，避免整条手臂跟着枪甩出画面
    H.rotation.set(-(RP ? RP.pitch : 0) * 0.45, 0, -(RP ? RP.roll : 0) * 0.55);
    H.userData.left.position.set(
      lb.x + (RP ? RP.leftX : 0),
      lb.y + (RP ? RP.leftY : 0),
      lb.z + (RP ? RP.leftZ : 0)
    );
    H.userData.left.rotation.z = H.userData.left.rotation.x = RP ? RP.leftRot : 0;
    H.userData.right.position.y = rb.y + (RP ? RP.rightY : 0);
  }

  // FOV
  const targetFov = THREE.MathUtils.lerp(75, weapon.adsFov, vm.ads);
  camera.fov = lerp(camera.fov, targetFov, 1 - Math.pow(0.0005, dt));
  camera.updateProjectionMatrix();
  const scoped = updateScope(weapon.scope && vm.ads > 0.7);

  // 准星间距：跟随后坐力开启时按散布张开（CS:GO 动态准星），关闭时保持面板设定的静态间距
  if (chCfg.follow) {
    const curSpread = weapon.accuracy.base + bloom;
    const gap = clamp(chCfg.gap + curSpread * 340 + vm.kickZ * 40 + (adsHeld ? -2 : 0), 0, 30);
    cross.style.setProperty('--ch-gap', gap.toFixed(1) + 'px');
  } else {
    cross.style.setProperty('--ch-gap', chCfg.gap + 'px');
  }

  renderer.clear();
  renderer.render(scene, camera);
  // 开镜时隐藏武器视图模型（枪身/镜筒会挡住瞄准镜圆形视野），与 CS:GO 一致：镜内只见场景
  if (!scoped) {
    renderer.clearDepth();
    renderer.render(viewScene, viewCamera);
  }
}

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  viewCamera.aspect = w / h; viewCamera.updateProjectionMatrix();
});

equipWeapon('ak47');
animate();
