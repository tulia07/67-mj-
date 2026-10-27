/** 快速视觉检查：立面 / 街道 / 摆荡 三张 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5308;
const OUT = 'docs/look';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server = spawn(process.execPath, ['server.js', String(PORT), '.'], { stdio: 'ignore' });
await sleep(700);
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1366,768', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  defaultViewport: { width: 1366, height: 768 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[PAGEERR]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[ERR]', m.text()); });

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('out'), { timeout: 240000, polling: 400 });
  await sleep(1000);
  await page.click('#startBtn');
  await sleep(2600);

  // 立面近景
  await page.evaluate(() => {
    const g = window.__game;
    const b = g.plan.buildings[Math.floor(g.plan.buildings.length / 2)];
    const p = g.player;
    p.rope.active = false;
    p.pos.set(b.x + b.w / 2 + 11, 34, b.z + b.d / 2 + 8);
    p.vel.set(0, 0, 0);
    p.state = 'air';
    g.cameraRig.yaw = Math.atan2(b.x - p.pos.x, b.z - p.pos.z);
    g.cameraRig.pitch = 0.12;
    g.cameraRig.dist = 6;
    g.cameraRig._init = false;
  });
  await sleep(900);
  await page.screenshot({ path: `${OUT}/a-facade.png` });

  // 街道（沿街心朝 +X 看）
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const lane = g.plan.lanes.find((l) => l.axis === 'x' && Math.abs(l.at) < 200) || g.plan.lanes[0];
    p.rope.active = false;
    p.pos.set(-260, 2.6, lane.at);
    p.vel.set(0, 0, 0);
    p.state = 'idle';
    g.cameraRig.yaw = Math.PI / 2;
    g.cameraRig.pitch = 0.06;
    g.cameraRig.dist = 6.6;
    g.cameraRig._init = false;
  });
  await sleep(900);
  await page.screenshot({ path: `${OUT}/b-street.png` });

  // 摆荡（按住左键保持挂绳，检查蛛丝可视）
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const lane = g.plan.lanes.find((l) => l.axis === 'x' && Math.abs(l.at) < 200) || g.plan.lanes[0];
    g.input.mouse.left = true;
    p.pos.set(-260, 68, lane.at);
    p.vel.set(18, 3, 0);
    p.state = 'air';
    p.targetAnchor = { x: -150, y: 108, z: lane.at, type: 'bridge' };
    p.tryAttach();
    g.cameraRig.yaw = Math.PI / 2;
    g.cameraRig.pitch = 0.02;
    g.cameraRig._init = false;
  });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/c-swing.png` });
  const st = await page.evaluate(() => {
    const p = window.__game.player;
    return { state: p.state, rope: p.rope.active, len: +p.rope.length.toFixed(1), speed: +p.totalSpeed.toFixed(1) };
  });
  console.log(JSON.stringify(st));
} finally {
  await browser.close();
  server.kill();
}
