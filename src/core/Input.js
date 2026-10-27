import { KEYS } from '../config.js';

/** 键鼠输入：指针锁定 + 边沿检测 + 视角增量缓冲 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();
    this.mouse = { left: false, right: false, leftPressed: false, rightPressed: false };
    this.lookX = 0;
    this.lookY = 0;
    this.sensitivity = 1;
    this.enabled = false;
    this.locked = false;
    this.onLockChange = null;
    this.wheel = 0;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'F3' || e.code === 'Tab') e.preventDefault();
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedThisFrame.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouse.left = this.mouse.right = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && this.canvas.requestPointerLock) {
        this.canvas.requestPointerLock();
      }
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX || 0;
      this.lookY += e.movementY || 0;
    });
  }

  /** 拖动视角兜底（未锁定指针时按住左键拖拽仍可看） */
  bindDragLook() {
    let dragging = false;
    let lx = 0, ly = 0;
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.locked) return;
      dragging = true; lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging || this.locked || !this.enabled) return;
      this.lookX += (e.clientX - lx) * 1.6;
      this.lookY += (e.clientY - ly) * 1.6;
      lx = e.clientX; ly = e.clientY;
    });
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  isDown(action) {
    const list = KEYS[action];
    if (!list) return false;
    for (const code of list) {
      if (code === 'Mouse0') { if (this.mouse.left) return true; }
      else if (code === 'Mouse2') { if (this.mouse.right) return true; }
      else if (this.down.has(code)) return true;
    }
    return false;
  }

  pressed(action) {
    const list = KEYS[action];
    if (!list) return false;
    for (const code of list) {
      if (code === 'Mouse0' && this.mouse.leftPressed) return true;
      if (code === 'Mouse2' && this.mouse.rightPressed) return true;
      if (this.pressedThisFrame.has(code)) return true;
    }
    return false;
  }

  released(action) {
    const list = KEYS[action];
    if (!list) return true;
    for (const code of list) {
      if (this.releasedThisFrame.has(code)) return true;
    }
    return false;
  }

  consumeLook() {
    const x = this.lookX * 0.0021 * this.sensitivity;
    const y = this.lookY * 0.0021 * this.sensitivity;
    this.lookX = 0;
    this.lookY = 0;
    return { x, y };
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouse.leftPressed = false;
    this.mouse.rightPressed = false;
    this.wheel = 0;
  }
}
