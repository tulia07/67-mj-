import * as THREE from 'three';

/**
 * WebP 资产装载：真实网络/解码进度（onProgress），离线可用。
 * 贴图由 tools/gen_textures.py 预生成，manifest 记录角色与体积。
 */
export class Assets {
  constructor(base = './assets/textures/') {
    this.base = base;
    this.textures = {};
    this.manifest = null;
    this.bytes = 0;
  }

  async loadManifest() {
    const res = await fetch(this.base + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('无法加载贴图清单 manifest.json (' + res.status + ')');
    this.manifest = await res.json();
    this.bytes = this.manifest.items.reduce((a, i) => a + (i.bytes || 0), 0);
    return this.manifest;
  }

  /** @param {(done:number,total:number,file:string)=>void} onProgress */
  async loadAll(onProgress) {
    if (!this.manifest) await this.loadManifest();
    const items = this.manifest.items;
    const loader = new THREE.TextureLoader();
    let done = 0;

    const tasks = items.map((item) => new Promise((resolve) => {
      loader.load(
        this.base + item.file,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = 4;
          tex.name = item.file;
          this.textures[item.file] = tex;
          if (item.role === 'poster') {
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
          }
          if (item.role === 'neon_atlas' || item.role === 'sprite' || item.role === 'holo') {
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
          }
          done++;
          onProgress && onProgress(done, items.length, item.file);
          resolve(tex);
        },
        undefined,
        () => {
          // 单张失败不阻塞整体（会使用程序化回退色）
          done++;
          onProgress && onProgress(done, items.length, item.file + ' (跳过)');
          resolve(null);
        }
      );
    }));
    await Promise.all(tasks);

    this.posters = items.filter((i) => i.role === 'poster').map((i) => this.textures[i.file]).filter(Boolean);
    this.neon = this.textures['neon_signs.webp'] || null;
    this.ticker = this.textures['ticker.webp'] || null;
    this.detail = this.textures['facade_detail.webp'] || null;
    this.asphalt = this.textures['asphalt.webp'] || null;
    this.blob = this.textures['blob.webp'] || null;
    this.holo = this.textures['holo.webp'] || null;
    return this;
  }

  dispose() {
    Object.values(this.textures).forEach((t) => t.dispose && t.dispose());
    this.textures = {};
  }
}
