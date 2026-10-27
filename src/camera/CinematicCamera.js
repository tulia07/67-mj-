import * as THREE from 'three';
import { TUNING } from '../config.js';
import { rayBox, clamp, damp } from '../physics/Collision.js';

/**
 * 电影感第三人称相机。
 * - 速度驱动 FOV / 距离 / 侧倾
 * - 视线预测（沿速度前瞻）
 * - 建筑遮挡回缩（射线求交，避免镜头穿墙）
 * - 落地/撞击震屏、开场地标环绕
 */
export class CinematicCamera {
  constructor(camera, quality) {
    this.camera = camera;
    this.quality = quality;
    this.yaw = Math.PI;
    this.pitch = -0.1;
    this.dist = TUNING.camera.baseDist;
    this.roll = 0;
    this.trauma = 0;
    this.time = 0;
    this.mode = 'menu';
    this.introT = 0;
    this.introFrom = new THREE.Vector3();
    this.introLook = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this._boxes = [];
    this._prevVel = new THREE.Vector3();
    this._accel = new THREE.Vector3();
    this._smoothTarget = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._lookAhead = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._init = false;
  }

  addLook(dx, dy) {
    this.yaw += dx;
    this.pitch = clamp(this.pitch - dy, -1.05, 0.95);
  }

  get forward() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  startIntro(fromPos, lookAt) {
    this.mode = 'intro';
    this.introT = 0;
    this.introFrom.copy(fromPos);
    this.introLook.copy(lookAt);
  }

  _collectBoxes(player, dist) {
    if (!player || !player.boxHash) return this._boxes;
    return player.boxHash.query(player.pos.x, player.pos.z, dist + 8, this._boxes);
  }

  update(dt, player, opts = {}) {
    this.time += dt;
    const cam = this.camera;
    const pivot = this._smoothTarget;
    pivot.set(player.pos.x, player.pos.y + TUNING.camera.height * 0.72, player.pos.z);

    if (this.mode === 'menu') {
      return;
    }

    const speed = player.totalSpeed;
    const speedK = clamp(speed / 62, 0, 1.35);
    const state = player.state;
    const swingK = state === 'swing' ? 1 : 0;
    const diveK = state === 'dive' ? 1 : 0;

    // 速度 → 视距/FOV
    const wantDist = TUNING.camera.baseDist + speedK * 2.6 + swingK * 0.9 + diveK * 1.2;
    this.dist = damp(this.dist, wantDist, 3.4, dt);
    const fovTarget = TUNING.camera.fovBase + speedK * 22 + diveK * 5;
    cam.fov = damp(cam.fov, fovTarget, 4.2, dt);

    const forward = this.forward;
    const desired = this._desired;
    desired.set(
      pivot.x - forward.x * this.dist,
      pivot.y - forward.y * this.dist + 0.55,
      pivot.z - forward.z * this.dist
    );

    // 遮挡回缩
    const boxes = this._collectBoxes(player, this.dist);
    let minT = this.dist;
    const ox = pivot.x, oy = pivot.y, oz = pivot.z;
    let dx = desired.x - ox, dy = desired.y - oy, dz = desired.z - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    for (let i = 0; i < boxes.length; i++) {
      const hit = rayBox(ox, oy, oz, dx, dy, dz, boxes[i], minT);
      if (hit && hit.t > 0.05 && hit.t < minT) minT = hit.t;
    }
    if (minT < this.dist) {
      const safe = Math.max(TUNING.camera.minDist, minT - 0.45);
      desired.set(ox + dx * safe, oy + dy * safe, oz + dz * safe);
    }

    // 前瞻
    const lookAhead = TUNING.camera.lookAhead;
    const lookTarget = this._lookAhead.set(
      player.pos.x + player.vel.x * lookAhead,
      player.pos.y + 1.35 + player.vel.y * lookAhead * 0.35,
      player.pos.z + player.vel.z * lookAhead
    );

    // 加速度 → 侧倾
    this._accel.copy(player.vel).sub(this._prevVel).multiplyScalar(1 / Math.max(dt, 1e-3));
    this._prevVel.copy(player.vel);
    const right = this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const lateral = this._accel.dot(right);
    const rollTarget = clamp(-lateral * 0.0022, -0.18, 0.18) + (swingK ? Math.sin(this.time * 2.2) * 0.012 : 0);
    this.roll = damp(this.roll, rollTarget, 4, dt);

    // 平滑（撞墙/传送时直接贴合，避免镜头甩飞）
    const teleport = this.position.distanceTo(desired) > 40;
    if (!this._init || teleport || this.mode === 'intro') {
      this.position.copy(desired);
      this._smoothTarget.copy(lookTarget);
      this._init = true;
    } else {
      const stiff = state === 'swing' ? 7.5 : 11;
      this.position.x = damp(this.position.x, desired.x, stiff, dt);
      this.position.y = damp(this.position.y, desired.y, stiff, dt);
      this.position.z = damp(this.position.z, desired.z, stiff, dt);
      this._smoothTarget.x = damp(this._smoothTarget.x, lookTarget.x, 13, dt);
      this._smoothTarget.y = damp(this._smoothTarget.y, lookTarget.y, 13, dt);
      this._smoothTarget.z = damp(this._smoothTarget.z, lookTarget.z, 13, dt);
    }

    if (this.mode === 'intro') {
      this.introT += dt;
      const k = clamp(this.introT / 2.4, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      cam.position.lerpVectors(this.introFrom, this.position, e);
      const look = new THREE.Vector3().lerpVectors(this.introLook, this._smoothTarget, Math.min(1, e * 1.6));
      cam.up.set(0, 1, 0);
      cam.lookAt(look);
      cam.position.y += Math.sin(k * Math.PI) * 6;
      if (k >= 1) this.mode = 'play';
      return;
    }

    // 震屏
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const shakeAmt = this.trauma * this.trauma;
    const sx = (Math.random() - 0.5) * shakeAmt * 0.55;
    const sy = (Math.random() - 0.5) * shakeAmt * 0.55;
    const groundLimit = 0.55;
    cam.position.set(
      this.position.x + sx,
      Math.max(groundLimit, this.position.y + sy),
      this.position.z
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(this._smoothTarget.x + sx * 0.6, this._smoothTarget.y, this._smoothTarget.z);
    cam.rotateZ(this.roll + (Math.random() - 0.5) * shakeAmt * 0.05);
    cam.updateProjectionMatrix();
  }

  menuOrbit(t, center, radius = 12, height = 2.4, lookY = 1.2) {
    const cam = this.camera;
    const ang = t * 0.09;
    cam.position.set(
      center.x + Math.cos(ang) * radius,
      center.y + height + Math.sin(t * 0.22) * 0.35,
      center.z + Math.sin(ang) * radius
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(center.x, center.y + lookY, center.z);
    cam.fov = 52;
    cam.updateProjectionMatrix();
    this.position.copy(cam.position);
    this._smoothTarget.set(center.x, center.y + lookY, center.z);
  }
}
