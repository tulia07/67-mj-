import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 程序化人形角色：19 根骨骼 + 分段装甲蒙皮 + 由姿态函数烘焙出的 AnimationClip。
 * 不依赖任何外部模型文件，离线可用；两个性别预设共用同一骨架与状态机。
 */

const BONE_DEFS = [
  // name, parent, position
  ['hips', null, [0, 0.98, 0]],
  ['spine', 'hips', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.2, 0]],
  ['neck', 'chest', [0, 0.2, 0]],
  ['head', 'neck', [0, 0.1, 0]],
  ['shoulderL', 'chest', [-0.1, 0.14, 0]],
  ['upperArmL', 'shoulderL', [-0.1, -0.04, 0]],
  ['foreArmL', 'upperArmL', [0, -0.27, 0]],
  ['handL', 'foreArmL', [0, -0.25, 0]],
  ['shoulderR', 'chest', [0.1, 0.14, 0]],
  ['upperArmR', 'shoulderR', [0.1, -0.04, 0]],
  ['foreArmR', 'upperArmR', [0, -0.27, 0]],
  ['handR', 'foreArmR', [0, -0.25, 0]],
  ['thighL', 'hips', [-0.095, -0.04, 0]],
  ['shinL', 'thighL', [0, -0.43, 0]],
  ['footL', 'shinL', [0, -0.4, 0]],
  ['thighR', 'hips', [0.095, -0.04, 0]],
  ['shinR', 'thighR', [0, -0.43, 0]],
  ['footR', 'shinR', [0, -0.4, 0]],
];

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;

/** 姿态函数：返回 { boneName: [rx, ry, rz] } 与可选 hipsY 偏移 */
const POSES = {
  idle(t) {
    const b = sin(t * 1.6) * 0.03;
    return {
      hipsY: sin(t * 1.6) * 0.012,
      spine: [0.02 + b * 0.4, sin(t * 0.7) * 0.03, 0],
      chest: [0.02, 0, sin(t * 1.1) * 0.02],
      neck: [b * 0.6, sin(t * 0.5) * 0.12, 0],
      head: [-b * 0.4, sin(t * 0.45) * 0.16, 0],
      upperArmL: [0.06, 0, 0.16 + b],
      upperArmR: [0.06, 0, -0.16 - b],
      foreArmL: [-0.24, 0, 0],
      foreArmR: [-0.24, 0, 0],
      thighL: [0.02, 0, 0.03],
      thighR: [-0.02, 0, -0.03],
      shinL: [0.05, 0, 0],
      shinR: [0.05, 0, 0],
    };
  },
  run(t, speed = 1) {
    const p = t * TAU;
    const s = 0.92;
    const swing = sin(p);
    const swing2 = sin(p + Math.PI);
    return {
      hipsY: Math.abs(sin(p * 2)) * 0.055 - 0.03,
      hips: [0.06, sin(p) * 0.1, 0],
      spine: [0.22, sin(p) * 0.1, 0],
      chest: [0.06, -sin(p) * 0.16, 0],
      neck: [-0.18, 0, 0],
      head: [-0.08, sin(p) * 0.05, 0],
      shoulderL: [0, 0, 0.1],
      shoulderR: [0, 0, -0.1],
      upperArmL: [swing2 * 0.85, 0, 0.18],
      upperArmR: [swing * 0.85, 0, -0.18],
      foreArmL: [-1.15 - Math.max(0, swing2) * 0.35, 0, 0],
      foreArmR: [-1.15 - Math.max(0, swing) * 0.35, 0, 0],
      thighL: [swing * s, 0, 0.02],
      thighR: [swing2 * s, 0, -0.02],
      shinL: [-Math.max(0, -swing) * 1.5 - 0.16, 0, 0],
      shinR: [-Math.max(0, -swing2) * 1.5 - 0.16, 0, 0],
      footL: [Math.max(0, swing) * 0.35, 0, 0],
      footR: [Math.max(0, swing2) * 0.35, 0, 0],
    };
  },
  sprint(t) {
    const base = POSES.run(t);
    base.spine = [0.42, sin(t * TAU) * 0.12, 0];
    base.neck = [-0.3, 0, 0];
    base.upperArmL = [Math.sin(t * TAU + Math.PI) * 1.15, 0, 0.24];
    base.upperArmR = [Math.sin(t * TAU) * 1.15, 0, -0.24];
    return base;
  },
  jump(t) {
    const k = Math.min(1, t * 3.2);
    return {
      hipsY: -0.12 + k * 0.1,
      spine: [0.12, 0, 0],
      upperArmL: [-1.5 * k, 0, 0.35],
      upperArmR: [-1.5 * k, 0, -0.35],
      foreArmL: [-0.5, 0, 0],
      foreArmR: [-0.5, 0, 0],
      thighL: [-0.7 * k, 0, 0.08],
      thighR: [-0.45 * k, 0, -0.08],
      shinL: [1.1 * k, 0, 0],
      shinR: [0.6 * k, 0, 0],
      footL: [0.3, 0, 0],
      footR: [0.2, 0, 0],
    };
  },
  fall(t) {
    const w = sin(t * TAU) * 0.12;
    return {
      hips: [-0.1, 0, 0],
      spine: [-0.06, w * 0.4, 0],
      head: [0.16, w, 0],
      upperArmL: [-2.1 + w, 0, 0.55],
      upperArmR: [-2.0 - w, 0, -0.55],
      foreArmL: [-0.45, 0, 0],
      foreArmR: [-0.45, 0, 0],
      thighL: [-0.55 - w * 0.6, 0, 0.12],
      thighR: [-0.2 + w * 0.6, 0, -0.12],
      shinL: [1.25, 0, 0],
      shinR: [0.55, 0, 0],
      footL: [0.25, 0, 0],
      footR: [0.25, 0, 0],
    };
  },
  swing(t) {
    const p = t * TAU;
    const sway = sin(p);
    return {
      hipsY: sway * 0.03,
      hips: [0.12, sway * 0.16, sway * 0.08],
      spine: [-0.12, sway * 0.2, 0],
      chest: [-0.05, sway * 0.18, 0],
      neck: [0.1, -sway * 0.15, 0],
      head: [0.18, -sway * 0.1, 0],
      upperArmR: [-2.75, 0, -0.28],
      foreArmR: [-0.18, 0, 0],
      handR: [0.2, 0, 0],
      upperArmL: [-0.7, 0, 1.05 + sway * 0.12],
      foreArmL: [-0.85, 0, 0],
      thighL: [0.5 + sway * 0.2, 0, 0.09],
      thighR: [0.28 - sway * 0.2, 0, -0.09],
      shinL: [-0.55, 0, 0],
      shinR: [-0.8, 0, 0],
      footL: [0.2, 0, 0],
      footR: [0.3, 0, 0],
    };
  },
  reel(t) {
    const p = t * TAU;
    return {
      hips: [-0.55, 0, 0],
      spine: [0.1, sin(p) * 0.1, 0],
      chest: [0.15, 0, 0],
      neck: [-0.35, 0, 0],
      head: [-0.25, 0, 0],
      upperArmR: [-2.9, 0, -0.1],
      foreArmR: [-1.15, 0, 0],
      upperArmL: [-2.6, 0, 0.2],
      foreArmL: [-1.1, 0, 0],
      thighL: [0.95, 0, 0.1],
      thighR: [0.75, 0, -0.1],
      shinL: [-1.35, 0, 0],
      shinR: [-1.15, 0, 0],
      footL: [0.35, 0, 0],
      footR: [0.35, 0, 0],
    };
  },
  dive(t) {
    const p = t * TAU;
    const w = sin(p) * 0.05;
    return {
      hips: [-1.15, 0, w],
      spine: [-0.15, 0, w * 0.6],
      chest: [-0.1, 0, 0],
      neck: [0.55, 0, 0],
      head: [0.45, 0, 0],
      upperArmL: [0.55, 0, 1.15],
      upperArmR: [0.55, 0, -1.15],
      foreArmL: [-0.3, 0, 0],
      foreArmR: [-0.3, 0, 0],
      thighL: [-0.2, 0, 0.06],
      thighR: [-0.2, 0, -0.06],
      shinL: [0.35, 0, 0],
      shinR: [0.35, 0, 0],
      footL: [-0.25, 0, 0],
      footR: [-0.25, 0, 0],
    };
  },
  glide(t) {
    const w = sin(t * TAU) * 0.08;
    return {
      hips: [0.35, 0, w],
      spine: [0.1, 0, w * 0.5],
      neck: [-0.45, 0, 0],
      head: [-0.3, 0, 0],
      upperArmL: [-0.15, 0, 1.45],
      upperArmR: [-0.15, 0, -1.45],
      foreArmL: [-0.1, 0, 0.15],
      foreArmR: [-0.1, 0, -0.15],
      thighL: [0.18, 0, 0.04],
      thighR: [0.12, 0, -0.04],
      shinL: [-0.2, 0, 0],
      shinR: [-0.14, 0, 0],
      footL: [-0.2, 0, 0],
      footR: [-0.2, 0, 0],
    };
  },
  wallrun(t, side = 1) {
    const base = POSES.run(t);
    base.hips = [0.1, 0, -0.42 * side];
    base.spine = [0.2, 0, 0.18 * side];
    base.upperArmL = [Math.sin(t * TAU + Math.PI) * 1.0, 0, 0.5];
    base.upperArmR = [Math.sin(t * TAU) * 1.0, 0, -0.5];
    return base;
  },
  walljump(t) {
    const base = POSES.jump(t);
    base.hips = [0, 0, 0.35];
    return base;
  },
  land(t) {
    const k = Math.min(1, t * 4.0);
    const settle = Math.max(0, 1 - t * 2.6);
    return {
      hipsY: -0.42 * settle,
      hips: [0.1, 0, 0],
      spine: [0.4 * settle, 0, 0],
      chest: [0.1 * settle, 0, 0],
      neck: [-0.3 * settle, 0, 0],
      head: [-0.2 * settle, 0, 0],
      upperArmL: [-0.5 * k, 0, 0.9 * settle + 0.2],
      upperArmR: [-0.5 * k, 0, -0.9 * settle - 0.2],
      foreArmL: [-0.6, 0, 0],
      foreArmR: [-0.6, 0, 0],
      thighL: [-0.95 * settle, 0, 0.16],
      thighR: [-0.8 * settle, 0, -0.16],
      shinL: [1.7 * settle, 0, 0],
      shinR: [1.45 * settle, 0, 0],
      footL: [0.5 * settle, 0, 0],
      footR: [0.45 * settle, 0, 0],
    };
  },
  zip(t) {
    const w = sin(t * TAU) * 0.1;
    return {
      hips: [-0.3, 0, 0],
      spine: [0.05, 0, 0],
      neck: [-0.2, 0, 0],
      upperArmL: [-2.45, 0, 0.28],
      upperArmR: [-2.55, 0, -0.2],
      foreArmL: [-0.5, 0, 0],
      foreArmR: [-0.35, 0, 0],
      thighL: [0.55 + w, 0, 0.1],
      thighR: [0.4 - w, 0, -0.1],
      shinL: [-0.8, 0, 0],
      shinR: [-0.65, 0, 0],
      footL: [0.3, 0, 0],
      footR: [0.3, 0, 0],
    };
  },
};

const CLIP_DEFS = [
  { name: 'idle', pose: POSES.idle, duration: 3.2, frames: 24, loop: true },
  { name: 'run', pose: (t) => POSES.run(t), duration: 0.72, frames: 16, loop: true },
  { name: 'sprint', pose: POSES.sprint, duration: 0.62, frames: 16, loop: true },
  { name: 'jump', pose: POSES.jump, duration: 0.42, frames: 12, loop: false },
  { name: 'fall', pose: POSES.fall, duration: 0.9, frames: 16, loop: true },
  { name: 'swing', pose: POSES.swing, duration: 1.5, frames: 24, loop: true },
  { name: 'reel', pose: POSES.reel, duration: 1.1, frames: 18, loop: true },
  { name: 'dive', pose: POSES.dive, duration: 1.0, frames: 16, loop: true },
  { name: 'glide', pose: POSES.glide, duration: 1.6, frames: 20, loop: true },
  { name: 'wallrun', pose: (t) => POSES.wallrun(t, 1), duration: 0.6, frames: 14, loop: true },
  { name: 'wallrunL', pose: (t) => POSES.wallrun(t, -1), duration: 0.6, frames: 14, loop: true },
  { name: 'walljump', pose: POSES.walljump, duration: 0.4, frames: 12, loop: false },
  { name: 'land', pose: POSES.land, duration: 0.5, frames: 14, loop: false },
  { name: 'zip', pose: POSES.zip, duration: 0.8, frames: 16, loop: true },
];

function buildClip(def, boneNames) {
  const frames = def.frames;
  const times = [];
  const values = new Map();
  for (const n of boneNames) values.set(n, []);
  const hipsY = [];

  for (let f = 0; f <= frames; f++) {
    const t = def.loop ? f / frames : (f / frames) * 0.999;
    times.push(t * def.duration);
    const pose = def.pose(t);
    for (const name of boneNames) {
      const e = pose[name] || [0, 0, 0];
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ'));
      values.get(name).push(q.x, q.y, q.z, q.w);
    }
    hipsY.push(pose.hipsY || 0);
  }

  const tracks = [];
  for (const name of boneNames) {
    tracks.push(new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, values.get(name)));
  }
  const hipsDef = BONE_DEFS.find((b) => b[0] === 'hips');
  const posValues = [];
  for (let f = 0; f <= frames; f++) {
    posValues.push(hipsDef[2][0], hipsDef[2][1] + hipsY[f], hipsDef[2][2]);
  }
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, posValues));
  return new THREE.AnimationClip(def.name, def.duration, tracks);
}

const SUIT_PARTS = [
  // name在上；几何尺寸按骨骼分段
  ['hips', [0.32, 0.22, 0.21], [0, -0.02, 0], 'suit'],
  ['spine', [0.31, 0.24, 0.2], [0, 0.06, 0], 'suit'],
  ['chest', [0.4, 0.3, 0.23], [0, 0.05, 0], 'suit'],
  ['neck', [0.11, 0.09, 0.11], [0, 0.02, 0], 'dark'],
  ['head', [0.2, 0.235, 0.215], [0, 0.1, 0], 'skin'],
  ['head', [0.205, 0.075, 0.22], [0, 0.115, 0.012], 'accent'],  // 面罩
  ['head', [0.215, 0.09, 0.22], [0, 0.2, -0.01], 'hair'],
  ['upperArmL', [0.115, 0.29, 0.115], [0, -0.1, 0], 'suit'],
  ['upperArmR', [0.115, 0.29, 0.115], [0, -0.1, 0], 'suit'],
  ['foreArmL', [0.1, 0.26, 0.1], [0, -0.11, 0], 'dark'],
  ['foreArmR', [0.1, 0.26, 0.1], [0, -0.11, 0], 'dark'],
  ['foreArmL', [0.108, 0.055, 0.108], [0, -0.2, 0], 'accent'],
  ['foreArmR', [0.108, 0.055, 0.108], [0, -0.2, 0], 'accent'],
  ['handL', [0.09, 0.12, 0.08], [0, -0.05, 0], 'dark'],
  ['handR', [0.09, 0.12, 0.08], [0, -0.05, 0], 'dark'],
  ['thighL', [0.155, 0.42, 0.16], [0, -0.19, 0], 'suit'],
  ['thighR', [0.155, 0.42, 0.16], [0, -0.19, 0], 'suit'],
  ['shinL', [0.125, 0.4, 0.135], [0, -0.18, 0], 'dark'],
  ['shinR', [0.125, 0.4, 0.135], [0, -0.18, 0], 'dark'],
  ['shinL', [0.132, 0.06, 0.14], [0, -0.05, 0], 'accent'],
  ['shinR', [0.132, 0.06, 0.14], [0, -0.05, 0], 'accent'],
  ['footL', [0.13, 0.09, 0.27], [0, -0.03, 0.07], 'dark'],
  ['footR', [0.13, 0.09, 0.27], [0, -0.03, 0.07], 'dark'],
  ['chest', [0.34, 0.1, 0.245], [0, 0.14, 0], 'accent'],   // 胸甲灯带
  ['spine', [0.26, 0.035, 0.21], [0, 0.02, 0], 'accent'],
  ['hips', [0.26, 0.05, 0.215], [0, -0.08, 0], 'accent2'],
];

function makeSkinnedGeometry(bones, boneIndex, variant) {
  const skinParts = { solid: [], accent: [] };
  const colors = {
    suit: new THREE.Color(variant.suit),
    dark: new THREE.Color(variant.suitDark),
    skin: new THREE.Color(variant.skin),
    hair: new THREE.Color(variant.hair),
    accent: new THREE.Color(variant.accent).multiplyScalar(1.6),
    accent2: new THREE.Color(variant.accent2).multiplyScalar(1.6),
  };
  const shoulderScale = variant.shoulder;
  const heightScale = variant.heightScale;
  const m4 = new THREE.Matrix4();
  const tmp = new THREE.Vector3();

  for (const [boneName, size, offset, matKey] of SUIT_PARTS) {
    const bone = bones[boneIndex.get(boneName)];
    bone.updateWorldMatrix(true, false);
    bone.getWorldPosition(tmp);
    // 使用未缩放的局部坐标再缩放整体
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    if (boneName.includes('Arm') || boneName.includes('shoulder')) {
      g.scale(shoulderScale, 1, 1);
    }
    const px = tmp.x + offset[0] * (boneName.includes('Arm') ? shoulderScale : 1);
    const py = tmp.y + offset[1];
    const pz = tmp.z + offset[2];
    g.translate(px, py, pz);

    const c = colors[matKey];
    const count = g.attributes.position.count;
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const idx = boneIndex.get(boneName);
    const si = new Uint16Array(count * 4);
    const sw = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      si[i * 4] = idx;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));

    if (matKey === 'accent' || matKey === 'accent2') skinParts.accent.push(g);
    else skinParts.solid.push(g);
  }

  const out = {};
  for (const key of ['solid', 'accent']) {
    const merged = mergeGeometries(skinParts[key], false);
    skinParts[key].forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    out[key] = merged;
  }
  return out;
}

export class AnimStateMachine {
  constructor(character) {
    this.character = character;
    this.current = null;
    this.time = 0;
    this.stateTime = 0;
    this.locked = 0;
  }
  set(state, opts = {}) {
    const fade = opts.fade !== undefined ? opts.fade : 0.18;
    if (state === this.current && !opts.force) {
      if (opts.timeScale !== undefined) this.character.setTimeScale(opts.timeScale);
      return false;
    }
    this.character.play(state, fade, opts.reset);
    this.current = state;
    this.stateTime = 0;
    if (opts.timeScale !== undefined) this.character.setTimeScale(opts.timeScale);
    return true;
  }
  update(dt) {
    this.stateTime += dt;
    this.character.update(dt);
  }
}

export class Character {
  constructor(variant) {
    this.variant = variant;
    this.group = new THREE.Group();
    this.group.name = 'Character_' + variant.id;
    this.group.scale.setScalar(variant.heightScale);
    this.bones = [];
    this.boneIndex = new Map();
    this._buildSkeleton();
    this._buildMesh();
    this.mixer = new THREE.AnimationMixer(this.group);
    this.actions = new Map();
    this.clips = new Map();
    this._buildClips();
    this.currentAction = null;
    this.timeScale = 1;
    this.play('idle', 0);
  }

  _buildSkeleton() {
    for (const [name, parent, pos] of BONE_DEFS) {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.set(pos[0], pos[1], pos[2]);
      this.bones.push(bone);
      this.boneIndex.set(name, this.bones.length - 1);
      if (parent) {
        this.bones[this.boneIndex.get(parent)].add(bone);
      } else {
        this.group.add(bone);
      }
    }
    this.group.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.skeleton.calculateInverses();
  }

  _buildMesh() {
    const geos = makeSkinnedGeometry(this.bones, this.boneIndex, this.variant);
    // 没有环境贴图时金属度过高会发黑，压到很低保证补光下能看清装甲
    const solidMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.08,
      roughness: 0.52,
      emissive: new THREE.Color(0x18222f),
      emissiveIntensity: 1.0,
    });
    const accentMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
    });
    this.solidMesh = new THREE.SkinnedMesh(geos.solid, solidMat);
    this.solidMesh.castShadow = true;
    this.solidMesh.frustumCulled = false;
    this.accentMesh = new THREE.SkinnedMesh(geos.accent, accentMat);
    this.accentMesh.frustumCulled = false;
    this.group.add(this.solidMesh, this.accentMesh);
    this.solidMesh.bind(this.skeleton);
    this.accentMesh.bind(this.skeleton);
    this.group.updateMatrixWorld(true);
  }

  _buildClips() {
    const names = BONE_DEFS.map((b) => b[0]);
    for (const def of CLIP_DEFS) {
      const clip = buildClip(def, names);
      this.clips.set(def.name, clip);
      const action = this.mixer.clipAction(clip);
      action.loop = def.loop ? THREE.LoopRepeat : THREE.LoopOnce;
      action.clampWhenFinished = !def.loop;
      this.actions.set(def.name, action);
    }
  }

  play(name, fade = 0.16, reset = false) {
    const next = this.actions.get(name) || this.actions.get('idle');
    if (!next) return;
    if (this.currentAction === next && !reset) {
      // 一次性动作（落地/起跳）播完后允许再次触发
      if (next.loop === THREE.LoopOnce && next.time >= next.getClip().duration - 1e-3) {
        next.reset();
        next.setEffectiveTimeScale(this.timeScale);
        next.play();
      }
      return;
    }
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(this.timeScale);
    if (this.currentAction && this.currentAction !== next) {
      next.crossFadeFrom(this.currentAction, fade, true);
    }
    next.play();
    this.currentAction = next;
    this.currentName = name;
  }

  setTimeScale(s) {
    this.timeScale = Math.max(0.05, s);
    if (this.currentAction) this.currentAction.setEffectiveTimeScale(this.timeScale);
  }

  update(dt) {
    this.mixer.update(dt);
  }

  /** 右手骨骼的世界坐标（蛛丝起点） */
  getHandWorld(target) {
    const i = this.boneIndex.get('handR');
    if (i == null) {
      target.copy(this.group.position);
      target.y += 1.15;
      return target;
    }
    this.group.updateMatrixWorld(true);
    return this.bones[i].getWorldPosition(target);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.solidMesh.geometry.dispose();
    this.accentMesh.geometry.dispose();
    this.solidMesh.material.dispose();
    this.accentMesh.material.dispose();
    this.group.removeFromParent();
  }
}
