import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { WORLD, QUALITY, PRESETS, CHARACTERS, TIPS, DISTRICTS, TUNING } from './config.js';
import { Progress, yieldFrame } from './core/Progress.js';
import { Assets } from './core/Assets.js';
import { Input } from './core/Input.js';
import { planCity } from './world/CityPlanner.js';
import { CityBuilder } from './world/CityBuilder.js';
import { Sky } from './world/Sky.js';
import { Character, AnimStateMachine } from './player/Character.js';
import { PlayerController } from './player/PlayerController.js';
import { WebLine } from './player/WebLine.js';
import { CinematicCamera } from './camera/CinematicCamera.js';
import { HUD } from './ui/HUD.js';
import { GameAudio } from './audio/GameAudio.js';

const $ = (id) => document.getElementById(id);

class Game {
  constructor() {
    this.canvas = $('scene');
    this.state = 'boot';
    this.qualityId = localStorage.getItem('cm_quality') || 'high';
    this.presetId = localStorage.getItem('cm_preset') || 'dusk';
    this.charId = localStorage.getItem('cm_char') || 'male';
    this.sensitivity = parseFloat(localStorage.getItem('cm_sens') || '1');
    this.audioOn = localStorage.getItem('cm_audio') !== 'off';

    this.clock = new THREE.Clock();
    this.time = 0;
    this.fpsSmooth = 60;
    this.districtTimer = 0;
    this.milestone = 0;
    this.lastNoAnchorToast = 0;
    this.character = null;
    this.player = null;
    this.city = null;
    this.sky = null;
    this.assets = null;
    this.composer = null;
    this.bloom = null;
    this.shadowCatcher = null;
    this.menuCharPreview = null;
    this.errors = [];
    this.frameCount = 0;
  }

  // ============================== 启动 ==============================
  async boot() {
    this.progress = new Progress($('loading'));
    this.progress.define([
      { key: 'render', label: '初始化渲染管线', weight: 6 },
      { key: 'textures', label: '解码 WebP 贴图', weight: 20 },
      { key: 'plan', label: '规划城市街区', weight: 14 },
      { key: 'build', label: '合批建筑与霓虹', weight: 30 },
      { key: 'rig', label: '装配角色骨骼', weight: 12 },
      { key: 'warm', label: '预热着色器', weight: 18 },
    ]);
    const tipEl = $('loadTip');
    let tipIndex = 0;
    tipEl.textContent = '提示：' + TIPS[0];
    const tipTimer = setInterval(() => {
      tipIndex = (tipIndex + 1) % TIPS.length;
      tipEl.textContent = '提示：' + TIPS[tipIndex];
    }, 4200);
    const uiLoop = () => {
      this.progress.tick(1 / 60);
      if (this.state === 'boot') requestAnimationFrame(uiLoop);
      else clearInterval(tipTimer);
    };
    requestAnimationFrame(uiLoop);

    try {
      await this._initRenderer();
      this.progress.begin('textures');
      await yieldFrame();
      this.assets = new Assets('./assets/textures/');
      let texDone = 0;
      await this.assets.loadManifest();
      const totalBytes = this.assets.bytes;
      await this.assets.loadAll((done, total, file) => {
        texDone = done / total;
        this.progress.set('textures', texDone, '已解码 ' + done + '/' + total + ' · ' + (totalBytes / 1024).toFixed(0) + ' KB');
      });
      $('loadStats').innerHTML =
        `${this.assets.manifest.items.length} 张 WebP<br>${(totalBytes / 1024).toFixed(0)} KB<br>${this.progress.tasks.length} 个构建阶段`;

      this.progress.begin('plan');
      await yieldFrame();
      this.plan = planCity({ seed: WORLD.seed });
      this.progress.set('plan', 1, `${this.plan.stats.buildings} 栋建筑 · ${this.plan.stats.anchors} 个挂点 · ${this.plan.stats.boxes} 个碰撞体`);
      this.progress.log('· 街区网格 ' + this.plan.cfg.extent + 'm / ' + this.plan.stats.buildings + ' 栋');

      this.progress.begin('build');
      await yieldFrame();
      this.city = new CityBuilder(this.scene, this.plan, this.assets, QUALITY[this.qualityId], PRESETS[this.presetId]);
      await this.city.build((f, label) => {
        this.progress.set('build', f, label);
      });

      this.progress.begin('rig');
      await yieldFrame();
      await this._buildCharacter(this.charId, true);
      this.progress.set('rig', 0.6, '烘焙骨骼动画剪辑');
      await yieldFrame();
      this.progress.set('rig', 1, this.character.clips.size + ' 段动画 · 19 根骨骼');

      this.web = new WebLine(this.scene, this.assets);
      this._handWorld = new THREE.Vector3();
      this._webTarget = new THREE.Vector3();

      this.progress.begin('warm');
      await yieldFrame();
      this._setupPlayer();
      this._setupComposer();
      this.progress.set('warm', 0.35, '编译着色器');
      await yieldFrame();
      if (this.renderer.compile) this.renderer.compile(this.scene, this.camera);
      this.progress.set('warm', 0.75, '预渲染首帧');
      await yieldFrame();
      this.renderer.render(this.scene, this.camera);
      this.progress.set('warm', 1, '就绪');

      this.progress.complete();
      await new Promise((r) => setTimeout(r, 380));
      $('loading').classList.add('out');
      this._enterMenu();
      this.clock.start();
      this._loop();
    } catch (err) {
      console.error('[boot] 初始化失败', err);
      this.progress.fail(err);
      $('loadDetail').textContent = '初始化失败：' + (err && err.message ? err.message : err);
    }
  }

  async _initRenderer() {
    this.progress.begin('render');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.qualityId !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[this.qualityId].maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = PRESETS[this.presetId].exposure;
    this.renderer.shadowMap.enabled = QUALITY[this.qualityId].shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5200);

    this.sky = new Sky(this.scene, PRESETS[this.presetId], QUALITY[this.qualityId]);

    // 接受阴影的地面（在自定义地面着色器之上，只承接角色/装置投影）
    const shadowGeo = new THREE.PlaneGeometry(340, 340);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadowCatcher = new THREE.Mesh(shadowGeo, new THREE.ShadowMaterial({ opacity: 0.34 }));
    this.shadowCatcher.position.y = 0.06;
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.visible = QUALITY[this.qualityId].shadows;
    this.scene.add(this.shadowCatcher);

    this.hud = new HUD();
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.sensitivity;
    this.input.bindDragLook();
    this.audio = new GameAudio();
    this.audio.setEnabled(this.audioOn);

    this.cameraRig = new CinematicCamera(this.camera, QUALITY[this.qualityId]);
    this._bindUI();
    this._bindErrors();
    window.addEventListener('resize', () => this._resize());

    this.progress.set('render', 1, this.renderer.capabilities.isWebGL2 ? 'WebGL2 就绪' : 'WebGL1 兼容模式');
  }

  _setupComposer() {
    const q = QUALITY[this.qualityId];
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      q.bloomStrength * PRESETS[this.presetId].bloom,
      q.bloomRadius,
      q.bloomThreshold
    );
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  async _buildCharacter(id, first = false) {
    if (this.character) {
      this.character.dispose();
      this.character = null;
    }
    const variant = CHARACTERS[id];
    this.character = new Character(variant);
    this.anim = new AnimStateMachine(this.character);
    this.scene.add(this.character.group);
    this.character.group.position.set(this.plan.spawn.x, this.plan.spawn.y, this.plan.spawn.z);
    this.character.play('idle', 0);
    if (this.player) {
      this.player.character = this.character;
      this.player.anim = this.anim;
      this.player.agilityMul = id === 'female' ? 1.12 : 0.95;
      this._setupPlayerHook();
    }
    if (!first) await yieldFrame();
  }

  _setupPlayer() {
    this.player = new PlayerController(this.plan, QUALITY[this.qualityId]);
    this.player.attachWorld(this.plan.boxes, this.plan.anchors);
    this.player.character = this.character;
    this.player.anim = this.anim;
    this.player.agilityMul = this.charId === 'female' ? 1.12 : 0.95;
    this.player.reset(this.plan.spawn);
    this._setupPlayerHook();
    this._placeCameraAtSpawn();
  }

  _setupPlayerHook() {
    if (!this.player) return;
    this.player.character = this.character;
    this.player.anim = this.anim;
  }

  _placeCameraAtSpawn() {
    const spawn = this.plan.spawn;
    const dir = new THREE.Vector3(0 - spawn.x, 0, 0 - spawn.z).normalize();
    this.cameraRig.yaw = Math.atan2(-dir.x, -dir.z);
    this.cameraRig.pitch = -0.06;
    this.cameraRig.mode = 'play';
    this.cameraRig._init = false;
    this.cameraRig.dist = TUNING.camera.baseDist;
  }

  // ============================== 流程 ==============================
  _enterMenu() {
    this.state = 'menu';
    this.hud.showHUD(false);
    $('menu').classList.remove('hidden');
    if (this.web) {
      this.web.amount = 0;
      this.web.core.visible = false;
      this.web.glow.visible = false;
      this.web.burstMat.opacity = 0;
    }
    this.character.group.position.set(this.plan.spawn.x, this.plan.spawn.y, this.plan.spawn.z);
    this.character.group.rotation.y = Math.PI * 0.85;
    this.anim.set('idle', { fade: 0, force: true });
    this.cameraRig.mode = 'menu';
    this.input.setEnabled(false);
    this._syncMenuButtons();
    if (this.plan) {
      $('menuClock').textContent = this.presetId === 'night' ? '01:12' : this.presetId === 'dawn' ? '05:48' : this.presetId === 'noon' ? '12:30' : '19:42';
    }
  }

  startGame() {
    if (this.state === 'menu') {
      $('menu').classList.add('hidden');
    }
    this.hud.showHUD(true);
    this.hud.setQuality(this.qualityId);
    this.hud.setPreset(this.presetId);
    this.player.reset(this.plan.spawn);
    this._placeCameraAtSpawn();
    this.state = 'playing';
    this.hud.fadeTo(false);
    if (this.sky) this.sky.applyPreset(PRESETS[this.presetId]);
    this.input.setEnabled(true);
    this.audio.init();
    this.audio.resume();
    // 开场镜头
    const spawn = this.plan.spawn;
    this.cameraRig.startIntro(
      new THREE.Vector3(spawn.x + 52, spawn.y + 34, spawn.z + 58),
      new THREE.Vector3(spawn.x, spawn.y + 1, spawn.z)
    );
    if (this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
    this.hud.toast('抵达 ' + (DISTRICTS[spawn.district] ? DISTRICTS[spawn.district].label : '城区') + ' · 按住左键开始摆荡', 'hot');
    this._updateDistrict(true);
  }

  pause(reason = 'manual') {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.setEnabled(false);
    this.hud.setPauseStats(this.player);
    $('pause').classList.remove('hidden');
    this._syncMenuButtons();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    $('pause').classList.add('hidden');
    this.state = 'playing';
    this.input.setEnabled(true);
    this.audio.resume();
    if (this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  respawn() {
    $('pause').classList.add('hidden');
    this.state = 'playing';
    this.input.setEnabled(true);
    this.player.forceRescue();
    this.hud.fadeTo(false);
    this.hud.toast('已重新部署到最近的 rooftops', '');
    if (this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  toMenu() {
    $('pause').classList.add('hidden');
    this.hud.showHUD(false);
    this.state = 'menu';
    if (document.pointerLockElement) document.exitPointerLock();
    this._enterMenu();
  }

  setQuality(id) {
    if (!QUALITY[id]) return;
    this.qualityId = id;
    localStorage.setItem('cm_quality', id);
    const q = QUALITY[id];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxPixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sky.sun.castShadow = q.shadows;
    this.sky.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    if (this.sky.sun.shadow.map) {
      this.sky.sun.shadow.map.dispose();
      this.sky.sun.shadow.map = null;
    }
    this.shadowCatcher.visible = q.shadows;
    if (this.city) this.city.setQuality(q);
    if (this.city && this.city.traffic) this.city.traffic.setQuality(q);
    if (this.bloom) {
      this.bloom.enabled = q.bloom;
      this.bloom.strength = q.bloomStrength * PRESETS[this.presetId].bloom;
    }
    if (this.city) this.city.quality = q;
    this.scene.fog.density = PRESETS[this.presetId].fogDensity * (id === 'low' ? 1.28 : 1);
    this.hud.setQuality(id);
    this._syncMenuButtons();
    this.hud.toast('画质：' + q.label + ' · ' + q.desc);
  }

  setPreset(id) {
    if (!PRESETS[id]) return;
    this.presetId = id;
    localStorage.setItem('cm_preset', id);
    const preset = PRESETS[id];
    this.sky.applyPreset(preset);
    if (this.city) this.city.applyPreset(preset);
    this.renderer.toneMappingExposure = preset.exposure;
    if (this.bloom) {
      this.bloom.strength = QUALITY[this.qualityId].bloomStrength * preset.bloom;
      this.bloom.radius = QUALITY[this.qualityId].bloomRadius;
    }
    this.scene.fog.density = preset.fogDensity * (this.qualityId === 'low' ? 1.28 : 1);
    this.hud.setPreset(id);
    this._syncMenuButtons();
    if (this.plan) $('menuClock').textContent = id === 'night' ? '01:12' : id === 'dawn' ? '05:48' : id === 'noon' ? '12:30' : '19:42';
    if (this.state === 'playing') this.hud.toast('光照预设：' + preset.label);
  }

  setCharacter(id, fromMenu = true) {
    if (!CHARACTERS[id] || id === this.charId) return;
    this.charId = id;
    localStorage.setItem('cm_char', id);
    this._buildCharacter(id, true);
    this.hud.toast('角色：' + CHARACTERS[id].name, id === 'female' ? 'hot' : '');
    this._syncMenuButtons();
  }

  // ============================== UI 绑定 ==============================
  _bindUI() {
    document.querySelectorAll('.char-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.char-card').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.setCharacter(btn.dataset.char);
        this.audio.init();
        this.audio.resume();
        this.audio.ui();
      });
    });
    $('startBtn').addEventListener('click', () => {
      this.audio.init();
      this.audio.resume();
      this.audio.ui();
      this.startGame();
    });
    const bindSeg = (rootId, attr, fn) => {
      document.querySelectorAll('#' + rootId + ' button').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.audio.ui();
          fn(btn.dataset[attr]);
        });
      });
    };
    bindSeg('qualityGroup', 'q', (v) => this.setQuality(v));
    bindSeg('presetGroup', 'p', (v) => this.setPreset(v));
    bindSeg('pauseQuality', 'q', (v) => this.setQuality(v));
    bindSeg('pausePreset', 'p', (v) => this.setPreset(v));

    $('resumeBtn').addEventListener('click', () => this.resume());
    $('restartBtn').addEventListener('click', () => this.respawn());
    $('menuBtn').addEventListener('click', () => this.toMenu());
    $('helpBtn').addEventListener('click', () => $('help').classList.remove('hidden'));
    $('helpClose').addEventListener('click', () => $('help').classList.add('hidden'));
    $('audioBtn').addEventListener('click', () => {
      this.audioOn = !this.audioOn;
      localStorage.setItem('cm_audio', this.audioOn ? 'on' : 'off');
      this.audio.setEnabled(this.audioOn);
      $('audioBtn').classList.toggle('on', this.audioOn);
      $('audioBtn').textContent = '音效 ' + (this.audioOn ? '开' : '关');
    });
    $('sensRange').addEventListener('input', (e) => {
      this.sensitivity = parseFloat(e.target.value);
      this.input.sensitivity = this.sensitivity;
      $('sensVal').textContent = this.sensitivity.toFixed(2);
      localStorage.setItem('cm_sens', String(this.sensitivity));
    });
    $('sensRange').value = String(this.sensitivity);
    $('sensVal').textContent = this.sensitivity.toFixed(2);
    $('audioBtn').classList.toggle('on', this.audioOn);
    $('audioBtn').textContent = '音效 ' + (this.audioOn ? '开' : '关');

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause('lock');
    };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      } else if (e.code === 'KeyH') {
        if (this.state === 'playing' || this.state === 'paused') {
          $('help').classList.toggle('hidden');
        }
      } else if (e.code === 'F3') {
        e.preventDefault();
        this.hud.toggleDebug();
      } else if (e.code === 'KeyR' && this.state === 'playing') {
        this.player.forceRescue();
      } else if (e.code === 'Enter' && (this.state === 'menu' || this.state === 'paused')) {
        if (this.state === 'menu') this.startGame();
        else this.resume();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause('hidden');
    });
  }

  _syncMenuButtons() {
    document.querySelectorAll('.char-card').forEach((b) => {
      b.classList.toggle('selected', b.dataset.char === this.charId);
    });
    const sync = (rootId, attr, value) => {
      document.querySelectorAll('#' + rootId + ' button').forEach((b) => {
        b.classList.toggle('active', b.dataset[attr] === value);
      });
    };
    sync('qualityGroup', 'q', this.qualityId);
    sync('pauseQuality', 'q', this.qualityId);
    sync('presetGroup', 'p', this.presetId);
    sync('pausePreset', 'p', this.presetId);
  }

  _bindErrors() {
    window.addEventListener('error', (e) => {
      this.errors.push(e.message);
      this.hud.toast('运行异常：' + e.message, 'warn');
      console.error('[window.error]', e.message, e.filename, e.lineno);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
      this.errors.push(msg);
      this.hud.toast('未处理的异步异常：' + msg, 'warn');
      console.error('[unhandledrejection]', e.reason);
    });
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
    if (this.bloom) this.bloom.setSize(w, h);
  }

  // ============================== 主循环 ==============================
  _loop() {
    requestAnimationFrame(() => this._loop());
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05);
    this.time += dt;
    this.fpsSmooth = this.fpsSmooth * 0.92 + (raw > 0 ? 1 / raw : 60) * 0.08;
    this.frameCount++;

    if (this.state === 'menu') {
      this._updateMenu(dt);
    } else if (this.state === 'playing') {
      this._updatePlay(dt);
    } else {
      // 暂停：保持画面但不再推进模拟
      if (this.state === 'paused') {
        this.city.update(0, this.time, this.camera, this.player ? this.player.pos : null);
        this.sky.update(0, this.camera, this.time, this.player ? this.player.pos : null);
      }
    }

    this._render();
  }

  _updateMenu(dt) {
    if (this.character) {
      this.anim.update(dt);
      this.character.group.position.y = this.plan.spawn.y + Math.sin(this.time * 1.2) * 0.02;
      // 角色缓慢转向镜头，展示模型细节
      const cam = this.camera.position;
      const targetYaw = Math.atan2(cam.x - this.character.group.position.x, cam.z - this.character.group.position.z);
      let diff = targetYaw - this.character.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.character.group.rotation.y += diff * Math.min(1, dt * 2.4);
    }
    const center = this.character ? this.character.group.position : new THREE.Vector3();
    this.cameraRig.menuOrbit(this.time, center, 5.0, 1.42, 1.12);
    this.sky.update(dt, this.camera, this.time, center);
    // 菜单是人物特写，补光比游戏中更亮
    if (this.sky) this.sky.fill.intensity = this.presetId === 'night' ? 200 : 165;
    if (this.city) this.city.update(dt, this.time, this.camera, center);
    if (this.shadowCatcher) this.shadowCatcher.position.set(center.x, 0.06, center.z);
  }

  _updatePlay(dt) {
    const look = this.input.consumeLook();
    if (look.x || look.y) this.cameraRig.addLook(look.x, look.y);

    this.player.update(dt, this.input, this.cameraRig.yaw, this.cameraRig.forward);
    this._handlePlayerEvents();
    this._updateWeb(dt);

    this.cameraRig.update(dt, this.player);

    this.sky.update(dt, this.camera, this.time, this.player.pos);
    this.city.update(dt, this.time, this.camera, this.player.pos);
    if (this.shadowCatcher) this.shadowCatcher.position.set(this.player.pos.x, 0.06, this.player.pos.z);

    this.audio.update(dt, this.player.totalSpeed, this.player.state);

    this.districtTimer -= dt;
    if (this.districtTimer <= 0) {
      this.districtTimer = 0.5;
      this._updateDistrict();
    }

    // 里程碑反馈
    if (this.player.distance > this.milestone + 500) {
      this.milestone = Math.floor(this.player.distance / 500) * 500;
      this.hud.toast('里程 ' + this.milestone + ' m · 保持流动', 'hot');
    }

    this.hud.update(dt, {
      player: this.player,
      camera: this.camera,
      targetAnchor: this.player.targetAnchor,
      anchorBlocked: false,
      rendererInfo: this.renderer.info,
      canWarn: this.state === 'playing',
    });
    this.input.endFrame();
  }

  _handlePlayerEvents() {
    const player = this.player;
    player.drainEvents((type, data) => {
      switch (type) {
        case 'swing':
          this.audio.swing();
          if (this.web) this.web.fire(data.anchor);
          if (data.chain >= 3) this.hud.toast('连摆 x' + data.chain, 'hot');
          break;
        case 'release':
          this.audio.release();
          break;
        case 'land':
          this.audio.land(data.speed);
          this.cameraRig.shake(Math.min(0.75, data.speed / 42));
          if (data.hard) this.hud.toast('重落地 · ' + Math.round(data.speed) + ' m/s', 'warn');
          break;
        case 'impact':
          this.audio.land(data.speed * 0.5);
          this.cameraRig.shake(Math.min(0.5, data.speed / 60));
          break;
        case 'jump':
          this.audio.jump();
          break;
        case 'wallJump':
          this.audio.wall();
          this.cameraRig.shake(0.16);
          break;
        case 'wallrun':
          this.audio.wall();
          break;
        case 'zip':
          this.audio.zip();
          if (this.web) this.web.fire(data.anchor, true);
          this.hud.toast('牵引索锁定', '');
          break;
        case 'glide':
          this.hud.toast('滑翔翼展开', '');
          break;
        case 'dive':
          this.hud.toast('俯冲加速', 'warn');
          break;
        case 'rescue':
          this.audio.rescue();
          this.hud.flash();
          this.cameraRig.shake(0.4);
          this.hud.toast('救援系统：已送回最近的高点', 'warn');
          break;
        case 'noAnchor':
          this.audio.denied();
          if (this.time - this.lastNoAnchorToast > 2.2) {
            this.lastNoAnchorToast = this.time;
            this.hud.toast('没有可用挂点：抬高准星，靠近高楼或空中连廊', 'warn');
          }
          break;
        default:
          break;
      }
    });
  }

  _updateWeb(dt) {
    if (!this.web || !this.character || !this.player) return;
    const p = this.player;
    const hand = this.character.getHandWorld(this._handWorld);
    let active = false;
    let target = this._webTarget;
    let hot = false;
    if (p.rope.active) {
      active = true;
      target.copy(p.rope.anchor);
    } else if (p.state === 'zip' && p.zipTimer > 0) {
      active = true;
      target.copy(p.zipTarget);
      hot = true;
    }
    const speed = p.totalSpeed || 0;
    const tension = Math.min(1, speed / 46);
    this.web.hot = hot;
    this.web.update(dt, hand, target, active, tension);
  }

  _updateDistrict(force = false) {
    if (!this.player) return;
    const pos = this.player.pos;
    let nearest = null;
    let bestD = Infinity;
    for (const b of this.plan.buildings) {
      const d = Math.abs(b.x - pos.x) + Math.abs(b.z - pos.z);
      if (d < bestD) { bestD = d; nearest = b; }
    }
    if (!nearest) return;
    const key = nearest.district;
    if (force || this._districtKey !== key) {
      this._districtKey = key;
      const d = DISTRICTS[key] || DISTRICTS.midtown;
      this.hud.setDistrict(d.label, d.sub);
      if (!force) this.hud.toast('进入 ' + d.label, '');
    }
  }

  _render() {
    const q = QUALITY[this.qualityId];
    if (q.bloom && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// ============================== 启动 ==============================
const game = new Game();
window.__game = game;
game.boot();
