import * as THREE from 'three';
import { PRESETS, QUALITY } from '../config.js';

const STATE_LABEL = {
  idle: '待机',
  run: '奔跑',
  air: '腾空',
  swing: '蛛丝摆荡',
  zip: '牵引索',
  glide: '滑翔',
  dive: '俯冲',
  wallrun: '墙跑',
  land: '落地',
  ground: '待机',
  rescue: '救援',
};

const STATE_CLASS = {
  air: 'air', swing: 'swing', dive: 'dive', glide: 'glide', wallrun: 'wallrun', zip: 'wallrun',
};

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      speedValue: $('speedValue'),
      speedArc: $('speedArc'),
      speedBar: $('speedBar'),
      altValue: $('altValue'),
      vSpeedValue: $('vSpeedValue'),
      ropeValue: $('ropeValue'),
      distanceValue: $('distanceValue'),
      maxSpeedValue: $('maxSpeedValue'),
      stateLabel: $('stateLabel'),
      flowPips: $('flowPips'),
      flowValue: $('flowValue'),
      districtName: $('districtName'),
      districtSub: $('districtSub'),
      objective: $('objective'),
      reticle: $('reticle'),
      retLabel: document.querySelector('#reticle .ret-label'),
      anchorState: $('anchorState'),
      toasts: $('toasts'),
      hintBar: $('hintBar'),
      fpsValue: $('fpsValue'),
      qualityTag: $('qualityTag'),
      presetTag: $('presetTag'),
      fade: $('fade'),
      debugPanel: $('debugPanel'),
      perfWarn: $('perfWarn'),
      app: $('app'),
    };
    this.fps = 60;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.lastFpsUpdate = 0;
    this.pips = [];
    for (let i = 0; i < 9; i++) {
      const p = document.createElement('i');
      this.el.flowPips.appendChild(p);
      this.pips.push(p);
    }
    this._cache = new Map();
    this._vec = new THREE.Vector3();
    this.debug = false;
    this.perfTimer = 0;
    this.lowFpsWarned = false;
  }

  set(key, text) {
    if (this._cache.get(key) === text) return;
    this._cache.set(key, text);
    const node = this.el[key];
    if (node) node.textContent = text;
  }

  showHUD(v) {
    this.el.hud.classList.toggle('hidden', !v);
  }

  setQuality(q) {
    const def = QUALITY[q] || QUALITY.high;
    this.el.qualityTag.textContent = def.id.toUpperCase();
  }

  setPreset(p) {
    this.el.presetTag.textContent = (PRESETS[p] || PRESETS.dusk).label;
  }

  setDistrict(name, sub) {
    this.set('districtName', name);
    this.set('districtSub', sub);
  }

  toast(text, kind = '') {
    const div = document.createElement('div');
    div.className = 'toast ' + kind;
    div.textContent = text;
    this.el.toasts.appendChild(div);
    setTimeout(() => div.remove(), 2100);
    while (this.el.toasts.childElementCount > 4) this.el.toasts.firstChild.remove();
  }

  flash() {
    this.el.fade.classList.remove('flash');
    void this.el.fade.offsetWidth;
    this.el.fade.classList.add('flash');
    setTimeout(() => this.el.fade.classList.remove('flash'), 620);
  }

  fadeTo(on) {
    this.el.fade.classList.toggle('on', on);
  }

  update(dt, ctx) {
    const { player, camera, targetAnchor, anchorBlocked } = ctx;
    const speedKmh = player.totalSpeed * 3.6;
    this.set('speedValue', String(Math.round(speedKmh)));
    const ratio = Math.min(1, speedKmh / 340);
    this.el.speedArc.style.strokeDashoffset = String(100 - ratio * 100);
    this.el.speedArc.style.stroke = ratio > 0.62 ? 'var(--magenta)' : 'var(--cyan)';
    this.el.speedBar.style.width = (ratio * 100).toFixed(1) + '%';
    this.el.app.style.setProperty('--sp', Math.min(1, ratio * 0.95).toFixed(3));

    this.set('altValue', Math.round(player.pos.y).toString());
    this.set('vSpeedValue', (player.vel.y >= 0 ? '+' : '') + player.vel.y.toFixed(1));
    this.set('ropeValue', player.rope.active ? player.rope.length.toFixed(1) : '--');
    this.set('distanceValue', Math.round(player.distance).toLocaleString('en-US'));
    this.set('maxSpeedValue', Math.round(player.maxSpeed * 3.6).toString());

    const label = STATE_LABEL[player.state] || player.state;
    this.set('stateLabel', label);
    const cls = STATE_CLASS[player.state] || '';
    if (this.el.stateLabel.dataset.cls !== cls) {
      this.el.stateLabel.dataset.cls = cls;
      this.el.stateLabel.className = 'state-chip ' + cls;
    }

    this.set('flowValue', 'x' + player.flow);
    for (let i = 0; i < this.pips.length; i++) {
      const on = i < player.flow;
      const p = this.pips[i];
      if (p.classList.contains('on') !== on) p.classList.toggle('on', on);
      const hot = on && i >= 6;
      if (p.classList.contains('hot') !== hot) p.classList.toggle('hot', hot);
    }

    // 准星挂点
    if (targetAnchor) {
      this._vec.set(targetAnchor.x, targetAnchor.y, targetAnchor.z).project(camera);
      const behind = this._vec.z > 1;
      const x = (this._vec.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-this._vec.y * 0.5 + 0.5) * window.innerHeight;
      if (!behind && x > 0 && x < window.innerWidth && y > 0 && y < window.innerHeight) {
        this.el.reticle.classList.add('visible');
        this.el.reticle.style.transform = `translate(${x}px, ${y}px)`;
        this.el.reticle.style.left = '0px';
        this.el.reticle.style.top = '0px';
        this.el.reticle.style.margin = '-27px 0 0 -27px';
        this.el.reticle.classList.remove('blocked');
        this.set('anchorState', '就绪');
        this.el.retLabel.textContent = targetAnchor.type === 'bridge' ? '连廊挂点' : '建筑挂点';
      } else {
        this.el.reticle.classList.remove('visible');
      }
    } else {
      this.el.reticle.classList.remove('visible');
      if (anchorBlocked) {
        this.set('anchorState', '被遮挡');
        this.el.reticle.classList.add('blocked');
      } else {
        this.set('anchorState', player.state === 'swing' ? '已锁定' : '无信号');
      }
    }

    this._updateHints(player);

    // FPS
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum > 0.4) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      this.set('fpsValue', Math.round(this.fps).toString());
      if (this.fps < 38 && !this.lowFpsWarned && ctx.canWarn) {
        this.lowFpsWarned = true;
        this.el.perfWarn.textContent = '帧率偏低 · 按 Esc 切换到「中」或「低」画质';
        this.el.perfWarn.classList.remove('hidden');
        setTimeout(() => this.el.perfWarn.classList.add('hidden'), 5200);
      }
    }

    if (this.debug) {
      const info = ctx.rendererInfo;
      this.el.debugPanel.textContent =
        `FPS   ${this.fps.toFixed(1)}\n` +
        `CALLS ${info.render.calls}   TRIS ${(info.render.triangles / 1000).toFixed(1)}k\n` +
        `STATE ${player.state}  SPD ${speedKmh.toFixed(0)} km/h\n` +
        `POS   ${player.pos.x.toFixed(1)} ${player.pos.y.toFixed(1)} ${player.pos.z.toFixed(1)}\n` +
        `ROPE  ${player.rope.active ? player.rope.length.toFixed(1) + 'm' : 'off'}\n` +
        `FLOW  ${player.flow}   SWINGS ${player.swingCount}`;
    }
  }

  _updateHints(player) {
    let html = '';
    switch (player.state) {
      case 'swing':
        html = '<span><kbd>Shift</kbd> 收绳加速</span><span><kbd>空格</kbd> 松开上抛</span><span><kbd>WASD</kbd> 摆动</span>';
        break;
      case 'air':
        html = '<span><kbd>左键</kbd> 蛛丝</span><span><kbd>空格</kbd> 滑翔</span><span><kbd>Shift</kbd> 俯冲</span>';
        break;
      case 'wallrun':
        html = '<span><kbd>空格</kbd> 蹬墙跳</span><span><kbd>W</kbd> 沿墙跑</span>';
        break;
      case 'glide':
        html = '<span><kbd>WASD</kbd> 滑翔转向</span><span><kbd>空格</kbd> 收翼</span><span><kbd>Shift</kbd> 俯冲</span>';
        break;
      case 'dive':
        html = '<span><kbd>松开 Shift</kbd> 改出俯冲</span><span><kbd>左键</kbd> 重新摆荡</span>';
        break;
      case 'zip':
        html = '<span>牵引中…</span>';
        break;
      default:
        html = '<span><kbd>左键</kbd> 发射蛛丝</span><span><kbd>Shift</kbd> 冲刺</span><span><kbd>空格</kbd> 跳跃</span><span><kbd>H</kbd> 帮助</span>';
    }
    if (this.el.hintBar.dataset.h !== html) {
      this.el.hintBar.dataset.h = html;
      this.el.hintBar.innerHTML = html;
    }
  }

  toggleDebug() {
    this.debug = !this.debug;
    this.el.debugPanel.classList.toggle('hidden', !this.debug);
  }

  setPauseStats(player) {
    const wrap = document.getElementById('pauseStats');
    if (!wrap) return;
    wrap.innerHTML =
      `里程 <b>${Math.round(player.distance)} m</b><br>` +
      `峰值 <b>${Math.round(player.maxSpeed * 3.6)} km/h</b><br>` +
      `摆荡 <b>${player.swingCount}</b> · 墙跑 <b>${player.wallRunCount}</b> · 救援 <b>${player.rescueCount}</b>`;
  }
}
