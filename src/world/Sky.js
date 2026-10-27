import * as THREE from 'three';
import { SKY_VERT, SKY_FRAG } from './shaders.js';

/** 天空穹顶 + 灯光 + 雾（昼夜预设可实时切换） */
export class Sky {
  constructor(scene, preset, quality) {
    this.scene = scene;
    this.quality = quality;
    this.preset = preset;
    this.group = new THREE.Group();
    this.group.name = 'Sky';
    scene.add(this.group);

    this.uniforms = {
      uZenith: { value: new THREE.Color(...preset.zenith) },
      uHorizon: { value: new THREE.Color(...preset.horizon) },
      uSunColor: { value: new THREE.Color(...preset.sunColor) },
      uSunDir: { value: new THREE.Vector3(...preset.sunDir).normalize() },
      uFogColor: { value: new THREE.Color(...preset.fog) },
      uHabGlow: { value: new THREE.Color(0.55, 0.16, 0.5) },
      uTime: { value: 0 },
      uStars: { value: 0 },
      uSunSize: { value: 0.0009 },
    };

    const geo = new THREE.SphereGeometry(3400, 32, 20);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    // 灯光
    this.hemi = new THREE.HemisphereLight(0x8fb4ff, 0x30202a, 0.6);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffb070, 1.0);
    this.sun.castShadow = !!quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 90;
    this.sun.shadow.camera.bottom = -40;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    // 霓虹补光：跟随玩家，给角色/装置染上街面颜色
    this.neonA = new THREE.PointLight(0xff3ea5, 180, 52, 2);
    this.neonB = new THREE.PointLight(0x2ef2ff, 150, 48, 2);
    scene.add(this.neonA, this.neonB);

    // 角色补光（近距离柔光，保证主角在夜景中可读）
    this.fill = new THREE.PointLight(0xcfe6ff, 26, 12, 2);
    scene.add(this.fill);

    this.scene.fog = new THREE.FogExp2(new THREE.Color(...preset.fog), preset.fogDensity);
    this.applyPreset(preset);
  }

  applyPreset(preset) {
    this.preset = preset;
    const u = this.uniforms;
    u.uZenith.value.setRGB(...preset.zenith);
    u.uHorizon.value.setRGB(...preset.horizon);
    u.uSunColor.value.setRGB(...preset.sunColor);
    u.uSunDir.value.set(...preset.sunDir).normalize();
    u.uFogColor.value.setRGB(...preset.fog);
    u.uStars.value = preset.id === 'night' ? 1.0 : preset.id === 'dawn' ? 0.25 : 0.0;
    this.scene.fog.color.setRGB(...preset.fog);
    this.scene.fog.density = preset.fogDensity;

    this.sun.color.setRGB(...preset.sunColor);
    this.sun.intensity = preset.sunIntensity;
    this.hemi.color.setRGB(...preset.ambientColor);
    this.hemi.intensity = preset.ambient * 1.15;
    this.hemi.groundColor.setRGB(preset.fog[0] * 0.7, preset.fog[1] * 0.6, preset.fog[2] * 0.7);

    const night = preset.id === 'night';
    this.neonA.intensity = (night ? 320 : 180) * preset.neon;
    this.neonB.intensity = (night ? 260 : 150) * preset.neon;
    this.fill.intensity = night ? 95 : 62;
    this.dome.material.needsUpdate = true;
  }

  update(dt, camera, time, playerPos) {
    this.uniforms.uTime.value = time;
    this.dome.position.copy(camera.position);
    const p = playerPos || camera.position;
    this.sunTarget.position.set(p.x, p.y, p.z);
    this.sun.position.set(
      p.x + this.uniforms.uSunDir.value.x * 120,
      p.y + Math.max(30, this.uniforms.uSunDir.value.y * 160),
      p.z + this.uniforms.uSunDir.value.z * 120
    );
    this.neonA.position.set(p.x + Math.sin(time * 0.7) * 12, p.y + 6, p.z + Math.cos(time * 0.9) * 12);
    this.neonB.position.set(p.x - Math.sin(time * 0.5) * 14, p.y + 9, p.z - Math.cos(time * 0.6) * 14);
    // 补光放在相机与角色之间，正反打都能看清人物（菜单特写尤其明显）
    const cx = camera ? camera.position.x : p.x + 1.2;
    const cz = camera ? camera.position.z : p.z + 1.6;
    this.fill.position.set(
      p.x + (cx - p.x) * 0.55,
      p.y + 2.6,
      p.z + (cz - p.z) * 0.55
    );
  }
}
