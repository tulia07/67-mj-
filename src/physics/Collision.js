/**
 * 纯数学碰撞工具 —— 不依赖渲染层，可被 Node 单元测试直接覆盖。
 * 约定：玩家胶囊以「脚底点」pos 表示，竖直方向，半径 r，总高 h。
 */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

export function makeBox(cx, cy, cz, sx, sy, sz, tag) {
  return {
    min: { x: cx - sx / 2, y: cy - sy / 2, z: cz - sz / 2 },
    max: { x: cx + sx / 2, y: cy + sy / 2, z: cz + sz / 2 },
    tag: tag || 'solid',
  };
}

export function boxFromMinMax(min, max, tag) {
  return { min: { ...min }, max: { ...max }, tag: tag || 'solid' };
}

export function boxCenter(b, out) {
  out.x = (b.min.x + b.max.x) * 0.5;
  out.y = (b.min.y + b.max.y) * 0.5;
  out.z = (b.min.z + b.max.z) * 0.5;
  return out;
}

export function pointInBox(x, y, z, b) {
  return (
    x >= b.min.x && x <= b.max.x &&
    y >= b.min.y && y <= b.max.y &&
    z >= b.min.z && z <= b.max.z
  );
}

/**
 * 胶囊 vs AABB 精确求解（竖直胶囊）。
 * 返回 {hit, nx, ny, nz, depth}：法线指向「把胶囊推出去」的方向。
 */
export function capsuleBox(pos, r, h, b) {
  const y0 = pos.y + r;
  const y1 = pos.y + h - r;
  const insideX = pos.x > b.min.x && pos.x < b.max.x;
  const insideZ = pos.z > b.min.z && pos.z < b.max.z;

  if (insideX && insideZ) {
    // 中轴在盒子投影内部：只要竖直区间重叠就必然相交
    if (pos.y + h <= b.min.y || pos.y >= b.max.y) return null;
    const pushTop = b.max.y - pos.y;              // 站上屋顶
    const pushBottom = pos.y + h - b.min.y;       // 被顶到楼下
    const pushNegX = pos.x - b.min.x + r;
    const pushPosX = b.max.x - pos.x + r;
    const pushNegZ = pos.z - b.min.z + r;
    const pushPosZ = b.max.z - pos.z + r;
    let best = pushTop, nx = 0, ny = 1, nz = 0;
    if (pushBottom < best) { best = pushBottom; nx = 0; ny = -1; nz = 0; }
    if (pushNegX < best) { best = pushNegX; nx = -1; ny = 0; nz = 0; }
    if (pushPosX < best) { best = pushPosX; nx = 1; ny = 0; nz = 0; }
    if (pushNegZ < best) { best = pushNegZ; nx = 0; ny = 0; nz = -1; }
    if (pushPosZ < best) { best = pushPosZ; nx = 0; ny = 0; nz = 1; }
    return { hit: true, nx, ny, nz, depth: Math.max(0.0001, best) };
  }

  // 水平方向最近点
  const qx = clamp(pos.x, b.min.x, b.max.x);
  const qz = clamp(pos.z, b.min.z, b.max.z);
  const hx = pos.x - qx;
  const hz = pos.z - qz;
  const hDist = Math.hypot(hx, hz);
  // 胶囊竖直区间与盒子 y 区间的间隙（重叠时为 0）
  let vGap = 0;
  let vSign = 0;
  if (y1 < b.min.y) { vGap = b.min.y - y1; vSign = -1; }
  else if (y0 > b.max.y) { vGap = y0 - b.max.y; vSign = 1; }

  const dist = Math.hypot(hDist, vGap);
  if (dist >= r || dist < 1e-6) return null;
  const nx = hDist > 1e-6 ? hx / dist : 0;
  const nz = hDist > 1e-6 ? hz / dist : 0;
  const ny = vGap > 1e-6 ? (vSign * vGap) / dist : 0;
  return { hit: true, nx, ny, nz, depth: r - dist };
}

/** 射线 vs AABB（slab 法）。返回 {t, nx,ny,nz} 或 null。dir 需归一化。 */
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT = Infinity) {
  let tmin = 0;
  let tmax = maxT;
  let nx = 0, ny = 0, nz = 0;

  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = axis === 0 ? b.min.x : axis === 1 ? b.min.y : b.min.z;
    const hi = axis === 0 ? b.max.x : axis === 1 ? b.max.y : b.max.z;
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) {
      tmin = t1;
      nx = axis === 0 ? sign : 0;
      ny = axis === 1 ? sign : 0;
      nz = axis === 2 ? sign : 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin <= 0 && tmax <= 0) return null;
  return { t: tmin, nx, ny, nz };
}

/** 视线检测：两点之间是否被盒子阻挡（忽略距离阈值内的起点盒子） */
export function segmentBlocked(ax, ay, az, bx, by, bz, boxes, skipRadius = 0.35) {
  let dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return false;
  dx /= len; dy /= len; dz /= len;
  for (let i = 0; i < boxes.length; i++) {
    const hit = rayBox(ax, ay, az, dx, dy, dz, boxes[i], len);
    if (hit && hit.t > skipRadius) return true;
  }
  return false;
}

/** 刚性绳长约束：把位置投影回半径内，并消去径向速度（用于摆荡） */
export function projectToRope(pos, vel, anchor, length, minRatio = 0) {
  let dx = pos.x - anchor.x;
  let dy = pos.y - anchor.y;
  let dz = pos.z - anchor.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-5) return { dist: 0, projected: false };
  const inv = 1 / dist;
  dx *= inv; dy *= inv; dz *= inv;
  let projected = false;
  if (dist > length) {
    pos.x = anchor.x + dx * length;
    pos.y = anchor.y + dy * length;
    pos.z = anchor.z + dz * length;
    const radial = vel.x * dx + vel.y * dy + vel.z * dz;
    if (radial > 0) {
      vel.x -= dx * radial;
      vel.y -= dy * radial;
      vel.z -= dz * radial;
    }
    projected = true;
  } else if (minRatio > 0 && dist < length * minRatio) {
    const target = length * minRatio;
    pos.x = anchor.x + dx * target;
    pos.y = anchor.y + dy * target;
    pos.z = anchor.z + dz * target;
    projected = true;
  }
  return { dist, projected };
}

/** 空间哈希：宽相位加速（城市碰撞体 / 挂点查询） */
export class SpatialHash {
  constructor(cellSize = 48) {
    this.cell = cellSize;
    this.map = new Map();
    this.items = [];
  }
  key(ix, iz) {
    return ix * 73856093 ^ iz * 19349663;
  }
  insert(item, minX, minZ, maxX, maxZ) {
    const id = this.items.length;
    this.items.push(item);
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let bucket = this.map.get(k);
        if (!bucket) { bucket = []; this.map.set(k, bucket); }
        bucket.push(id);
      }
    }
    return id;
  }
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const bucket = this.map.get(this.key(ix, iz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const id = bucket[i];
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(this.items[id]);
        }
      }
    }
    return out;
  }
  queryRadius(x, z, radius, out = []) {
    return this.query(x - radius, z - radius, x + radius, z + radius, out);
  }
}
