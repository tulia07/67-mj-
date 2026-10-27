import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 飞行车流 + 高架地铁（实例化 + 抵站减速） */
export class Traffic {
  constructor(root, plan, quality) {
    this.root = root;
    this.plan = plan;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'Traffic';
    root.add(this.group);
    this.cars = [];
    this.trains = [];
    this._dummy = new THREE.Object3D();
  }

  build() {
    const plan = this.plan;
    const lanes = plan.lanes;
    const target = this.quality.traffic;
    const perLane = Math.max(1, Math.round(target / Math.max(1, lanes.length)));

    lanes.forEach((lane, li) => {
      for (let k = 0; k < perLane; k++) {
        this.cars.push({
          lane,
          pos: -plan.cfg.extent / 2 + ((k + (li % 3) * 0.33) / perLane) * plan.cfg.extent,
          speed: lane.speed * (0.8 + ((li * 7 + k * 3) % 5) * 0.09),
          lateral: lane.dir * 3.2,
          bob: (li * 1.7 + k) % 6.28,
        });
      }
    });

    const carGeo = this._carGeometry();
    const carMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.78,
      roughness: 0.34,
    });
    this.carMesh = new THREE.InstancedMesh(carGeo, carMat, this.cars.length);
    this.carMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carMesh.frustumCulled = false;
    this.carMesh.castShadow = false;
    this.carMesh.name = 'trafficCars';
    this.group.add(this.carMesh);

    const lightGeo = this._carLightGeometry();
    const lightMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.carLights = new THREE.InstancedMesh(lightGeo, lightMat, this.cars.length);
    this.carLights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carLights.frustumCulled = false;
    this.carLights.name = 'trafficLights';
    this.group.add(this.carLights);

    // 初始位置
    this.cars.forEach((car, i) => this._placeCar(car, i, 0));
    this.carMesh.instanceMatrix.needsUpdate = true;
    this.carLights.instanceMatrix.needsUpdate = true;

    // ---- 地铁 ----
    const cells = [];
    for (const line of plan.cfg.metro.lines) {
      for (let dir = -1; dir <= 1; dir += 2) {
        cells.push({ line, dir, cars: [], offset: (dir > 0 ? 0 : 620), speed: plan.cfg.metro.trainSpeed });
      }
    }
    const bodyGeo = this._trainGeometry();
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.42 });
    const windowGeo = this._trainWindowGeometry();
    const windowMat = new THREE.MeshBasicMaterial({
      vertexColors: true, toneMapped: false, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const carCount = cells.length * 4;
    this.trainMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, carCount);
    this.trainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trainMesh.frustumCulled = false;
    this.trainMesh.name = 'metroTrains';
    this.group.add(this.trainMesh);
    this.trainWindows = new THREE.InstancedMesh(windowGeo, windowMat, carCount);
    this.trainWindows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trainWindows.frustumCulled = false;
    this.group.add(this.trainWindows);

    this.trainCells = [];
    for (let i = 0; i < carCount; i++) this.trainCells.push({ train: Math.floor(i / 4), car: i % 4 });

    this.trains = cells.map((c, idx) => ({
      ...c,
      pos: c.dir > 0 ? -plan.cfg.extent / 2 + (idx % 2) * 300 : plan.cfg.extent / 2 - (idx % 2) * 300,
      speed: 0,
      cruise: c.speed,
      dwell: 0,
      idx,
    }));
    this._placeTrains(0);
    this.trainMesh.instanceMatrix.needsUpdate = true;
    this.trainWindows.instanceMatrix.needsUpdate = true;
    return this;
  }

  setQuality(q) {
    const n = Math.min(this.cars.length, Math.max(6, q.traffic));
    if (this.carMesh) this.carMesh.count = n;
    if (this.carLights) this.carLights.count = n;
  }

  _carGeometry() {
    const parts = [];
    const body = new THREE.BoxGeometry(2.0, 0.85, 4.6);
    body.translate(0, 0.1, 0);
    parts.push(this._paint(body, [0.24, 0.26, 0.31]));
    const cabin = new THREE.BoxGeometry(1.72, 0.62, 2.1);
    cabin.translate(0, 0.72, -0.25);
    parts.push(this._paint(cabin, [0.17, 0.2, 0.26]));
    const nose = new THREE.BoxGeometry(1.9, 0.4, 0.7);
    nose.translate(0, 0.12, 2.4);
    parts.push(this._paint(nose, [0.3, 0.33, 0.38]));
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return merged;
  }

  _carLightGeometry() {
    const parts = [];
    const mk = (w, h, z, color) => {
      const g = new THREE.BoxGeometry(w, h, 0.12);
      g.translate(0, 0.15, z);
      return this._paint(g, color);
    };
    parts.push(mk(1.5, 0.2, 2.72, [1.8, 1.7, 1.4]));
    parts.push(mk(1.7, 0.24, -2.32, [2.4, 0.22, 0.2]));
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return merged;
  }

  _trainGeometry() {
    const parts = [];
    const body = new THREE.BoxGeometry(19, 3.2, 3.1);
    parts.push(this._paint(body, [0.16, 0.17, 0.19]));
    const roof = new THREE.BoxGeometry(17, 0.5, 2.4);
    roof.translate(0, 1.85, 0);
    parts.push(this._paint(roof, [0.1, 0.11, 0.13]));
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return merged;
  }

  _trainWindowGeometry() {
    const parts = [];
    for (const side of [-1, 1]) {
      const g = new THREE.PlaneGeometry(15.5, 0.85);
      g.rotateY(side > 0 ? 0 : Math.PI);
      g.translate(0, 0.55, side * 1.58);
      parts.push(this._paint(g, [0.65, 0.95, 1.15]));
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return merged;
  }

  _paint(geo, color) {
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = color[0];
      arr[i * 3 + 1] = color[1];
      arr[i * 3 + 2] = color[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }

  _placeCar(car, i, time) {
    const lane = car.lane;
    const sway = Math.sin(time * 0.7 + car.bob) * 0.35;
    const d = this._dummy;
    if (lane.axis === 'x') {
      d.position.set(car.pos, lane.y + sway, lane.at + car.lateral);
      d.rotation.set(0, lane.dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    } else {
      d.position.set(lane.at + car.lateral, lane.y + sway, car.pos);
      d.rotation.set(0, lane.dir > 0 ? 0 : Math.PI, 0);
    }
    d.updateMatrix();
    this.carMesh.setMatrixAt(i, d.matrix);
    this.carLights.setMatrixAt(i, d.matrix);
  }

  _placeTrains(time) {
    const d = this._dummy;
    let i = 0;
    for (const train of this.trains) {
      const line = train.line;
      for (let c = 0; c < 4; c++) {
        const pos = train.pos - c * 20.5 * train.dir;
        if (line.axis === 'x') {
          d.position.set(pos, line.height + 2.6, line.at);
          d.rotation.set(0, 0, 0);
        } else {
          d.position.set(line.at, line.height + 2.6, pos);
          d.rotation.set(0, Math.PI / 2, 0);
        }
        d.updateMatrix();
        this.trainMesh.setMatrixAt(i, d.matrix);
        this.trainWindows.setMatrixAt(i, d.matrix);
        i++;
      }
    }
  }

  update(dt, time) {
    const extent = this.plan.cfg.extent;
    const carRange = extent + 260;
    this.cars.forEach((car, i) => {
      car.pos += car.speed * car.lane.dir * dt;
      if (car.pos > carRange / 2 - 130) car.pos -= carRange;
      if (car.pos < -carRange / 2 - 130) car.pos += carRange;
      this._placeCar(car, i, time);
    });
    this.carMesh.instanceMatrix.needsUpdate = true;
    this.carLights.instanceMatrix.needsUpdate = true;

    const trainRange = extent + 300;
    const limit = trainRange / 2 - 150;
    for (const train of this.trains) {
      const stations = train.line.stations;
      let nearest = Infinity;
      for (const s of stations) {
        const coord = train.line.axis === 'x' ? s.x : s.z;
        nearest = Math.min(nearest, Math.abs(train.pos - coord));
      }
      if (train.dwell > 0) {
        train.dwell -= dt;
        train.speed = 0;
      } else if (nearest < 46 && train.speed > 5) {
        train.speed = Math.max(0, train.speed - dt * 30);
        if (train.speed < 0.6) train.dwell = 2.8;
      } else {
        train.speed = Math.min(train.cruise, train.speed + dt * 14);
      }
      train.pos += train.speed * train.dir * dt;
      if (train.pos > limit) train.pos -= trainRange;
      if (train.pos < -limit) train.pos += trainRange;
    }
    this._placeTrains(time);
    this.trainMesh.instanceMatrix.needsUpdate = true;
    this.trainWindows.instanceMatrix.needsUpdate = true;
  }
}
