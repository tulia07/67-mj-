import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDING_VERT, BUILDING_FRAG, GROUND_VERT, GROUND_FRAG, SIGN_VERT, SIGN_FRAG } from './shaders.js';
import { Traffic } from './Traffic.js';

const NEON_ATLAS = { cols: 2, rows: 4 };

function paint(geo, color) {
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color[0];
    arr[i * 3 + 1] = color[1];
    arr[i * 3 + 2] = color[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function boxAt(w, h, d, x, y, z, color, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return paint(g, color);
}

function cylAt(rt, rb, h, x, y, z, color, seg = 8, rotZ = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return paint(g, color);
}

/** 程序化屋顶/街道装置（合并顶点色，近处精细，远处退化为盒子） */
const PROP_KITS = {
  lamp: (s) => [
    cylAt(0.08, 0.13, 7 * s, 0, 3.5 * s, 0, [0.12, 0.13, 0.15], 6),
    boxAt(1.8 * s, 0.12, 0.12, 0.9 * s, 6.9 * s, 0, [0.12, 0.13, 0.15]),
    boxAt(0.9 * s, 0.16, 0.32, 1.7 * s, 6.78 * s, 0, [1.0, 0.82, 0.55], 0),
  ],
  ac: (s) => [
    boxAt(2.2 * s, 1.15 * s, 2.0 * s, 0, 0.58 * s, 0, [0.28, 0.3, 0.32]),
    boxAt(2.28 * s, 0.12 * s, 2.08 * s, 0, 1.12 * s, 0, [0.4, 0.43, 0.45]),
    cylAt(0.5 * s, 0.5 * s, 0.1 * s, 0, 1.2 * s, 0, [0.1, 0.1, 0.12], 10),
  ],
  vent: (s) => [
    cylAt(0.52 * s, 0.58 * s, 1.5 * s, 0, 0.75 * s, 0, [0.25, 0.26, 0.28], 8),
    cylAt(0.7 * s, 0.7 * s, 0.12 * s, 0, 1.55 * s, 0, [0.35, 0.36, 0.38], 8),
  ],
  tank: (s) => [
    cylAt(1.5 * s, 1.6 * s, 3.0 * s, 0, 2.2 * s, 0, [0.3, 0.29, 0.27], 10),
    cylAt(0.2 * s, 1.6 * s, 0.6 * s, 0, 3.9 * s, 0, [0.26, 0.25, 0.24], 10),
    boxAt(0.2 * s, 1.6 * s, 0.2 * s, 1.2 * s, 0.8 * s, 0, [0.16, 0.16, 0.17]),
    boxAt(0.2 * s, 1.6 * s, 0.2 * s, -1.2 * s, 0.8 * s, 0, [0.16, 0.16, 0.17]),
  ],
  antenna: (s) => [
    boxAt(0.2 * s, 9 * s, 0.2 * s, 0, 4.5 * s, 0, [0.22, 0.23, 0.25]),
    cylAt(0.9 * s, 0.9 * s, 0.12 * s, 0, 7.6 * s, 0, [0.3, 0.31, 0.33], 8, Math.PI / 3),
    boxAt(0.7 * s, 0.5 * s, 0.7 * s, 0, 0.25 * s, 0, [0.18, 0.19, 0.2]),
  ],
  pipe: (s) => [
    cylAt(0.28 * s, 0.28 * s, 2.4 * s, 0, 0.4 * s, 0, [0.3, 0.26, 0.22], 6, Math.PI / 2),
    boxAt(0.36 * s, 0.9 * s, 0.36 * s, 0, 0.45 * s, 0, [0.2, 0.2, 0.22]),
  ],
  crate: (s) => [
    boxAt(1.25 * s, 1.25 * s, 1.25 * s, 0, 0.63 * s, 0, [0.24, 0.22, 0.19]),
  ],
  station_light: (s) => [
    boxAt(2.6 * s, 0.16 * s, 0.5 * s, 0, 0, 0, [0.75, 0.96, 1.0]),
  ],
};

const SIMPLE_BOX = (s, y) => [boxAt(2.0 * s, 2.0 * s, 2.0 * s, 0, y + 1.0 * s, 0, [0.16, 0.17, 0.19])];

export class CityBuilder {
  constructor(scene, plan, assets, quality, preset) {
    this.scene = scene;
    this.plan = plan;
    this.assets = assets;
    this.quality = quality;
    this.preset = preset;
    this.root = new THREE.Group();
    this.root.name = 'City';
    scene.add(this.root);

    this.chunks = [];
    this.holoAds = [];
    this.tickers = [];
    this.shared = {
      uTime: { value: 0 },
      uNeon: { value: preset.neon },
      uWindowLight: { value: preset.windowLight },
      uFogColor: { value: new THREE.Color(...preset.fog) },
      uFogDensity: { value: preset.fogDensity },
      uSunDir: { value: new THREE.Vector3(...preset.sunDir).normalize() },
      uSunColor: { value: new THREE.Color(...preset.sunColor) },
      uHorizonColor: { value: new THREE.Color(...preset.horizon) },
      uAmbientColor: { value: new THREE.Color(...preset.ambientColor) },
      uAmbient: { value: preset.ambient },
      uGroundShade: { value: preset.groundShade },
      uStreetTint: { value: new THREE.Color(0.45, 0.22, 0.5) },
    };
  }

  async build(onProgress) {
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    const plan = this.plan;
    onProgress && onProgress(0.05, '构建建筑体块');
    this._buildBuildings();
    await tick();
    onProgress && onProgress(0.32, '铺装街道与湿地面');
    this._buildGround();
    await tick();
    onProgress && onProgress(0.45, '合并霓虹与广告贴片');
    this._buildSigns();
    this._buildPosters();
    this._buildHolo();
    this._buildTickers();
    await tick();
    onProgress && onProgress(0.62, '实例化屋顶/街道装置');
    this._buildProps();
    await tick();
    onProgress && onProgress(0.78, '生成远景天际线');
    this._buildSilhouette();
    await tick();
    onProgress && onProgress(0.86, '调度车流与地铁');
    this.traffic = new Traffic(this.root, plan, this.quality);
    this.traffic.build();
    onProgress && onProgress(1.0, '城市就绪');
    return this;
  }

  _buildBuildings() {
    const tiers = [];
    for (const b of this.plan.buildings) {
      for (const t of b.tiers) {
        tiers.push({ b, t });
      }
    }
    const count = tiers.length;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.BoxGeometry(1, 1, 1);
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('normal', base.attributes.normal);
    geo.setAttribute('uv', base.attributes.uv);
    geo.instanceCount = count;

    const aOffset = new Float32Array(count * 3);
    const aSize = new Float32Array(count * 3);
    const aTint = new Float32Array(count * 3);
    const aAccent = new Float32Array(count * 3);
    const aSeed = new Float32Array(count);
    const aStyle = new Float32Array(count);

    tiers.forEach((item, i) => {
      const { b, t } = item;
      const h = t.y1 - t.y0;
      aOffset[i * 3] = b.x;
      aOffset[i * 3 + 1] = (t.y0 + t.y1) / 2;
      aOffset[i * 3 + 2] = b.z;
      aSize[i * 3] = t.w;
      aSize[i * 3 + 1] = h;
      aSize[i * 3 + 2] = t.d;
      aTint[i * 3] = t.color[0];
      aTint[i * 3 + 1] = t.color[1];
      aTint[i * 3 + 2] = t.color[2];
      aAccent[i * 3] = t.accent[0];
      aAccent[i * 3 + 1] = t.accent[1];
      aAccent[i * 3 + 2] = t.accent[2];
      aSeed[i] = t.seed;
      aStyle[i] = (t.seed % 10) / 10;
    });

    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 3));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 3));
    geo.setAttribute('aAccent', new THREE.InstancedBufferAttribute(aAccent, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
    geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(aStyle, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: BUILDING_VERT,
      fragmentShader: BUILDING_FRAG,
      uniforms: {
        uTime: this.shared.uTime,
        uNeon: this.shared.uNeon,
        uWindowLight: this.shared.uWindowLight,
        uFogColor: this.shared.uFogColor,
        uFogDensity: this.shared.uFogDensity,
        uSunDir: this.shared.uSunDir,
        uSunColor: this.shared.uSunColor,
        uHorizonColor: this.shared.uHorizonColor,
        uAmbientColor: this.shared.uAmbientColor,
        uAmbient: this.shared.uAmbient,
        uGroundShade: this.shared.uGroundShade,
        uStreetTint: this.shared.uStreetTint,
        uDetail: { value: this.assets.detail },
      },
    });
    this.buildingMat = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.name = 'buildings';
    this.root.add(mesh);
    this.buildingMesh = mesh;
  }

  _buildGround() {
    const hm = this.plan.heightMap;
    const tex = new THREE.DataTexture(hm.data, hm.size, hm.size, THREE.RedFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(4400, 4400, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      uniforms: {
        uAsphalt: { value: this.assets.asphalt },
        uHeight: { value: tex },
        uCell: { value: this.plan.cfg.cell },
        uBlock: { value: this.plan.cfg.block },
        uHalf: { value: this.plan.cfg.extent / 2 },
        uTime: this.shared.uTime,
        uNeon: this.shared.uNeon,
        uWindowLight: this.shared.uWindowLight,
        uFogColor: this.shared.uFogColor,
        uFogDensity: this.shared.uFogDensity,
        uSunDir: this.shared.uSunDir,
        uSunColor: this.shared.uSunColor,
        uHorizonColor: this.shared.uHorizonColor,
        uAmbientColor: this.shared.uAmbientColor,
        uAmbient: this.shared.uAmbient,
        uGroundShade: this.shared.uGroundShade,
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0;
    mesh.name = 'ground';
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.groundMat = mat;
  }

  _buildSigns() {
    const signs = this.plan.signs;
    const quads = signs.length;
    const pos = new Float32Array(quads * 4 * 3);
    const uv = new Float32Array(quads * 4 * 2);
    const uvMin = new Float32Array(quads * 4 * 2);
    const uvSize = new Float32Array(quads * 4 * 2);
    const col = new Float32Array(quads * 4 * 3);
    const phase = new Float32Array(quads * 4);
    const idx = new Uint32Array(quads * 6);
    const cw = 1 / NEON_ATLAS.cols;
    const ch = 1 / NEON_ATLAS.rows;

    signs.forEach((s, q) => {
      const cos = Math.cos(s.rotY);
      const sin = Math.sin(s.rotY);
      const hw = s.w / 2;
      const hh = s.h / 2;
      const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      const colIndex = s.cell % 8;
      const cx = colIndex % NEON_ATLAS.cols;
      const cy = Math.floor(colIndex / NEON_ATLAS.cols);
      for (let c = 0; c < 4; c++) {
        const [lx, ly] = corners[c];
        const vi = (q * 4 + c);
        pos[vi * 3] = s.x + lx * cos;
        pos[vi * 3 + 1] = s.y + ly;
        pos[vi * 3 + 2] = s.z - lx * sin;
        uv[vi * 2] = c === 0 || c === 3 ? 0 : 1;
        uv[vi * 2 + 1] = c < 2 ? 0 : 1;
        // WebP 的纹理坐标原点在左下（flipY 默认 true），天空/招牌取上半部分即可
        uvMin[vi * 2] = cx * cw;
        uvMin[vi * 2 + 1] = 1 - (cy + 1) * ch;
        uvSize[vi * 2] = cw;
        uvSize[vi * 2 + 1] = ch;
        col[vi * 3] = s.color[0];
        col[vi * 3 + 1] = s.color[1];
        col[vi * 3 + 2] = s.color[2];
        phase[vi] = (s.x * 0.13 + s.z * 0.07) % 1;
      }
      const o = q * 6;
      const v = q * 4;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aUvMin', new THREE.BufferAttribute(uvMin, 2));
    geo.setAttribute('aUvSize', new THREE.BufferAttribute(uvSize, 2));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const mat = new THREE.ShaderMaterial({
      vertexShader: SIGN_VERT,
      fragmentShader: SIGN_FRAG,
      uniforms: {
        uMap: { value: this.assets.neon },
        uTime: this.shared.uTime,
        uNeon: this.shared.uNeon,
        uFogColor: this.shared.uFogColor,
        uFogDensity: this.shared.uFogDensity,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'neonSigns';
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.signMat = mat;
  }

  _buildPosters() {
    const posters = this.plan.posters;
    const groups = new Map();
    for (const p of posters) {
      if (!groups.has(p.poster)) groups.set(p.poster, []);
      groups.get(p.poster).push(p);
    }
    this.posterMeshes = [];
    for (const [idx, list] of groups) {
      const pos = [];
      const uv = [];
      const index = [];
      list.forEach((p, q) => {
        const cos = Math.cos(p.rotY);
        const sin = Math.sin(p.rotY);
        const hw = p.w / 2, hh = p.h / 2;
        const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
        for (const [lx, ly] of corners) {
          pos.push(p.x + lx * cos, p.y + ly, p.z - lx * sin);
        }
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        const v = q * 4;
        index.push(v, v + 1, v + 2, v, v + 2, v + 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(index);
      geo.computeBoundingSphere();
      const tex = this.assets.posters[idx] || null;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: 0xffffff,
        side: THREE.DoubleSide,
        toneMapped: true,
        fog: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'poster_' + idx;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.posterMeshes.push(mesh);
    }
  }

  _buildTickers() {
    const list = this.plan.tickers || [];
    if (!list.length || !this.assets.ticker) return;
    const baseTex = this.assets.ticker;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const tex = baseTex.clone();
      tex.needsUpdate = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(Math.max(1, t.w / 16), 1);
      tex.offset.set(Math.random(), 0);
      const geo = new THREE.PlaneGeometry(t.w, t.h);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        toneMapped: false,
        side: THREE.DoubleSide,
        transparent: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(t.x, t.y, t.z);
      mesh.rotation.y = t.rotY;
      mesh.userData.speed = 0.05 + (i % 4) * 0.02;
      this.root.add(mesh);
      this.tickers.push(mesh);
    }
  }

  _buildHolo() {
    const holoTex = this.assets.holo;
    if (!holoTex) return;
    const mat = new THREE.MeshBasicMaterial({
      map: holoTex,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const geo = new THREE.PlaneGeometry(18, 18);
    for (const p of this.plan.props.filter((x) => x.type === 'holo')) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = p.rotY;
      m.scale.setScalar(p.scale);
      m.userData.baseY = p.y;
      m.userData.phase = Math.random() * Math.PI * 2;
      this.root.add(m);
      this.holoAds.push(m);
    }
  }

  _buildProps() {
    const cfg = this.plan.cfg;
    const chunkSize = cfg.extent / cfg.chunk;
    const half = cfg.extent / 2;
    const buckets = new Map();

    for (const p of this.plan.props) {
      if (p.type === 'holo') continue;
      const ci = Math.min(cfg.chunk - 1, Math.max(0, Math.floor((p.x + half) / chunkSize)));
      const cj = Math.min(cfg.chunk - 1, Math.max(0, Math.floor((p.z + half) / chunkSize)));
      const key = ci + ',' + cj;
      if (!buckets.has(key)) buckets.set(key, { ci, cj, props: [] });
      buckets.get(key).props.push(p);
    }

    for (const [, bucket] of buckets) {
      const group = new THREE.Group();
      group.name = 'props_' + bucket.ci + '_' + bucket.cj;
      const full = [];
      const simple = [];
      for (const p of bucket.props) {
        const kit = PROP_KITS[p.type];
        if (!kit) continue;
        const parts = kit(p.scale);
        const m = new THREE.Matrix4().makeRotationY(p.rotY);
        for (const g of parts) {
          g.applyMatrix4(m);
          g.translate(p.x, p.y, p.z);
          full.push(g);
        }
        const sb = SIMPLE_BOX(p.scale, p.y)[0];
        sb.applyMatrix4(m);
        sb.translate(p.x, p.y, p.z);
        simple.push(sb);
      }
      const solidFull = full.filter((g) => !this._isEmissive(g));
      const emissiveFull = full.filter((g) => this._isEmissive(g));

      const matSolid = this._propMaterial();
      if (solidFull.length) {
        const merged = mergeGeometries(solidFull, false);
        if (merged) {
          merged.computeBoundingSphere();
          const mesh = new THREE.Mesh(merged, matSolid);
          mesh.castShadow = this.quality.shadows;
          mesh.frustumCulled = false;
          group.add(mesh);
          this._disposeParts(solidFull);
        }
      }
      if (emissiveFull.length) {
        const mergedE = mergeGeometries(emissiveFull, false);
        if (mergedE) {
          mergedE.computeBoundingSphere();
          const em = new THREE.Mesh(mergedE, this._emitMaterial());
          em.frustumCulled = false;
          group.add(em);
          this._disposeParts(emissiveFull);
        }
      }
      if (simple.length) {
        const mergedS = mergeGeometries(simple, false);
        if (mergedS) {
          mergedS.computeBoundingSphere();
          const sm = new THREE.Mesh(mergedS, matSolid);
          sm.frustumCulled = false;
          sm.visible = false;
          group.add(sm);
          group.userData.simple = sm;
          this._disposeParts(simple);
        }
      }
      group.userData.center = new THREE.Vector3(
        (bucket.ci + 0.5) * chunkSize - half,
        0,
        (bucket.cj + 0.5) * chunkSize - half
      );
      group.userData.full = group.children.filter((c) => c !== group.userData.simple);
      this.root.add(group);
      this.chunks.push(group);
    }
  }

  _isEmissive(geo) {
    // lamp 灯罩 / 站点灯箱使用高亮顶点色，单独用自发光材质
    const c = geo.attributes.color;
    return c.array[0] > 0.6 && c.array[1] > 0.5 && c.array[2] > 0.45;
  }

  _disposeParts(parts) {
    for (const g of parts) g.dispose && g.dispose();
  }

  _propMaterial() {
    if (!this._propMatSolid) {
      this._propMatSolid = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.68,
        metalness: 0.42,
      });
    }
    return this._propMatSolid;
  }

  _emitMaterial() {
    if (!this._emitMat) {
      this._emitMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        toneMapped: false,
        fog: true,
      });
    }
    return this._emitMat;
  }

  _buildSilhouette() {
    const parts = [];
    const half = this.plan.cfg.extent / 2;
    const rng = (() => {
      let s = 1337;
      return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    })();
    for (let i = 0; i < 90; i++) {
      const ang = (i / 90) * Math.PI * 2 + rng() * 0.04;
      const rad = half + 260 + rng() * 620;
      const w = 40 + rng() * 90;
      const d = 40 + rng() * 90;
      const h = 90 + rng() * 300;
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(Math.cos(ang) * rad, h / 2 - 4, Math.sin(ang) * rad);
      parts.push(g);
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!merged) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0x070910, fog: true });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'farSkyline';
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.silhouette = mesh;
  }

  setQuality(q) {
    this.quality = q;
    for (const chunk of this.chunks) {
      const solids = chunk.children.filter((c) => c.material && c.material.isMeshStandardMaterial && c !== chunk.userData.simple);
      const emissives = chunk.children.filter((c) => c.material && c.material.isMeshBasicMaterial);
      solids.forEach((m) => { m.castShadow = q.shadows; });
      emissives.forEach((m) => { m.visible = q.props > 0.45; });
    }
  }

  applyPreset(preset) {
    this.preset = preset;
    const s = this.shared;
    s.uNeon.value = preset.neon;
    s.uWindowLight.value = preset.windowLight;
    s.uFogColor.value.setRGB(...preset.fog);
    s.uFogDensity.value = preset.fogDensity;
    s.uSunDir.value.set(...preset.sunDir).normalize();
    s.uSunColor.value.setRGB(...preset.sunColor);
    s.uHorizonColor.value.setRGB(...preset.horizon);
    s.uAmbientColor.value.setRGB(...preset.ambientColor);
    s.uAmbient.value = preset.ambient;
    s.uGroundShade.value = preset.groundShade;
    if (this.silhouette) {
      this.silhouette.material.color.setRGB(
        0.03 + preset.ambientColor[0] * 0.06,
        0.035 + preset.ambientColor[1] * 0.06,
        0.05 + preset.ambientColor[2] * 0.08
      );
      this.silhouette.material.needsUpdate = true;
    }
  }

  update(dt, time, camera, playerPos) {
    this.shared.uTime.value = time;
    if (this.traffic) this.traffic.update(dt, time, camera);
    for (const ad of this.holoAds) {
      ad.rotation.y += dt * 0.35;
      ad.position.y = ad.userData.baseY + Math.sin(time * 0.8 + ad.userData.phase) * 1.6;
    }
    // 分块 LOD：近处精细装置，远处退化为盒体，更远处整体隐藏
    const near = this.quality.lodNear;
    const px = playerPos ? playerPos.x : camera.position.x;
    const pz = playerPos ? playerPos.z : camera.position.z;
    for (const chunk of this.chunks) {
      const c = chunk.userData.center;
      const dist = Math.hypot(c.x - px, c.z - pz);
      const simple = chunk.userData.simple;
      const full = chunk.userData.full;
      if (dist > near * 1.9) {
        chunk.visible = false;
      } else {
        chunk.visible = true;
        const useFull = dist < near;
        full.forEach((m) => { m.visible = useFull; });
        if (simple) simple.visible = !useFull;
      }
    }
  }
}
