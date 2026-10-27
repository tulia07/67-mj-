import * as THREE from 'three';

/**
 * 蛛丝 / 牵引索的可视化。
 * - 一根加色发光的细圆柱（核心 + 外发光），从手掌连到挂点
 * - 命中挂点瞬间在锚点爆一圈光斑
 * 只做表现，不参与物理；绳长约束在 PlayerController 里。
 */

const UP = new THREE.Vector3(0, 1, 0);

export class WebLine {
  constructor(scene, assets) {
    this.group = new THREE.Group();
    this.group.name = 'WebLine';
    this.group.frustumCulled = false;
    scene.add(this.group);

    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    geo.translate(0, 0.5, 0); // 底部在原点，沿 +Y 延伸

    this.coreMat = new THREE.MeshBasicMaterial({
      color: 0xdff2ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0x4fd8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });

    this.core = new THREE.Mesh(geo, this.coreMat);
    this.glow = new THREE.Mesh(geo, this.glowMat);
    this.core.frustumCulled = false;
    this.glow.frustumCulled = false;
    this.core.renderOrder = 3;
    this.glow.renderOrder = 2;
    this.group.add(this.glow, this.core);

    this.burstMat = new THREE.SpriteMaterial({
      map: assets && assets.blob ? assets.blob : null,
      color: 0xa9f2ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.burst = new THREE.Sprite(this.burstMat);
    this.burst.scale.setScalar(1);
    this.burst.renderOrder = 4;
    this.group.add(this.burst);

    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.amount = 0;
    this.burstT = 0;
    this.burstLife = 0.3;
    this.radius = 0.014;
    this.hot = false;
  }

  /** 挂点命中/牵引锁定时的光斑 */
  fire(pos, hot = false) {
    this.burst.position.copy(pos);
    this.hot = hot;
    this.burstT = this.burstLife;
  }

  update(dt, from, to, active, tension = 1) {
    const goal = active ? 1 : 0;
    const rate = active ? 34 : 11;
    this.amount += (goal - this.amount) * Math.min(1, dt * rate);
    if (this.amount < 0.003) this.amount = 0;

    if (active) {
      this.from.copy(from);
      this.to.copy(to);
    }

    const vis = this.amount > 0.004;
    this.core.visible = vis;
    this.glow.visible = vis;

    if (vis) {
      const dist = this.from.distanceTo(this.to);
      if (dist > 1e-3) {
        this._dir.copy(this.to).sub(this.from).multiplyScalar(1 / dist);
        this._q.setFromUnitVectors(UP, this._dir);
        this.core.position.copy(this.from);
        this.core.quaternion.copy(this._q);
        this.glow.position.copy(this.from);
        this.glow.quaternion.copy(this._q);
        this.core.scale.set(this.radius, dist, this.radius);
        this.glow.scale.set(this.radius * 3.0, dist, this.radius * 3.0);
        this.core.visible = true;
        this.glow.visible = true;
      }
      const a = this.amount;
      this.coreMat.opacity = 0.7 * a;
      this.glowMat.opacity = (0.04 + 0.05 * tension) * a;
      this.coreMat.color.setHex(this.hot ? 0xffd9f2 : 0xe6fbff);
      this.glowMat.color.setHex(this.hot ? 0xff5ec4 : 0x4fd8ff);
    }

    if (this.burstT > 0) {
      this.burstT -= dt;
      const k = Math.max(0, this.burstT) / this.burstLife;
      this.burstMat.opacity = k * 0.8;
      this.burstMat.color.setHex(this.hot ? 0xff86d8 : 0xa9f2ff);
      this.burst.scale.setScalar(1.1 + (1 - k) * 2.6);
    } else if (this.burstMat.opacity !== 0) {
      this.burstMat.opacity = 0;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.core.geometry.dispose();
    this.coreMat.dispose();
    this.glowMat.dispose();
    this.burstMat.dispose();
  }
}
