/**
 * 程序化音频（WebAudio 合成，无音频素材依赖）
 * 环境低频 + 风声（随速度）+ 蛛丝/落地/蹬墙/救援音效
 */
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
    this.master = null;
    this.windGain = null;
    this.windFilter = null;
    this.humGain = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // 环境底噪（城市低频）
    const hum = this.ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 42;
    const hum2 = this.ctx.createOscillator();
    hum2.type = 'sine';
    hum2.frequency.value = 63;
    const humFilter = this.ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 160;
    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0.05;
    hum.connect(humFilter);
    hum2.connect(humFilter);
    humFilter.connect(this.humGain);
    this.humGain.connect(this.master);
    hum.start();
    hum2.start();

    // 风：白噪声 + 带通
    const len = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = 0.97 * last + 0.03 * white;
      data[i] = last * 3.2;
    }
    this.noise = buffer;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.0;
    src.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    src.start();
    this.ready = true;
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.55 : 0;
  }

  /** 每帧：速度感风声 */
  update(dt, speed, state) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, speed / 70);
    const airborne = state === 'swing' || state === 'dive' || state === 'air' || state === 'glide' || state === 'zip';
    const target = k * (airborne ? 0.42 : 0.08);
    this.windGain.gain.setTargetAtTime(target, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(320 + k * 1500, t, 0.2);
    if (this.humGain) this.humGain.gain.setTargetAtTime(0.035 + k * 0.03, t, 0.4);
  }

  blip(freq, dur, type = 'sine', gain = 0.15, slideTo = null) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noiseBurst(dur, freq, gain = 0.2, q = 1.2) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  swing() {
    this.noiseBurst(0.42, 260, 0.22, 0.9);
    this.blip(180, 0.18, 'triangle', 0.1, 90);
  }
  release() {
    this.noiseBurst(0.22, 900, 0.12, 1.4);
  }
  land(intensity = 1) {
    const g = Math.min(0.45, 0.12 + intensity * 0.012);
    this.blip(90, 0.24, 'sine', g, 40);
    this.noiseBurst(0.16, 220, g * 0.6, 0.8);
  }
  jump() {
    this.blip(420, 0.1, 'triangle', 0.08, 620);
  }
  wall() {
    this.noiseBurst(0.18, 620, 0.14, 1.6);
    this.blip(260, 0.12, 'square', 0.06, 380);
  }
  zip() {
    this.blip(700, 0.3, 'sawtooth', 0.06, 1600);
    this.noiseBurst(0.3, 1200, 0.1, 2.0);
  }
  rescue() {
    this.blip(520, 0.3, 'sine', 0.16, 180);
    this.blip(180, 0.5, 'triangle', 0.1, 90);
  }
  denied() {
    this.blip(150, 0.09, 'square', 0.07, 120);
  }
  ui() {
    this.blip(880, 0.05, 'sine', 0.05, 1200);
  }
}
