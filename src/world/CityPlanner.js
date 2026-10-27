/**
 * 城市数据规划器（纯数据，不依赖 three.js / DOM）
 * 输出：建筑体块、碰撞盒、挂点、屋顶装置、霓虹/广告贴片、高架轨道、空中连廊。
 * 视觉层（CityBuilder）只负责把这份数据实例化，便于单测与替换。
 */
import { RNG } from '../core/RNG.js';
import { WORLD, DISTRICTS } from '../config.js';

const NEON_COLORS = [
  [0.16, 0.95, 1.0],   // cyan
  [1.0, 0.22, 0.72],   // magenta
  [0.62, 0.35, 1.0],   // violet
  [1.0, 0.62, 0.18],   // amber
  [0.55, 1.0, 0.42],   // lime
  [1.0, 0.26, 0.3],    // red
];

function districtAt(nx, nz, cx, cz, extent, rng) {
  const dx = cx / (extent * 0.5);
  const dz = cz / (extent * 0.5);
  const d = Math.hypot(dx, dz);
  if (nz < 0.24 || nx < 0.2) return 'industrial';
  if (nx > 0.63 && nz > 0.55) return 'slums';
  if (d < 0.42) return 'downtown';
  return 'midtown';
}

function makeBox(cx, cy, cz, sx, sy, sz, tag) {
  return {
    min: { x: cx - sx / 2, y: cy - sy / 2, z: cz - sz / 2 },
    max: { x: cx + sx / 2, y: cy + sy / 2, z: cz + sz / 2 },
    tag,
  };
}

export function planCity(overrides = {}) {
  const cfg = { ...WORLD, ...overrides };
  const rng = new RNG(cfg.seed);
  const extent = cfg.extent;
  const cell = cfg.cell;
  const block = cfg.block;
  const half = extent / 2;
  const cells = Math.max(4, Math.round(extent / cell));
  const step = extent / cells;

  const buildings = [];
  const boxes = [];
  const anchors = [];
  const props = [];
  const signs = [];
  const posters = [];
  const tickers = [];
  const bridges = [];
  const lanes = [];
  const stations = [];

  const pushAnchor = (x, y, z, nx, nz, type) => {
    anchors.push({ x, y, z, nx: nx || 0, nz: nz || 0, type });
  };

  let landmarkDone = false;
  const centerI = Math.floor(cells / 2);
  const centerJ = Math.floor(cells / 2);

  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const originX = i * step - half;
      const originZ = j * step - half;
      const cx = originX + block / 2;
      const cz = originZ + block / 2;
      const nx = (i + 0.5) / cells;
      const nz = (j + 0.5) / cells;
      const dkey = districtAt(nx, nz, cx, cz, extent, rng);
      const D = DISTRICTS[dkey];

      // 少量空地：plaza / 停车场
      const isLandmark = !landmarkDone && i === centerI && j === centerJ;
      if (!isLandmark && rng.chance(1 - D.density)) {
        // 空地：地面车位 + 少量杂物
        for (let k = 0; k < 4; k++) {
          props.push({
            type: 'crate',
            x: cx + rng.float(-26, 26),
            y: 0,
            z: cz + rng.float(-26, 26),
            rotY: rng.float(0, Math.PI * 2),
            scale: rng.float(0.7, 1.6),
          });
        }
        continue;
      }

      let w = rng.float(D.footprint[0], D.footprint[1]);
      let d = rng.float(D.footprint[0], D.footprint[1]);
      let h = rng.float(D.height[0], D.height[1]);
      if (isLandmark) {
        w = 58; d = 58; h = 328;
        landmarkDone = true;
      }
      // 让建筑更贴地，不要侵占街道
      w = Math.min(w, block - 6);
      d = Math.min(d, block - 6);

      const bx = cx + rng.float(-3, 3);
      const bz = cz + rng.float(-3, 3);
      const baseColor = [
        D.color[0] * rng.float(0.8, 1.5),
        D.color[1] * rng.float(0.85, 1.4),
        D.color[2] * rng.float(0.9, 1.5),
      ];
      const accent = rng.pick(NEON_COLORS);
      const seed = rng.float(0, 100);
      const building = {
        x: bx, z: bz, w, d, h, district: dkey, seed,
        accent, baseColor, tiers: [], landmark: isLandmark,
      };

      const tierCount = isLandmark ? 4 : rng.int(D.tiers[0], D.tiers[1]);
      let y0 = 0;
      let tw = w, td = d;
      for (let t = 0; t < tierCount; t++) {
        const isTop = t === tierCount - 1;
        const remainingTiers = tierCount - 1 - t;
        const minTier = Math.max(4, h * 0.06);
        const maxY1 = h - remainingTiers * minTier;
        const y1 = isTop ? h : Math.min(maxY1, y0 + Math.max(5, h * rng.float(0.3, 0.5)));
        const tierTop = Math.max(y0 + 4, y1);
        const tierBox = makeBox(bx, (y0 + tierTop) / 2, bz, tw, tierTop - y0, td, 'building');
        boxes.push(tierBox);        building.tiers.push({
          y0, y1: tierTop, w: tw, d: td,
          color: baseColor,
          accent,
          seed: seed + t * 3.7,
        });
        y0 = tierTop;
        if (!isTop) {
          tw *= rng.float(0.76, 0.91);
          td *= rng.float(0.76, 0.91);
        }
      }

      // 屋顶挂点：四角 + 边缘等距
      const topY = h + 0.4;
      const cw = tw / 2, cd = td / 2;
      pushAnchor(bx - cw, topY, bz - cd, 0, 0, 'corner');
      pushAnchor(bx + cw, topY, bz - cd, 0, 0, 'corner');
      pushAnchor(bx - cw, topY, bz + cd, 0, 0, 'corner');
      pushAnchor(bx + cw, topY, bz + cd, 0, 0, 'corner');
      const edgeStep = 22;
      for (let e = 0; e < 4; e++) {
        const len = e < 2 ? tw : td;
        const n = Math.max(1, Math.floor(len / edgeStep));
        for (let k = 1; k <= n; k++) {
          const f = k / (n + 1) - 0.5;
          const ax = e < 2 ? bx + f * tw : bx + (e === 2 ? -cw : cw);
          const az = e < 2 ? bz + (e === 0 ? -cd : cd) : bz + f * td;
          pushAnchor(ax, topY, az, 0, 0, 'edge');
        }
      }

      // 立面挂点：沿高度每 30m 一组四角，保证空中任意高度都有可用挂点
      for (let ay = 22; ay < h - 10; ay += 30) {
        pushAnchor(bx - cw, ay, bz - cd, -0.7, -0.7, 'facade');
        pushAnchor(bx + cw, ay, bz - cd, 0.7, -0.7, 'facade');
        pushAnchor(bx - cw, ay, bz + cd, -0.7, 0.7, 'facade');
        pushAnchor(bx + cw, ay, bz + cd, 0.7, 0.7, 'facade');
      }

      // 屋顶装置
      const propCount = isLandmark ? 10 : Math.floor(rng.float(2, 6));
      for (let p = 0; p < propCount; p++) {
        const t = rng.pick(['ac', 'ac', 'vent', 'tank', 'antenna', 'pipe']);
        const px = bx + rng.float(-tw * 0.36, tw * 0.36);
        const pz = bz + rng.float(-td * 0.36, td * 0.36);
        props.push({ type: t, x: px, y: h, z: pz, rotY: rng.float(0, Math.PI), scale: rng.float(0.8, 1.5) });
        if (t === 'antenna') pushAnchor(px, h + 9.5 * rng.float(0.8, 1.2), pz, 0, 0, 'antenna');
        if (t === 'tank') boxes.push(makeBox(px, h + 1.6, pz, 3.4, 3.2, 3.4, 'prop'));
      }

      // 地标：巨型霓虹环 / 顶部广告
      if (isLandmark) {
        for (let k = 0; k < 4; k++) {
          const ang = (k / 4) * Math.PI * 2;
          signs.push({
            x: bx + Math.cos(ang) * (tw / 2 + 0.6),
            y: 250 + k * 12,
            z: bz + Math.sin(ang) * (td / 2 + 0.6),
            w: 9, h: 26, rotY: ang + Math.PI / 2, cell: k % 8,
            color: NEON_COLORS[k % NEON_COLORS.length],
            landmark: true,
          });
        }
        posters.push({ x: bx, y: 200, z: bz + td / 2 + 0.5, w: 26, h: 39, rotY: 0, poster: 0 });
      }

      // 立面霓虹招牌（按高度取对应退台尺寸，避免嵌进楼体）
      const tierAtY = (y) => {
        for (let k = building.tiers.length - 1; k >= 0; k--) {
          const t = building.tiers[k];
          if (y >= t.y0 && y <= t.y1) return t;
        }
        return building.tiers[building.tiers.length - 1];
      };
      const signCount = Math.floor(rng.float(1, D.neon * 5));
      for (let s = 0; s < signCount; s++) {
        const face = rng.int(0, 3);
        const sy = rng.float(5, Math.min(h - 3, 46));
        const tier = tierAtY(sy);
        const tw2 = tier.w, td2 = tier.d;
        const wSign = rng.float(2.2, 4.2);
        const hSign = rng.float(4.5, 9);
        let sx = bx, sz = bz, rotY = 0;
        if (face === 0) { sz = bz - td2 / 2 - 0.45; rotY = Math.PI; }
        else if (face === 1) { sz = bz + td2 / 2 + 0.45; rotY = 0; }
        else if (face === 2) { sx = bx - tw2 / 2 - 0.45; rotY = -Math.PI / 2; }
        else { sx = bx + tw2 / 2 + 0.45; rotY = Math.PI / 2; }
        const along = face < 2 ? rng.float(-tw2 / 2 + 2, tw2 / 2 - 2) : rng.float(-td2 / 2 + 2, td2 / 2 - 2);
        if (face < 2) sx = bx + along; else sz = bz + along;
        signs.push({
          x: sx, y: sy, z: sz, w: wSign, h: hSign, rotY,
          cell: rng.int(0, 7),
          color: rng.pick(NEON_COLORS),
        });
      }

      // 立面广告
      if (rng.chance(dkey === 'downtown' ? 0.62 : 0.32)) {
        const face = rng.int(0, 3);
        const ph = rng.float(10, 18) * 1.5;
        const py = rng.float(14, Math.max(18, Math.min(h - ph, 80)));
        const tier = tierAtY(py);
        const tw2 = tier.w, td2 = tier.d;
        let px = bx, pz = bz, rotY = 0;
        if (face === 0) { pz = bz - td2 / 2 - 0.5; rotY = Math.PI; }
        else if (face === 1) { pz = bz + td2 / 2 + 0.5; rotY = 0; }
        else if (face === 2) { px = bx - tw2 / 2 - 0.5; rotY = -Math.PI / 2; }
        else { px = bx + tw2 / 2 + 0.5; rotY = Math.PI / 2; }
        const along = face < 2 ? rng.float(-tw2 / 2 + 6, tw2 / 2 - 6) : rng.float(-td2 / 2 + 6, td2 / 2 - 6);
        if (face < 2) px = bx + along; else pz = bz + along;
        const pw = Math.min(ph / 1.5, face < 2 ? tw2 * 0.45 : td2 * 0.45);
        posters.push({
          x: px, y: py, z: pz,
          w: pw, h: pw * 1.5, rotY, poster: rng.int(0, 5),
        });
      }

      // 滚动字幕灯箱（沿街可见）
      if (h > 55 && rng.chance(0.28)) {
        const ty = 9.2;
        const tier = tierAtY(ty);
        const tw2 = tier.w, td2 = tier.d;
        const face = rng.int(0, 3);
        let tx = bx, tz = bz, rotY = 0;
        if (face === 0) { tz = bz - td2 / 2 - 0.5; rotY = Math.PI; }
        else if (face === 1) { tz = bz + td2 / 2 + 0.5; rotY = 0; }
        else if (face === 2) { tx = bx - tw2 / 2 - 0.5; rotY = -Math.PI / 2; }
        else { tx = bx + tw2 / 2 + 0.5; rotY = Math.PI / 2; }
        tickers.push({ x: tx, y: ty, z: tz, w: Math.min(15, tw2 * 0.6), h: 1.9, rotY });
      }

      buildings.push(building);
    }
  }

  // 空中连廊（挂点密集区，也是摆荡的主要节奏点）
  const bridgeHeightBase = cfg.skybridge.height;
  const bridgeSpan = step - block + 14;   // 横跨街道并咬进两侧楼体
  const bridgeDepth = block * 0.55;
  for (let i = 0; i < cells - 1; i += cfg.skybridge.step) {
    for (let j = 1; j < cells; j += 2) {
      const bpH = bridgeHeightBase[0] + ((i * 3 + j * 5) % 3) * 7;
      if ((i + j) % 4 === 0) {
        // 沿 X 方向横跨南北向街道
        const gx = i * step + (step + block) / 2 - half;
        const zc = j * step - half + block / 2;
        bridges.push({ x: gx, y: bpH, z: zc, w: bridgeSpan, h: 5.2, d: bridgeDepth, axis: 'x' });
        boxes.push(makeBox(gx, bpH, zc, bridgeSpan, 5.2, bridgeDepth, 'bridge'));
        for (let k = -3; k <= 3; k++) {
          pushAnchor(gx, bpH + 2.8, zc + k * 8, 0, 0, 'bridge');
        }
        if (rng.chance(0.5)) {
          signs.push({ x: gx, y: bpH - 3.2, z: zc + bridgeDepth / 2 + 0.4, w: 13, h: 4.5, rotY: 0, cell: rng.int(0, 7), color: rng.pick(NEON_COLORS) });
        }
      } else {
        // 沿 Z 方向横跨东西向街道
        const gz = j * step + (step + block) / 2 - half;
        const xc = i * step - half + block / 2;
        bridges.push({ x: xc, y: bpH, z: gz, w: bridgeDepth, h: 5.2, d: bridgeSpan, axis: 'z' });
        boxes.push(makeBox(xc, bpH, gz, bridgeDepth, 5.2, bridgeSpan, 'bridge'));
        for (let k = -3; k <= 3; k++) {
          pushAnchor(xc + k * 8, bpH + 2.8, gz, 0, 0, 'bridge');
        }
        if (rng.chance(0.5)) {
          signs.push({ x: xc + bridgeDepth / 2 + 0.4, y: bpH - 3.2, z: gz, w: 13, h: 4.5, rotY: Math.PI / 2, cell: rng.int(0, 7), color: rng.pick(NEON_COLORS) });
        }
      }
    }
  }

  // 高架地铁：桥面 + 桥墩 + 车站
  for (const line of cfg.metro.lines) {
    const H = line.height;
    const span = extent + 120;
    if (line.axis === 'x') {
      boxes.push(makeBox(0, H, line.at, span, 1.8, 11, 'viaduct'));
      boxes.push(makeBox(0, H + 0.9, line.at - 4.2, span, 0.5, 0.5, 'rail'));
      boxes.push(makeBox(0, H + 0.9, line.at + 4.2, span, 0.5, 0.5, 'rail'));
      for (let x = -half; x <= half; x += 44) {
        boxes.push(makeBox(x, H / 2, line.at, 3.2, H, 3.2, 'pylon'));
        pushAnchor(x, H + 1.6, line.at + 5, 0, 0, 'rail');
      }
      for (const sx of line.stations) {
        const platform = makeBox(sx, H + 2.4, line.at + 11, 46, 4.2, 12, 'station');
        boxes.push(platform);
        stations.push({ x: sx, y: H + 2.4, z: line.at + 11, w: 46, h: 4.2, d: 12, axis: 'x', h0: H });
        signs.push({ x: sx, y: H + 5.4, z: line.at + 17.2, w: 16, h: 2.6, rotY: 0, cell: 7, color: [0.16, 0.95, 1.0] });
        props.push({ type: 'station_light', x: sx - 16, y: H + 4.4, z: line.at + 11, rotY: 0, scale: 1 });
        props.push({ type: 'station_light', x: sx + 16, y: H + 4.4, z: line.at + 11, rotY: 0, scale: 1 });
      }
    } else {
      boxes.push(makeBox(line.at, H, 0, 11, 1.8, span, 'viaduct'));
      boxes.push(makeBox(line.at - 4.2, H + 0.9, 0, 0.5, 0.5, span, 'rail'));
      boxes.push(makeBox(line.at + 4.2, H + 0.9, 0, 0.5, 0.5, span, 'rail'));
      for (let z = -half; z <= half; z += 44) {
        boxes.push(makeBox(line.at, H / 2, z, 3.2, H, 3.2, 'pylon'));
        pushAnchor(line.at + 5, H + 1.6, z, 0, 0, 'rail');
      }
      for (const sz of line.stations) {
        const platform = makeBox(line.at + 11, H + 2.4, sz, 12, 4.2, 46, 'station');
        boxes.push(platform);
        stations.push({ x: line.at + 11, y: H + 2.4, z: sz, w: 12, h: 4.2, d: 46, axis: 'z', h0: H });
        signs.push({ x: line.at + 17.2, y: H + 5.4, z: sz, w: 16, h: 2.6, rotY: Math.PI / 2, cell: 7, color: [0.16, 0.95, 1.0] });
      }
    }
  }

  // 街道设施：路灯（沿街两侧）
  for (let i = 0; i <= cells; i++) {
    const sx = i * step - half;
    for (let j = 0; j < cells; j++) {
      const z = j * step - half + block + 4;
      if (Math.abs(z) < extent / 2) {
        props.push({ type: 'lamp', x: sx + 2.6, y: 0, z, rotY: 0, scale: 1 });
        props.push({ type: 'lamp', x: sx - 2.6, y: 0, z: z + 40, rotY: Math.PI, scale: 1 });
      }
      const x = j * step - half + block + 4;
      props.push({ type: 'lamp', x, y: 0, z: sx + 2.6, rotY: Math.PI / 2, scale: 1 });
    }
  }

  // 悬浮全息广告（街道上空）
  for (let k = 0; k < 14; k++) {
    const x = rng.float(-half + 100, half - 100);
    const z = rng.float(-half + 100, half - 100);
    props.push({ type: 'holo', x, y: rng.float(26, 58), z, rotY: rng.float(0, Math.PI * 2), scale: rng.float(0.8, 1.5) });
  }

  // 飞行车道：严格沿街道中心线，避免穿过楼体（街道峡谷内的低空车道）
  const streetCenter = (k) => k * step + (step + block) / 2 - half;
  for (let k = 0; k < cells; k++) {
    if (k % 2 !== 0) continue;
    const h1 = 16 + (k % 3) * 5;
    lanes.push({ axis: 'x', at: streetCenter(k), y: h1, dir: 1, speed: 14 + (k % 4) * 3, count: 2 });
    lanes.push({ axis: 'z', at: streetCenter(k), y: h1 + 6, dir: -1, speed: 16 + (k % 3) * 3, count: 2 });
    if (k % 4 === 0) {
      lanes.push({ axis: 'x', at: streetCenter(k + 1), y: 30, dir: -1, speed: 22, count: 2 });
      lanes.push({ axis: 'z', at: streetCenter(k + 1), y: 34, dir: 1, speed: 24, count: 2 });
    }
  }

  // 出生点：离配置坐标最近的屋顶（优先高楼）
  let spawn = null;
  let bestScore = Infinity;
  for (const b of buildings) {
    const d = Math.hypot(b.x - cfg.spawn.x, b.z - cfg.spawn.z);
    const score = d - Math.min(b.h, 180) * 0.22;
    if (score < bestScore) {
      bestScore = score;
      spawn = { x: b.x, y: b.h + 1.2, z: b.z, district: b.district };
    }
  }
  if (!spawn) {
    const b = buildings[0];
    spawn = { x: b.x, y: b.h + 1.2, z: b.z, district: b.district };
  }

  const heightMap = buildHeightMap(buildings, extent, 512);

  const stats = {
    buildings: buildings.length,
    tiers: boxes.filter((b) => b.tag === 'building').length,
    boxes: boxes.length,
    anchors: anchors.length,
    props: props.length,
    signs: signs.length,
    posters: posters.length,
    tickers: tickers.length,
    bridges: bridges.length,
    extent,
  };

  return { buildings, boxes, anchors, props, signs, posters, tickers, bridges, lanes, stations, spawn, heightMap, stats, cfg };
}

/** 512x512 高度图（米 → 0..1），供地面着色器做建筑投影/环境光遮蔽 */
export function buildHeightMap(buildings, extent, size) {
  const data = new Uint8Array(size * size);
  const half = extent / 2;
  const maxH = 340;
  for (const b of buildings) {
    const x0 = Math.round(((b.x - b.w / 2 + half) / extent) * size);
    const x1 = Math.round(((b.x + b.w / 2 + half) / extent) * size);
    const z0 = Math.round(((b.z - b.d / 2 + half) / extent) * size);
    const z1 = Math.round(((b.z + b.d / 2 + half) / extent) * size);
    const v = Math.min(255, Math.round((b.h / maxH) * 255));
    for (let z = Math.max(0, z0); z < Math.min(size, z1); z++) {
      for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) {
        const idx = z * size + x;
        if (data[idx] < v) data[idx] = v;
      }
    }
  }
  return { data, size, extent };
}

/** 粗粒度安全落点搜索（救援用） */
export function findSafeSpot(plan, x, z) {
  let best = null;
  let bestScore = Infinity;
  for (const b of plan.buildings) {
    const dx = b.x - x;
    const dz = b.z - z;
    const d = Math.hypot(dx, dz);
    if (d > 260) continue;
    const score = d - b.h * 0.08;
    if (score < bestScore) {
      bestScore = score;
      best = { x: b.x, y: b.h + 1.4, z: b.z, district: b.district };
    }
  }
  if (!best) best = plan.spawn;
  return best;
}
