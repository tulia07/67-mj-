/** 视觉截图采集：高画质 1600x900，用于文档与人工检查 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5299;
const SHOTS = 'docs/shots';
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server = spawn(process.execPath, ['server.js', String(PORT), '.'], { stdio: 'ignore' });
await sleep(700);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[PAGEERR]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[ERR]', m.text()); });

const waitGameTime = async (sec, timeoutMs = 240000) => {
  const start = Date.now();
  const t0 = await page.evaluate(() => window.__game.time);
  while (Date.now() - start < timeoutMs) {
    const t = await page.evaluate(() => window.__game.time);
    if (t - t0 >= sec) return;
    await sleep(120);
  }
  throw new Error('等待游戏时间超时');
};

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('out'), { timeout: 240000, polling: 400 });
  await sleep(1500);
  await page.screenshot({ path: `${SHOTS}/shot-menu.png` });

  await page.click('.char-card[data-char="male"]');
  await sleep(800);
  await page.screenshot({ path: `${SHOTS}/shot-menu-male.png` });

  await page.click('#startBtn');
  await waitGameTime(3.0);

  // 摆荡姿态定格：沿街心高空掠过（按住左键保持蛛丝）
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const lane = g.plan.lanes.find((l) => l.axis === 'x' && Math.abs(l.at) < 200) || g.plan.lanes[0];
    g.input.mouse.left = true;
    p.pos.set(-300, 46, lane.at);
    p.vel.set(8, 0, 0);
    p.state = 'air';
    p.targetAnchor = { x: -268, y: 82, z: lane.at, type: 'bridge' };
    p.tryAttach();
    g.cameraRig.yaw = -Math.PI / 2;
    g.cameraRig.pitch = 0.18;
    g.cameraRig.mode = 'play';
    g.cameraRig._init = false;
  });
  await waitGameTime(0.45);
  await page.screenshot({ path: `${SHOTS}/shot-swing.png` });

  // 街道视角（街区中段，沿街心看向楼群峡谷）
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    g.input.mouse.left = false;
    p.rope.active = false;
    const lane = g.plan.lanes.find((l) => l.axis === 'x' && Math.abs(l.at) < 200) || g.plan.lanes[0];
    const cross = g.plan.lanes.filter((l) => l.axis === 'z').map((l) => l.at).sort((a, b) => a - b);
    const midBlock = cross.length > 1 ? (cross[Math.floor(cross.length / 2) - 1] + cross[Math.floor(cross.length / 2)]) / 2 : -260;
    p.pos.set(midBlock, 2.6, lane.at);
    p.vel.set(0, 0, 0);
    p.state = 'idle';
    g.cameraRig.yaw = -Math.PI / 2;
    g.cameraRig.pitch = 0.06;
    g.cameraRig._init = false;
  });
  await waitGameTime(0.9);
  await page.screenshot({ path: `${SHOTS}/shot-street.png` });

  // 霓虹招牌 / 立面广告特写（站在广告正前方抬头看）
  const signInfo = await page.evaluate(() => {
    const g = window.__game;
    const signs = g.plan.signs || [];
    const tickers = g.plan.tickers || [];
    const posters = g.plan.posters || [];
    // 选一张中高区的立面海报：尺寸大、轮廓清楚，最能代表"广告墙"
    const pool = posters.filter((x) => x.y > 14 && x.y < 60).sort((a, b) => b.w - a.w);
    const s = pool[Math.floor(pool.length * 0.15)] || posters[0] || signs[0] || { x: -40, y: 16, z: 40, rotY: 0, w: 8, h: 12 };
    const nx = Math.sin(s.rotY);
    const nz = Math.cos(s.rotY);
    const p = g.player;
    p.rope.active = false;
    p.pos.set(s.x + nx * 30, Math.max(3, s.y - 1), s.z + nz * 30);
    p.vel.set(0, 0, 0);
    p.state = 'air';
    g.cameraRig.yaw = Math.atan2(nx, nz);
    g.cameraRig.pitch = 0.16;
    g.cameraRig._init = false;
    return { signs: signs.length, posters: posters.length, tickers: tickers.length, sample: { x: s.x, y: s.y, z: s.z, w: s.w } };
  });
  console.log('广告/招牌:', signInfo.signs, signInfo.posters, signInfo.tickers);
  await waitGameTime(0.8);
  await page.screenshot({ path: `${SHOTS}/shot-signs.png` });

  // 高空俯瞰
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    p.pos.set(80, 190, 220);
    p.vel.set(0, 0, 0);
    p.state = 'air';
    g.cameraRig.pitch = -0.42;
    g.cameraRig.yaw = 2.6;
    g.cameraRig._init = false;
  });
  await waitGameTime(0.7);
  await page.screenshot({ path: `${SHOTS}/shot-skyline.png` });

  // 深夜
  await page.evaluate(() => window.__game.setPreset('night'));
  await waitGameTime(0.5);
  await page.screenshot({ path: `${SHOTS}/shot-night.png` });

  await page.evaluate(() => window.__game.setPreset('dawn'));
  await waitGameTime(0.4);
  await page.screenshot({ path: `${SHOTS}/shot-dawn.png` });

  await page.evaluate(() => window.__game.setPreset('dusk'));
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(-30, 40, 90);
    g.player.vel.set(0, 0, 0);
    g.cameraRig.yaw = 2.2;
    g.cameraRig.pitch = 0.02;
    g.cameraRig._init = false;
  });
  await waitGameTime(0.5);
  await page.screenshot({ path: `${SHOTS}/shot-hero.png` });
  console.log('截图完成');
} finally {
  await browser.close();
  server.kill();
}
