import * as THREE from 'three';
import { TUNING, WORLD } from '../config.js';
import { capsuleBox, segmentBlocked, clamp, projectToRope } from '../physics/Collision.js';

const V = () => new THREE.Vector3();
const TMP = {
  a: V(), b: V(), c: V(), d: V(), n: V(), wish: V(), tmp2: V(),
};

/**
 * 第三人称移动控制器。
 * 状态：idle / run / air / swing / zip / glide / dive / wallrun / land
 * 关键保证：
 *  - 高速分步积分（每步 ≤0.4m）防止穿模
 *  - 胶囊 vs AABB 迭代解算，最多 4 次，仍重叠则触发救援
 *  - 摆荡为刚性绳长约束（投影位置 + 去除径向速度）
 */
export class PlayerController {
  constructor(plan, quality) {
    this.plan = plan;
    this.quality = quality;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.state = 'air';
    this.grounded = false;
    this.radius = TUNING.capsule.radius;
    this.height = TUNING.capsule.height;

    this.rope = { active: false, anchor: new THREE.Vector3(), length: 0 };
    this.ropeAnchorId = -1;
    this.wallNormal = new THREE.Vector3();
    this.wallContact = 0;
    this.wallSide = 1;
    this.wallTimer = 0;

    this.landTimer = 0;
    this.attachCooldown = 0;
    this.airTime = 0;
    this.zipTimer = 0;
    this.zipTarget = new THREE.Vector3();

    this.targetAnchor = null;
    this.anchorTimer = 0;
    this.anchorCandidates = [];
    this.boxesNear = [];
    this._seenBoxes = new Set();

    this.flow = 0;
    this.flowTimer = 0;
    this.swingCount = 0;
    this.distance = 0;
    this.maxSpeed = 0;
    this.landCount = 0;
    this.wallRunCount = 0;
    this.stuckTime = 0;
    this.lastImpact = 0;
    this.camYaw = 0;
    this.events = [];
    this.rescueCount = 0;

    this.character = null;
    this.anim = null;
    this.groundY = 0;

    // 空间索引（碰撞体在 City 初始化时注入）
    this.boxHash = new (class {
      constructor(cell) { this.cell = cell; this.map = new Map(); this.items = []; }
      key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
      add(b) {
        const id = this.items.length;
        this.items.push(b);
        const c = this.cell;
        for (let ix = Math.floor(b.min.x / c); ix <= Math.floor(b.max.x / c); ix++) {
          for (let iz = Math.floor(b.min.z / c); iz <= Math.floor(b.max.z / c); iz++) {
            const k = this.key(ix, iz);
            let arr = this.map.get(k);
            if (!arr) { arr = []; this.map.set(k, arr); }
            arr.push(id);
          }
        }
      }
      query(x, z, r, out) {
        out.length = 0;
        const c = this.cell;
        const seen = new Set();
        for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++) {
          for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
            const arr = this.map.get(this.key(ix, iz));
            if (!arr) continue;
            for (const id of arr) {
              if (seen.has(id)) continue;
              seen.add(id);
              out.push(this.items[id]);
            }
          }
        }
        return out;
      }
    })(40);

    this.anchorHash = new (class {
      constructor(cell) { this.cell = cell; this.map = new Map(); }
      key(ix, iz) { return ix * 92837111 ^ iz * 689287499; }
      add(a) {
        const k = this.key(Math.floor(a.x / this.cell), Math.floor(a.z / this.cell));
        let arr = this.map.get(k);
        if (!arr) { arr = []; this.map.set(k, arr); }
        arr.push(a);
      }
      query(x, z, r, out) {
        out.length = 0;
        const c = this.cell;
        for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++) {
          for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
            const arr = this.map.get(this.key(ix, iz));
            if (!arr) continue;
            for (const a of arr) out.push(a);
          }
        }
        return out;
      }
    })(64);

    this.tmpBoxes = [];
  }

  attachWorld(boxes, anchors) {
    for (const b of boxes) this.boxHash.add(b);
    this.boxes = boxes;
    for (const a of anchors) this.anchorHash.add(a);
    this.anchors = anchors;
  }

  reset(spawn) {
    this.pos.set(spawn.x, spawn.y + 0.2, spawn.z);
    this.vel.set(0, 0, 0);
    this.state = 'idle';
    this.grounded = false;
    this.rope.active = false;
    this.landTimer = 0;
    this.airTime = 0;
    this.flow = 0;
    this.flowTimer = 0;
    this.attachCooldown = 0;
    this.zipTimer = 0;
    if (this.character) {
      this.character.group.position.copy(this.pos);
      this.anim.set('idle', { fade: 0.1, force: true });
    }
  }

  emit(type, data) {
    this.events.push({ type, data });
    if (this.events.length > 24) this.events.shift();
  }

  drainEvents(cb) {
    for (const e of this.events) cb(e.type, e.data);
    this.events.length = 0;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get totalSpeed() {
    return this.vel.length();
  }
  get altitude() {
    return this.pos.y;
  }

  update(dt, input, camYaw, cameraDir) {
    dt = Math.min(dt, 1 / 30);
    this.input = input;
    this.camYaw = camYaw;
    const T = TUNING;

    // 摄像机朝向的地面投影
    const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
    const rightX = Math.cos(camYaw), rightZ = -Math.sin(camYaw);
    const ix = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    const iz = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    const wish = TMP.wish.set(fwdX * iz + rightX * ix, 0, fwdZ * iz + rightZ * ix);
    if (wish.lengthSq() > 1) wish.normalize();

    this.attachCooldown = Math.max(0, this.attachCooldown - dt);
    this.anchorTimer -= dt;

    // 挂点搜索（预判准星）
    if (this.anchorTimer <= 0) {
      this.anchorTimer = 0.1;
      this.targetAnchor = this.findAnchor(cameraDir);
    }

    const sprint = input.isDown('reel');
    const jumpPressed = input.pressed('jump');
    const swingHeld = input.isDown('swing');

    // ---------- 摆荡挂接 / 释放 ----------
    if (swingHeld && this.attachCooldown <= 0 && this.state !== 'zip' && !this.rope.active) {
      this.tryAttach();
    }
    if (!swingHeld && this.rope.active) this.releaseSwing();

    // ---------- 右键牵引 ----------
    if (input.pressed('zip') && this.state !== 'zip') {
      if (this.tryZip()) this.emit('zip', { anchor: this.zipTarget.clone() });
      else this.emit('noAnchor', { reason: 'zip' });
    }

    // ---------- 状态推进 ----------
    switch (this.state) {
      case 'land':
        this.landTimer -= dt;
        this.applyGroundFriction(dt, 7);
        if (wish.lengthSq() > 0.01) {
          this.vel.x += wish.x * 14 * dt;
          this.vel.z += wish.z * 14 * dt;
        }
        this.vel.y -= 32 * dt;
        if (jumpPressed) {
          this.jump();
        } else if (this.landTimer <= 0) {
          this.setGroundState(wish);
        }
        break;

      case 'swing':
        this.swingPhysics(dt, wish, sprint, jumpPressed);
        break;

      case 'zip':
        this.zipTimer -= dt;
        this.zipPhysics(dt);
        if (this.zipTimer <= 0 || this.pos.distanceTo(this.zipTarget) < TUNING.zip.stopDistance) {
          this.state = 'air';
          this.vel.multiplyScalar(0.75);
          this.vel.y = Math.max(this.vel.y, 6);
          this.emit('zipEnd', {});
        }
        break;

      case 'wallrun':
        this.wallPhysics(dt, wish, jumpPressed);
        break;

      case 'glide':
        this.glidePhysics(dt, wish, jumpPressed, sprint);
        break;

      case 'dive':
        this.divePhysics(dt, wish, sprint);
        break;

      case 'ground':
      case 'idle':
      case 'run':
        this.groundPhysics(dt, wish, sprint, jumpPressed);
        break;

      default:
        this.airPhysics(dt, wish, jumpPressed, sprint);
        break;
    }

    // ---------- 积分 + 碰撞 ----------
    this.integrate(dt);

    // ---------- 绳长约束 ----------
    if (this.rope.active && this.state === 'swing') this.applyRope();

    // ---------- 墙跑检测 ----------
    if (!this.rope.active && this.state !== 'wallrun' && this.state !== 'land') {
      this.checkWallrun(dt, wish);
    }

    // ---------- 落地 / 救援 ----------
    this.checkLanding();
    this.checkRescue(dt);

    // ---------- 距离 & 流速 ----------
    this.distance += this.totalSpeed * dt;
    this.maxSpeed = Math.max(this.maxSpeed, this.totalSpeed);

    if (this.flowTimer > 0) {
      this.flowTimer -= dt;
      if (this.flowTimer <= 0) this.flow = 0;
    }

    // ---------- 角色表现 ----------
    if (this.character) {
      this.character.group.position.copy(this.pos);
      const targetYaw = this.faceYaw(wish);
      const cur = this.character.group.rotation.y;
      let diff = targetYaw - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.character.group.rotation.y = cur + diff * Math.min(1, dt * 12);
      this.updateAnim(dt);
      if (this.anim) this.anim.update(dt);
    }
  }

  faceYaw(wish) {
    const s = this.speed;
    if (this.state === 'swing' || this.state === 'zip' || s > 2.2) {
      if (s > 1.2) return Math.atan2(this.vel.x, this.vel.z);
      if (this.rope.active) {
        const d = TMP.a.copy(this.rope.anchor).sub(this.pos);
        return Math.atan2(d.x, d.z);
      }
    }
    if (this.state === 'wallrun') {
      return Math.atan2(this.vel.x, this.vel.z) || this.camYaw + Math.PI;
    }
    if (wish.lengthSq() > 0.01) return Math.atan2(wish.x, wish.z);
    return this.camYaw + Math.PI;
  }

  updateAnim(dt) {
    const anim = this.anim;
    const s = this.speed;
    switch (this.state) {
      case 'swing': {
        const reeling = this.input && this.input.isDown('reel');
        anim.set(reeling ? 'reel' : 'swing', { fade: 0.14, timeScale: clamp(0.75 + s / 40, 0.7, 1.8) });
        break;
      }
      case 'zip':
        anim.set('zip', { fade: 0.1, timeScale: 1.2 });
        break;
      case 'dive':
        anim.set('dive', { fade: 0.12, timeScale: clamp(s / 55, 0.85, 1.6) });
        break;
      case 'glide':
        anim.set('glide', { fade: 0.16, timeScale: 1.0 });
        break;
      case 'wallrun':
        anim.set(this.wallSide > 0 ? 'wallrun' : 'wallrunL', { fade: 0.1, timeScale: clamp(s / 16, 0.9, 2.2) });
        break;
      case 'land':
        anim.set('land', { fade: 0.06, timeScale: 1 });
        break;
      case 'air':
        anim.set(this.vel.y > 2 ? 'jump' : 'fall', { fade: 0.14, timeScale: clamp(0.8 + Math.abs(this.vel.y) / 35, 0.8, 1.5) });
        break;
      default: {
        if (s > 15) anim.set('sprint', { fade: 0.14, timeScale: clamp(s / 19, 0.85, 1.35) });
        else if (s > 0.9) anim.set('run', { fade: 0.16, timeScale: clamp(s / 9.5, 0.7, 1.5) });
        else anim.set('idle', { fade: 0.2, timeScale: 1 });
      }
    }
  }

  // ============================ 挂点 ============================
  findAnchor(cameraDir) {
    const T = TUNING.swing;
    const cands = this.anchorHash.query(this.pos.x, this.pos.z, T.range, this.anchorCandidates);
    const camF = cameraDir ? TMP.c.copy(cameraDir).setY(0).normalize() : TMP.c.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const minDy = this.grounded ? T.minAttachHeight : 1.2;
    let best = null;
    let bestScore = -Infinity;
    for (const a of cands) {
      const dx = a.x - this.pos.x;
      const dy = a.y - this.pos.y;
      const dz = a.z - this.pos.z;
      if (dy < minDy) continue;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > T.range || dist < 4) continue;
      const inv = 1 / dist;
      const fScore = (dx * camF.x + dz * camF.z) * inv * 0.55 + (dy * inv) * 1.25;
      const score = fScore + 0.55 - (dist / T.range) * 0.85;
      if (score <= bestScore) continue;
      // 视线检测
      if (this.losBlocked(this.pos.x, this.pos.y + this.height * 0.8, this.pos.z, a.x, a.y, a.z, dist)) continue;
      bestScore = score;
      best = a;
    }
    return best;
  }

  losBlocked(ax, ay, az, bx, by, bz, dist) {
    const mx = (ax + bx) * 0.5;
    const mz = (az + bz) * 0.5;
    const boxes = this.boxHash.query(mx, mz, dist * 0.5 + 6, this.tmpBoxes);
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return false;
    dx /= len; dy /= len; dz /= len;
    for (const b of boxes) {
      let tmin = 0, tmax = len;
      let hit = true;
      for (let axis = 0; axis < 3; axis++) {
        const o = axis === 0 ? ax : axis === 1 ? ay : az;
        const d = axis === 0 ? dx : axis === 1 ? dy : dz;
        const lo = axis === 0 ? b.min.x : axis === 1 ? b.min.y : b.min.z;
        const hi = axis === 0 ? b.max.x : axis === 1 ? b.max.y : b.max.z;
        if (Math.abs(d) < 1e-7) { if (o < lo || o > hi) { hit = false; break; } continue; }
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { hit = false; break; }
      }
      if (hit && tmin > 0.6 && tmin < len - 1.5) return true;
    }
    return false;
  }

  tryAttach() {
    const a = this.targetAnchor || this.findAnchor(null);
    if (!a) {
      this.emit('noAnchor', { reason: 'swing' });
      return false;
    }
    const T = TUNING.swing;
    const dist = this.pos.distanceTo(TMP.a.set(a.x, a.y, a.z));
    this.rope.active = true;
    this.rope.anchor.set(a.x, a.y, a.z);
    // 不瞬移：直接以当前距离作为绳长，随后靠收绳/摆动缩短
    this.rope.length = clamp(dist * 0.99, T.minLength, T.range);
    this.state = 'swing';
    this.grounded = false;
    this.swingCount++;
    this.flow = Math.min(9, this.flow + 1);
    this.flowTimer = TUNING.flow.window;
    this.emit('swing', { anchor: this.rope.anchor.clone(), length: this.rope.length, chain: this.flow });
    // 挂接瞬间给一点切向推力，避免"吊死"
    const toAnchor = TMP.b.copy(this.rope.anchor).sub(this.pos).normalize();
    const tangent = TMP.c.copy(this.vel).addScaledVector(toAnchor, -this.vel.dot(toAnchor));
    if (tangent.lengthSq() < 4) {
      const fwd = TMP.d.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      tangent.copy(fwd).addScaledVector(toAnchor, -fwd.dot(toAnchor));
    }
    if (tangent.lengthSq() > 0.001) {
      tangent.normalize();
      this.vel.addScaledVector(tangent, 6.5);
    }
    return true;
  }

  releaseSwing() {
    if (!this.rope.active) return;
    const T = TUNING.swing;
    this.rope.active = false;
    this.state = 'air';
    this.attachCooldown = T.autoReattach;
    this.airTime = 0;
    const fwd = TMP.a.set(this.vel.x, 0, this.vel.z);
    if (fwd.lengthSq() > 0.01) fwd.normalize();
    this.vel.y += T.releaseUp;
    this.vel.addScaledVector(fwd, T.releaseBoost);
    this.emit('release', { speed: this.totalSpeed });
  }

  tryZip() {
    const a = this.targetAnchor || this.findAnchor(null);
    if (!a) return false;
    this.rope.active = false;
    this.state = 'zip';
    this.zipTimer = 1.35;
    this.zipTarget.set(a.x, a.y, a.z);
    const dir = TMP.a.copy(this.zipTarget).sub(this.pos).normalize();
    this.vel.copy(dir).multiplyScalar(TUNING.zip.speed);
    this.grounded = false;
    this.flow = Math.min(9, this.flow + 1);
    this.flowTimer = TUNING.flow.window;
    return true;
  }

  // ============================ 各状态物理 ============================
  groundPhysics(dt, wish, sprint, jumpPressed) {
    const G = TUNING.ground;
    const maxSpeed = sprint ? G.sprint : wish.lengthSq() > 0.5 ? G.run : G.walk;
    const accel = G.accel * (this.grounded ? 1 : 0.35);
    if (wish.lengthSq() > 0.001) {
      const targetX = wish.x * maxSpeed;
      const targetZ = wish.z * maxSpeed;
      this.vel.x += (targetX - this.vel.x) * Math.min(1, accel * dt / Math.max(1, maxSpeed));
      this.vel.z += (targetZ - this.vel.z) * Math.min(1, accel * dt / Math.max(1, maxSpeed));
    } else {
      this.applyGroundFriction(dt, G.friction);
    }
    if (jumpPressed) this.jump();
    this.vel.y -= 32 * dt;
    this.state = this.speed > 0.9 ? 'run' : 'idle';
  }

  applyGroundFriction(dt, k) {
    const f = Math.max(0, 1 - k * dt);
    this.vel.x *= f;
    this.vel.z *= f;
  }

  jump() {
    const G = TUNING.ground;
    this.vel.y = G.jump;
    this.grounded = false;
    this.state = 'air';
    this.airTime = 0;
    const fwd = TMP.a.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    this.vel.addScaledVector(fwd, G.jumpForward);
    this.emit('jump', {});
  }

  airPhysics(dt, wish, jumpPressed, sprint) {
    const A = TUNING.air;
    if (jumpPressed && this.airTime > 0.16) {
      // 空中切换滑翔
      this.state = 'glide';
      this.gliding = true;
      this.emit('glide', {});
      return;
    }
    if (sprint && this.vel.y < 2) {
      this.state = 'dive';
      this.emit('dive', {});
      return;
    }
    const accel = TUNING.ground.airAccel;
    if (wish.lengthSq() > 0.001) {
      this.vel.x += wish.x * accel * dt;
      this.vel.z += wish.z * accel * dt;
    }
    this.vel.y -= A.gravity * dt;
    // 空气阻力
    const drag = 1 - A.drag * this.totalSpeed * dt * 60;
    this.vel.multiplyScalar(Math.max(0.9, drag));
    this.state = 'air';
  }

  swingPhysics(dt, wish, sprint, jumpPressed) {
    const S = TUNING.swing;
    if (!this.rope.active) { this.state = 'air'; return; }
    if (jumpPressed) {
      this.releaseSwing();
      this.vel.y += 3.2;
      this.emit('swingBoost', {});
      return;
    }
    // 收绳
    if (sprint) {
      this.rope.length = Math.max(S.minLength, this.rope.length - S.reelSpeed * dt);
    }
    // 摆动驱动：沿切向加速 + 左右转向
    const toAnchor = TMP.a.copy(this.rope.anchor).sub(this.pos);
    const dist = toAnchor.length();
    if (dist > 0.001) toAnchor.multiplyScalar(1 / dist);
    const tangent = TMP.b.copy(this.vel).addScaledVector(toAnchor, -this.vel.dot(toAnchor));
    if (tangent.lengthSq() > 0.001) {
      tangent.normalize();
      const pump = wish.lengthSq() > 0.01 ? drag(wish, tangent) : 0;
      this.vel.addScaledVector(tangent, S.pump * dt * (0.55 + Math.max(0, pump)));
    }
    // 侧向转向力（垂直于绳与速度）
    if (wish.lengthSq() > 0.01) {
      const side = TMP.c.copy(tangent).cross(toAnchor).normalize();
      const sideAmt = side.dot(wish);
      this.vel.addScaledVector(side, sideAmt * S.steer * this.agilityMul * dt * 2.2);
    }
    this.vel.y -= S.gravity * dt;
    const dragF = 1 - S.swingDrag * this.totalSpeed * dt * 60;
    this.vel.multiplyScalar(Math.max(0.94, dragF));
    // 绳长不能超过上限
    this.rope.length = Math.min(this.rope.length, S.range);
    this.state = 'swing';
    this.grounded = false;
  }

  zipPhysics(dt) {
    const dir = TMP.a.copy(this.zipTarget).sub(this.pos);
    const d = dir.length();
    if (d < 0.001) return;
    dir.multiplyScalar(1 / d);
    const desired = Math.min(TUNING.zip.speed, 18 + d * 1.6);
    this.vel.lerp(dir.multiplyScalar(desired), Math.min(1, dt * 8));
  }

  glidePhysics(dt, wish, jumpPressed, sprint) {
    const A = TUNING.air;
    if (jumpPressed) {
      this.state = 'air';
      this.emit('glideEnd', {});
      return;
    }
    if (sprint) {
      this.state = 'dive';
      this.emit('dive', {});
      return;
    }
    this.vel.y += (-A.glideSink - this.vel.y) * Math.min(1, dt * 3.2);
    if (wish.lengthSq() > 0.001) {
      this.vel.x += wish.x * A.glideAccel * dt;
      this.vel.z += wish.z * A.glideAccel * dt;
    }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > A.glideMax) {
      const k = A.glideMax / hs;
      this.vel.x *= k;
      this.vel.z *= k;
    }
    this.vel.y -= A.gravity * 0.06 * dt;
    this.state = 'glide';
  }

  divePhysics(dt, wish, sprint) {
    const A = TUNING.air;
    if (!sprint) {
      this.state = 'air';
      return;
    }
    const fwd = TMP.a.set(this.vel.x, 0, this.vel.z);
    if (fwd.lengthSq() < 1) fwd.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    fwd.normalize();
    this.vel.addScaledVector(fwd, A.diveAccel * dt);
    this.vel.y -= A.diveGravity * dt;
    if (wish.lengthSq() > 0.001) {
      this.vel.x += wish.x * 16 * dt;
      this.vel.z += wish.z * 16 * dt;
    }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > A.diveMax) {
      const k = A.diveMax / hs;
      this.vel.x *= k;
      this.vel.z *= k;
    }
    this.state = 'dive';
  }

  wallPhysics(dt, wish, jumpPressed) {
    const W = TUNING.wall;
    this.wallTimer += dt;
    if (jumpPressed) {
      // 蹬墙跳
      this.vel.copy(this.wallNormal).multiplyScalar(W.jumpOut);
      this.vel.y = W.jumpUp;
      const tangent = TMP.a.copy(this.vel).setY(0);
      this.vel.addScaledVector(this.wallNormal, 0);
      this.state = 'air';
      this.wallContact = 0;
      this.airTime = 0;
      this.wallRunCount++;
      this.emit('wallJump', { normal: this.wallNormal.clone() });
      return;
    }
    // 沿墙切向加速
    const tangent = TMP.a.copy(this.vel).addScaledVector(this.wallNormal, -this.vel.dot(this.wallNormal));
    tangent.y *= 0.2;
    const tanLen = tangent.length();
    if (tanLen > 0.001) tangent.multiplyScalar(1 / tanLen);
    const wishAmt = Math.max(0.35, 1 + wish.dot(tangent) * 0.6);
    this.vel.addScaledVector(tangent, W.speed * 0.9 * dt * wishAmt);
    // 吸墙
    this.vel.addScaledVector(this.wallNormal, -6 * dt);
    this.vel.y -= W.gravity * dt;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > W.speed) {
      const k = W.speed / hs;
      this.vel.x *= k;
      this.vel.z *= k;
    }
    if (this.wallTimer > W.maxTime || this.wallContact <= 0.05) {
      this.state = 'air';
      this.vel.y = Math.min(this.vel.y, -1.5);
    }
  }

  checkWallrun(dt, wish) {
    const W = TUNING.wall;
    if (this.airTime < 0.14) return;
    if (this.wallContact < 0.5) return;
    const hs = this.speed;
    if (hs < W.minSpeed) return;
    const intoWall = -wish.dot(this.wallNormal);
    if (intoWall < 0.05 && hs < W.minSpeed * 1.4) return;
    this.state = 'wallrun';
    this.wallTimer = 0;
    this.wallSide = this.wallNormal.x > 0 ? 1 : -1;
    this.emit('wallrun', { normal: this.wallNormal.clone() });
  }

  // ============================ 积分与碰撞 ============================
  integrate(dt) {
    const delta = TMP.d.copy(this.vel).multiplyScalar(dt);
    const dist = delta.length();
    const steps = Math.max(1, Math.min(10, Math.ceil(dist / 0.4)));
    const step = delta.multiplyScalar(1 / steps);
    this.wallContact = Math.max(0, this.wallContact - dt * 3.2);
    let anyGround = false;
    let worstDepth = 0;
    const hitNormal = TMP.n;

    for (let s = 0; s < steps; s++) {
      this.pos.add(step);
      // 水平外边界软墙
      const limit = WORLD.extent / 2 + 90;
      if (this.pos.x > limit) { this.pos.x = limit; this.vel.x = Math.min(0, this.vel.x); }
      if (this.pos.x < -limit) { this.pos.x = -limit; this.vel.x = Math.max(0, this.vel.x); }
      if (this.pos.z > limit) { this.pos.z = limit; this.vel.z = Math.min(0, this.vel.z); }
      if (this.pos.z < -limit) { this.pos.z = -limit; this.vel.z = Math.max(0, this.vel.z); }

      // 地面平面
      if (this.pos.y < this.groundY) {
        this.pos.y = this.groundY;
        if (this.vel.y < 0) {
          this.lastImpact = Math.max(this.lastImpact, -this.vel.y);
          this.vel.y = 0;
        }
        anyGround = true;
      }

      const boxes = this.boxHash.query(this.pos.x, this.pos.z, this.radius + 3, this.tmpBoxes);
      for (let iter = 0; iter < 4; iter++) {
        let moved = false;
        for (const b of boxes) {
          if (b.max.y < this.pos.y - 1.5 || b.min.y > this.pos.y + this.height + 1.5) continue;
          const hit = capsuleBox(this.pos, this.radius, this.height, b);
          if (!hit) continue;
          worstDepth = Math.max(worstDepth, hit.depth);
          this.pos.x += hit.nx * (hit.depth + 0.002);
          this.pos.y += hit.ny * (hit.depth + 0.002);
          this.pos.z += hit.nz * (hit.depth + 0.002);
          hitNormal.set(hit.nx, hit.ny, hit.nz);
          const vn = this.vel.x * hit.nx + this.vel.y * hit.ny + this.vel.z * hit.nz;
          if (vn < 0) {
            const impact = -vn;
            this.lastImpact = Math.max(this.lastImpact, hit.ny > 0.5 ? impact : impact * 0.5);
            const restitution = impact > 22 && hit.ny > 0.5 ? 0.12 : 0;
            this.vel.x -= hit.nx * vn * (1 + restitution);
            this.vel.y -= hit.ny * vn * (1 + restitution);
            this.vel.z -= hit.nz * vn * (1 + restitution);
            if (Math.abs(hit.ny) < 0.5) {
              this.wallContact = 1;
              this.wallNormal.set(hit.nx, 0, hit.nz).normalize();
              if (impact > 16) this.emit('impact', { speed: impact, normal: this.wallNormal.clone() });
            }
          }
          if (hit.ny > 0.55) anyGround = true;
          moved = true;
        }
        if (!moved) break;
      }
    }

    this.grounded = anyGround;
    this.stuckTime = worstDepth > 0.6 ? this.stuckTime + dt : 0;
    if (this.grounded && this.vel.y < 0) this.vel.y = Math.min(0, this.vel.y);
    if (this.grounded) this.airTime = 0;
    else this.airTime += dt;
  }

  applyRope() {
    projectToRope(this.pos, this.vel, this.rope.anchor, this.rope.length, 0.35);
  }

  checkLanding() {
    if (!this.grounded) return;
    if (this.state === 'land' || this.state === 'wallrun') return;
    const impact = this.lastImpact;
    if (this.state === 'swing') {
      this.rope.active = false;
      this.state = 'air';
    }
    if (this.state === 'zip') this.state = 'air';
    const hard = impact > TUNING.land.hard;
    const soft = impact > TUNING.land.soft;
    if (soft) {
      this.state = 'land';
      this.landTimer = hard ? 0.46 : 0.24;
      this.landCount++;
      this.emit('land', { speed: impact, hard });
      this.flow = Math.min(9, this.flow + 1);
      this.flowTimer = TUNING.flow.window;
    } else {
      this.state = this.speed > 0.9 ? 'run' : 'idle';
    }
    this.lastImpact = 0;
    this.airTime = 0;
  }

  setGroundState(wish) {
    this.state = this.speed > 0.9 ? 'run' : 'idle';
  }

  checkRescue(dt) {
    const R = TUNING.rescue;
    const out = Math.abs(this.pos.x) > R.outOfBounds + WORLD.extent / 2 ||
                Math.abs(this.pos.z) > R.outOfBounds + WORLD.extent / 2;
    const fell = this.pos.y < R.minY;
    const stuck = this.stuckTime > 0.65;
    if (!out && !fell && !stuck) return;
    this.rescueCount++;
    const spot = this.findRescueSpot();
    this.pos.set(spot.x, spot.y + 0.4, spot.z);
    this.vel.set(0, 0, 0);
    this.rope.active = false;
    this.state = 'air';
    this.stuckTime = 0;
    this.emit('rescue', { x: spot.x, y: spot.y, z: spot.z });
  }

  /** 手动救援（R 键 / 暂停菜单重新出生） */
  forceRescue() {
    this.rescueCount++;
    const spot = this.findRescueSpot();
    this.pos.set(spot.x, spot.y + 0.8, spot.z);
    this.vel.set(0, 0, 0);
    this.rope.active = false;
    this.state = 'air';
    this.stuckTime = 0;
    this.landTimer = 0;
    this.lastImpact = 0;
    this.emit('rescue', { x: spot.x, y: spot.y, z: spot.z });
  }

  findRescueSpot() {    const buildings = this.plan.buildings;
    let best = null;
    let bestD = Infinity;
    for (const b of buildings) {
      const d = Math.hypot(b.x - this.pos.x, b.z - this.pos.z);
      if (d > 320) continue;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) return this.plan.spawn;
    return { x: best.x, y: best.h + 0.6, z: best.z };
  }
}

function drag(v, axis) {
  const d = v.dot(axis);
  return Math.abs(d);
}
