import test from 'node:test';
import assert from 'node:assert/strict';

import {
  capsuleBox, rayBox, segmentBlocked, projectToRope, SpatialHash, makeBox, clamp, damp,
} from '../src/physics/Collision.js';
import { planCity, findSafeSpot, buildHeightMap } from '../src/world/CityPlanner.js';
import { RNG, mulberry32 } from '../src/core/RNG.js';
import { QUALITY, PRESETS, TUNING, CHARACTERS, WORLD, DISTRICTS } from '../src/config.js';

const R = TUNING.capsule.radius;
const H = TUNING.capsule.height;

test('随机数：同种子可复现', () => {
  const a = mulberry32(1234);
  const b = mulberry32(1234);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  const rng = new RNG(7);
  for (let i = 0; i < 200; i++) {
    const v = rng.float(2, 5);
    assert.ok(v >= 2 && v <= 5);
  }
});

test('胶囊：站在屋顶上会被正确推到 y = 顶面', () => {
  const box = makeBox(0, 5, 0, 20, 10, 20); // 顶面 y=10
  const hit = capsuleBox({ x: 0, y: 9.8, z: 0 }, R, H, box);
  assert.ok(hit, '应检测到穿透');
  assert.equal(hit.ny, 1);
  assert.ok(Math.abs(hit.depth - 0.2) < 1e-6);
});

test('胶囊：悬空在屋顶上方不产生碰撞', () => {
  const box = makeBox(0, 5, 0, 20, 10, 20);
  assert.equal(capsuleBox({ x: 0, y: 10.2, z: 0 }, R, H, box), null);
  assert.equal(capsuleBox({ x: 0, y: 20, z: 0 }, R, H, box), null);
});

test('胶囊：侧面推离法线正确', () => {
  const box = makeBox(0, 5, 0, 20, 10, 20); // x ∈ [-10,10]
  const hit = capsuleBox({ x: 10.3, y: 2, z: 0 }, R, H, box);
  assert.ok(hit);
  assert.equal(hit.nx, 1);
  assert.ok(hit.depth > 0 && hit.depth < R);
});

test('胶囊：完全嵌入楼体时沿最近面推出', () => {
  const box = makeBox(0, 5, 0, 20, 10, 20);
  const hit = capsuleBox({ x: 9.4, y: 4, z: 0 }, R, H, box);
  assert.ok(hit);
  assert.ok(hit.depth > 0.4);
  assert.equal(hit.nx, 1);
});

test('射线：命中距离与法线', () => {
  const box = makeBox(0, 5, 0, 10, 10, 10);
  const hit = rayBox(-20, 5, 0, 1, 0, 0, box, 100);
  assert.ok(hit);
  assert.ok(Math.abs(hit.t - 15) < 1e-6);
  assert.equal(hit.nx, -1);
  assert.equal(rayBox(-20, 50, 0, 1, 0, 0, box, 100), null);
});

test('视线阻挡：中间有楼即被挡住', () => {
  const wall = makeBox(0, 30, 0, 12, 60, 12);
  assert.equal(segmentBlocked(-40, 30, 0, 40, 30, 0, [wall]), true);
  assert.equal(segmentBlocked(-40, 30, 40, 40, 30, 40, [wall]), false);
});

test('绳长约束：位置投影 + 径向速度消除', () => {
  const anchor = { x: 0, y: 50, z: 0 };
  const pos = { x: 0, y: 30, z: 0 };
  const vel = { x: 0, y: -30, z: 4 };
  projectToRope(pos, vel, anchor, 10);
  assert.ok(Math.abs(pos.y - 40) < 1e-6, '应被拉到半径 10 处');
  assert.ok(Math.abs(vel.y) < 1e-6, '径向速度被消除');
  assert.ok(Math.abs(vel.z - 4) < 1e-6, '切向速度保留');
});

test('绳长约束：半径内不受影响', () => {
  const pos = { x: 2, y: 49, z: 0 };
  const vel = { x: 1, y: 0, z: 0 };
  const res = projectToRope(pos, vel, { x: 0, y: 50, z: 0 }, 10);
  assert.equal(res.projected, false);
  assert.equal(pos.x, 2);
});

test('空间哈希：查询去重且只返回邻近对象', () => {
  const hash = new SpatialHash(32);
  hash.insert({ id: 'a' }, 10, 10, 14, 14);
  hash.insert({ id: 'b' }, 400, 400, 404, 404);
  const out = hash.queryRadius(12, 12, 20, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a');
});

test('工具函数：clamp / damp 收敛', () => {
  assert.equal(clamp(5, 0, 3), 3);
  let v = 0;
  for (let i = 0; i < 120; i++) v = damp(v, 10, 8, 1 / 60);
  assert.ok(v > 9.9 && v < 10.001);
});

test('城市：生成规模与非空', () => {
  const plan = planCity();
  assert.ok(plan.buildings.length > 120, '建筑数量');
  assert.ok(plan.boxes.length > plan.buildings.length, '每栋楼至少一个体块');
  assert.ok(plan.anchors.length > 800, '挂点数量');
  assert.ok(plan.signs.length > 100, '霓虹数量');
  assert.ok(plan.posters.length > 20, '广告数量');
  assert.ok(plan.bridges.length > 5, '空中连廊');
  assert.ok(plan.stats.extent === WORLD.extent);
});

test('城市：同种子完全可复现', () => {
  const a = planCity();
  const b = planCity();
  assert.deepEqual(a.stats, b.stats);
  assert.deepEqual(a.spawn, b.spawn);
  assert.equal(a.boxes[10].max.x, b.boxes[10].max.x);
});

test('城市：碰撞盒合法（min < max，且不越界）', () => {
  const plan = planCity();
  const half = plan.cfg.extent / 2 + 160; // 高架地铁会伸出城区边界
  for (const b of plan.boxes) {
    assert.ok(b.min.x < b.max.x && b.min.y < b.max.y && b.min.z < b.max.z, '非法 AABB');
    assert.ok(b.min.x >= -half && b.max.x <= half, '碰撞盒越界 X');
    assert.ok(b.min.y >= -1e-6, '碰撞盒低于地面');
  }
});

test('城市：出生点位于某栋楼屋顶上方', () => {
  const plan = planCity();
  const spawn = plan.spawn;
  const roof = plan.buildings.find((b) =>
    Math.abs(b.x - spawn.x) < b.w * 0.5 && Math.abs(b.z - spawn.z) < b.d * 0.5);
  assert.ok(roof, '出生点必须落在建筑投影内');
  assert.ok(Math.abs(spawn.y - (roof.h + 1.2)) < 1e-6);
});

test('城市：挂点位于楼顶/连廊之上且带类型', () => {
  const plan = planCity();
  const types = new Set(plan.anchors.map((a) => a.type));
  assert.ok(types.has('edge') || types.has('corner'));
  assert.ok(types.has('bridge'));
  for (const a of plan.anchors) {
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z));
    assert.ok(a.y > 2, '挂点不应贴地');
  }
});

test('城市：高度图覆盖城区且非零', () => {
  const plan = planCity();
  const { data, size } = plan.heightMap;
  assert.equal(data.length, size * size);
  let max = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
  assert.ok(max > 20, '应记录到高层建筑');
  const hm = buildHeightMap(plan.buildings, plan.cfg.extent, 256);
  assert.equal(hm.size, 256);
  assert.equal(hm.data.length, 256 * 256);
});

test('城市：救援落点始终有效', () => {
  const plan = planCity();
  const spots = [
    findSafeSpot(plan, 0, 0),
    findSafeSpot(plan, 9999, -9999),
    findSafeSpot(plan, plan.spawn.x, plan.spawn.z),
  ];
  for (const s of spots) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
    assert.ok(s.y > 5, '救援点必须是高处');
  }
});

test('城市：车道沿街道，不与楼体重叠', () => {
  const plan = planCity();
  const half = plan.cfg.extent / 2;
  for (const lane of plan.lanes) {
    const local = ((lane.at + half) % plan.cfg.cell + plan.cfg.cell) % plan.cfg.cell;
    assert.ok(local > plan.cfg.block - 2, '车道应位于街道带内');
    assert.ok(lane.y > 10 && lane.y < 60);
  }
});

test('配置：三档画质权重递减、字段完整', () => {
  const order = ['high', 'medium', 'low'];
  for (const id of order) {
    const q = QUALITY[id];
    assert.ok(q, id + ' 档存在');
    for (const k of ['pixelRatio', 'windows', 'traffic', 'lodNear', 'fogFar', 'shadowMap']) {
      assert.ok(typeof q[k] === 'number', id + ' 缺少 ' + k);
    }
  }
  assert.ok(QUALITY.high.windows > QUALITY.medium.windows);
  assert.ok(QUALITY.medium.windows > QUALITY.low.windows);
  assert.ok(QUALITY.high.traffic > QUALITY.low.traffic);
  assert.equal(QUALITY.low.bloom, false);
});

test('配置：昼夜预设字段完整且曝光为正', () => {
  for (const [id, p] of Object.entries(PRESETS)) {
    assert.equal(p.id, id);
    for (const k of ['zenith', 'horizon', 'fog', 'sunDir', 'sunColor', 'ambientColor']) {
      assert.equal(p[k].length, 3, id + '.' + k);
    }
    assert.ok(p.exposure > 0);
    assert.ok(p.fogDensity > 0);
  }
});

test('配置：角色预设具备骨骼缩放与配色', () => {
  for (const c of Object.values(CHARACTERS)) {
    assert.ok(c.heightScale > 0.9 && c.heightScale < 1.1);
    assert.ok(c.shoulder > 0.7 && c.shoulder < 1.2);
    assert.equal(typeof c.accent, 'number');
    assert.ok(c.name.length > 0);
  }
  assert.ok(Object.keys(DISTRICTS).length >= 4);
});

test('配置：手感参数处于可玩区间', () => {
  assert.ok(TUNING.swing.range > 40 && TUNING.swing.range < 200);
  assert.ok(TUNING.swing.reelSpeed > 5);
  assert.ok(TUNING.air.gravity > 5 && TUNING.air.gravity < 60);
  assert.ok(TUNING.ground.jump > 5 && TUNING.ground.jump < 25);
  assert.ok(TUNING.air.diveMax > TUNING.air.maxSpeed, '俯冲上限应高于普通空中速度');
});
