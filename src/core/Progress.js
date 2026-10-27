/** 真实加载进度（按阶段权重累加，全部来自实际完成的构建工作） */
export class Progress {
  constructor(root) {
    this.root = root;
    this.bar = root.querySelector('#loadBar');
    this.pct = root.querySelector('#loadPct');
    this.phase = root.querySelector('#loadPhase');
    this.detail = root.querySelector('#loadDetail');
    this.tip = root.querySelector('#loadTip');
    this.logEl = root.querySelector('#loadLog');
    this.tasks = [];
    this.values = new Map();
    this.totalWeight = 0;
    this.startedAt = performance.now();
    this._raf = null;
    this.displayed = 0;
  }

  define(tasks) {
    this.tasks = tasks;
    this.totalWeight = tasks.reduce((a, t) => a + t.weight, 0) || 1;
    this.values.clear();
    tasks.forEach((t) => this.values.set(t.key, 0));
    return this;
  }

  log(line) {
    if (!this.logEl) return;
    const div = document.createElement('div');
    div.textContent = line;
    this.logEl.appendChild(div);
    while (this.logEl.childElementCount > 5) this.logEl.removeChild(this.logEl.firstChild);
  }

  begin(key) {
    const t = this.tasks.find((x) => x.key === key);
    if (!t) return;
    if (this.phase) this.phase.textContent = t.label;
    this.log('› ' + t.label);
  }

  set(key, frac, detail) {
    this.values.set(key, Math.max(0, Math.min(1, frac)));
    if (detail && this.detail) this.detail.textContent = detail;
    const sum = this.tasks.reduce((a, t) => a + t.weight * (this.values.get(t.key) || 0), 0);
    const p = sum / this.totalWeight;
    this.render(p);
  }

  render(p) {
    const pctText = (p * 100).toFixed(1) + '%';
    if (this.pct) this.pct.textContent = pctText;
    if (this.bar) this.bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    this.root.style.setProperty('--p', p.toFixed(4));
  }

  /** 逐帧平滑到目标进度，避免跳变 */
  tick(dt) {
    const sum = this.tasks.reduce((a, t) => a + t.weight * (this.values.get(t.key) || 0), 0);
    const target = sum / this.totalWeight;
    this.displayed += (target - this.displayed) * Math.min(1, dt * 8);
    if (Math.abs(target - this.displayed) < 0.0005) this.displayed = target;
    this.render(this.displayed);
  }

  complete() {
    this.values.forEach((_, k) => this.values.set(k, 1));
    this.render(1);
    this.log('✓ 系统就绪');
  }

  fail(err) {
    if (this.phase) this.phase.textContent = '初始化失败';
    if (this.detail) this.detail.textContent = String(err && err.message ? err.message : err);
    this.log('✕ ' + (err && err.stack ? err.stack.split('\n')[0] : err));
  }
}

/** 主线程分片执行，保证进度条能真实刷新（而不是一段长阻塞） */
export function yieldFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
