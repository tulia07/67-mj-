/**
 * 自动化冒烟测试：真实浏览器（Edge/Chrome）+ 本地静态服务器
 * - 捕获所有 console 错误 / pageerror / 失败请求
 * - 走完 加载 → 菜单 → 进入游戏 → 摆荡 → 暂停 → 切换画质/昼夜 全流程
 * - 输出截图到 docs/shots/
 *
 * 用法：npm run test:smoke
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.SMOKE_PORT || 5199);
const SHOTS = 'docs/shots';
const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const executablePath = process.env.BROWSER_PATH || CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('未找到 Edge/Chrome，可通过 BROWSER_PATH 指定');
  process.exit(2);
}
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const errors = [];
const warnings = [];
const failedRequests = [];

const server = spawn(process.execPath, ['server.js', String(PORT), '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/index.html`);
      if (r.ok) return true;
    } catch {}
    await sleep(200);
  }
  throw new Error('服务器未就绪');
}

let browser;
try {
  await waitServer();
  browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: [
      '--window-size=1600,900',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--disable-dev-shm-usage',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    defaultViewport: { width: 1600, height: 900 },
  });

  const page = await browser.newPage();
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') errors.push(text);
    else if (type === 'warning') warnings.push(text);
    else if (type === 'log') process.stdout.write('[page] ' + text + '\n');
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('requestfailed', (req) => failedRequests.push(req.url() + ' :: ' + (req.failure() || {}).errorText));

  console.log('\n=== 打开页面 ===');
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('=== 等待真实加载完成 ===');
  const t0 = Date.now();
  await page.waitForFunction(() => {
    const load = document.getElementById('loading');
    return load && load.classList.contains('out');
  }, { timeout: 240000, polling: 500 });
  console.log(`加载耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const menuVisible = await page.$eval('#menu', (el) => !el.classList.contains('hidden'));
  console.log('菜单可见:', menuVisible);
  await sleep(1200);
  await page.screenshot({ path: `${SHOTS}/01-menu.png` });

  // 加载统计
  const bootInfo = await page.evaluate(() => ({
    buildings: window.__game.plan.stats.buildings,
    anchors: window.__game.plan.stats.anchors,
    boxes: window.__game.plan.stats.boxes,
    props: window.__game.plan.stats.props,
    clips: window.__game.character.clips.size,
    bones: window.__game.character.bones.length,
    textures: Object.keys(window.__game.assets.textures).length,
    webgl2: window.__game.renderer.capabilities.isWebGL2,
  }));
  console.log('构建信息:', bootInfo);

  // 选择女性角色
  await page.click('.char-card[data-char="female"]');
  await sleep(600);
  const charSwitched = await page.evaluate(() => window.__game.character.variant.id);
  console.log('切换角色:', charSwitched);

  // 进入游戏
  console.log('=== 进入游戏 ===');
  await page.click('#startBtn');
  await sleep(3200);
  await page.screenshot({ path: `${SHOTS}/02-gameplay.png` });

  const posA = await page.evaluate(() => ({ ...window.__game.player.pos }));
  const stateA = await page.evaluate(() => window.__game.player.state);
  console.log('初始位置:', posA, '状态:', stateA);

  // 前进 + 跳跃 + 摆荡
  console.log('=== 模拟移动与摆荡 ===');
  await page.keyboard.down('KeyW');
  await page.mouse.move(800, 450);
  await sleep(700);
  await page.keyboard.press('Space');
  await sleep(420);
  await page.mouse.down({ button: 'left' });
  await sleep(1600);
  await page.screenshot({ path: `${SHOTS}/03-swing.png` });
  const swingState = await page.evaluate(() => ({
    state: window.__game.player.state,
    rope: window.__game.player.rope.active,
    speed: window.__game.player.totalSpeed,
    anchor: window.__game.player.rope.anchor,
    webVisible: window.__game.web ? Number(window.__game.web.amount.toFixed(2)) : 0,
  }));
  console.log('摆荡状态:', swingState);
  await page.mouse.up({ button: 'left' });
  await page.keyboard.down('ShiftLeft');
  await sleep(700);
  await page.keyboard.up('ShiftLeft');
  await sleep(900);
  await page.screenshot({ path: `${SHOTS}/04-air.png` });
  await page.keyboard.up('KeyW');
  await sleep(1600);

  const posB = await page.evaluate(() => ({ ...window.__game.player.pos }));
  const moved = Math.hypot(posB.x - posA.x, posB.y - posA.y, posB.z - posA.z);
  const maxSpeed = await page.evaluate(() => window.__game.player.maxSpeed);
  console.log('位移:', moved.toFixed(1) + 'm', '峰值:', (maxSpeed * 3.6).toFixed(0) + ' km/h');

  const hud = await page.evaluate(() => ({
    speed: document.getElementById('speedValue').textContent,
    alt: document.getElementById('altValue').textContent,
    state: document.getElementById('stateLabel').textContent,
    district: document.getElementById('districtName').textContent,
  }));
  console.log('HUD:', hud);

  // 暂停
  console.log('=== 暂停 / 画质 / 昼夜 ===');
  await page.keyboard.press('Escape');
  await sleep(700);
  const paused = await page.evaluate(() => window.__game.state);
  await page.screenshot({ path: `${SHOTS}/05-pause.png` });
  console.log('暂停状态:', paused);

  await page.click('#pauseQuality button[data-q="low"]');
  await sleep(700);
  await page.click('#pausePreset button[data-p="night"]');
  await sleep(900);
  await page.click('#resumeBtn');
  await sleep(2600);
  await page.screenshot({ path: `${SHOTS}/06-night-low.png` });

  const afterQuality = await page.evaluate(() => ({
    quality: window.__game.qualityId,
    preset: window.__game.presetId,
    drawCalls: window.__game.renderer.info.render.calls,
    triangles: window.__game.renderer.info.render.triangles,
    fps: window.__game.fpsSmooth,
    rolling: window.__game.state,
  }));
  console.log('低画质/深夜:', afterQuality);

  // 帮助面板
  await page.keyboard.press('KeyH');
  await sleep(400);
  const helpVisible = await page.$eval('#help', (el) => !el.classList.contains('hidden'));
  await page.screenshot({ path: `${SHOTS}/07-help.png` });
  await page.keyboard.press('KeyH');
  await sleep(300);

  // 帧率采样
  const perf = await page.evaluate(async () => {
    const samples = [];
    let last = performance.now();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      samples.push(now - last);
      last = now;
    }
    samples.sort((a, b) => a - b);
    return {
      medianMs: samples[Math.floor(samples.length / 2)],
      p90Ms: samples[Math.floor(samples.length * 0.9)],
    };
  });
  console.log('帧时间(软件渲染):', perf);

  await page.screenshot({ path: `${SHOTS}/08-final.png` });

  // 汇总
  const report = {
    ok:
      errors.length === 0 &&
      failedRequests.length === 0 &&
      menuVisible &&
      paused === 'paused' &&
      moved > 5 &&
      helpVisible &&
      swingState.rope === true &&
      swingState.webVisible > 0.4,
    moved: Number(moved.toFixed(1)),
    maxSpeedKmh: Math.round(maxSpeed * 3.6),
    swingState,
    bootInfo,
    afterQuality,
    perf,
    errors,
    failedRequests,
    warnings: warnings.slice(0, 12),
  };
  console.log('\n=== 结果 ===');
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    console.error('\n冒烟测试未通过');
    process.exitCode = 1;
  } else {
    console.log('\n冒烟测试通过 ✓');
  }
} catch (err) {
  console.error('冒烟测试异常:', err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill();
}
