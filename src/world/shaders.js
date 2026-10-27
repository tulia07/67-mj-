/**
 * 全屏/城市着色器集合。
 * 建筑：实例化体块 + 立面程序化窗格（零额外窗格几何，1 个 draw call）
 * 地面：解析式街道网格 + 车道线 + 积水霓虹反射 + 高度图 AO
 * 天空：黄昏渐变 + 太阳 + 星点 + 地平线城市辉光
 */
export const COMMON = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return v;
}
vec3 fogApply(vec3 col, float dist, vec3 fogColor, float density) {
  float f = 1.0 - exp(-density * density * dist * dist);
  return mix(col, fogColor, clamp(f, 0.0, 1.0));
}
`;

export const BUILDING_VERT = /* glsl */ `
attribute vec3 aOffset;
attribute vec3 aSize;
attribute vec3 aTint;
attribute vec3 aAccent;
attribute float aSeed;
attribute float aStyle;

varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying vec3 vSize;
varying vec3 vTint;
varying vec3 vAccent;
varying float vSeed;
varying float vStyle;
varying float vDist;

void main() {
  vec3 scaled = position * aSize;
  vec3 world = scaled + aOffset;
  vLocal = position + 0.5;
  vWorld = world;
  vNormalW = normalize(normal);
  vSize = aSize;
  vTint = aTint;
  vAccent = aAccent;
  vSeed = aSeed;
  vStyle = aStyle;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const BUILDING_FRAG = /* glsl */ `
precision highp float;
${COMMON}

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uFogColor;
uniform vec3 uAmbientColor;
uniform vec3 uStreetTint;
uniform float uAmbient;
uniform float uWindowLight;
uniform float uNeon;
uniform float uFogDensity;
uniform float uTime;
uniform float uGroundShade;
uniform sampler2D uDetail;

varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying vec3 vSize;
varying vec3 vTint;
varying vec3 vAccent;
varying float vSeed;
varying float vStyle;
varying float vDist;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 an = abs(N);
  float roof = smoothstep(0.6, 0.95, N.y);
  float detail = 1.0 - smoothstep(230.0, 760.0, vDist);

  vec2 fuv;
  if (an.y > 0.5) fuv = vWorld.xz;
  else if (an.x > an.z) fuv = vec2(vWorld.z, vWorld.y);
  else fuv = vec2(vWorld.x, vWorld.y);

  float panel = texture2D(uDetail, fuv * 0.055).r;
  float grime = texture2D(uDetail, fuv * 0.021 + vSeed).r;

  vec3 wall = vTint * (0.88 + panel * 0.30) * (0.93 + grime * 0.16);
  vec3 roofCol = vec3(0.14, 0.145, 0.16) * (0.8 + panel * 0.5);
  vec3 albedo = mix(wall, roofCol, roof);

  vec3 emissive = vec3(0.0);

  // ---- 立面窗格 ----
  if (an.y < 0.5) {
    float floorH = 3.45;
    float colW = mix(2.55, 3.7, fract(vSeed * 0.37));
    vec2 g = vec2(fuv.x / colW, (vWorld.y - 2.6) / floorH);
    vec2 id = floor(g);
    vec2 f = fract(g);
    // 只把小整数喂给哈希：大坐标 + 插值误差会让 fract() 变成逐像素噪点
    vec2 cid = mod(id, 211.0);
    float wx = smoothstep(0.12, 0.19, f.x) * (1.0 - smoothstep(0.81, 0.88, f.x));
    float wy = smoothstep(0.20, 0.27, f.y) * (1.0 - smoothstep(0.76, 0.83, f.y));
    float winShape = wx * wy;
    // 远处退化为平均亮度，避免窗格摩尔纹（着色器内 LOD）
    float winMask = mix(0.30, winShape, detail);

    float r1 = hash21(cid);
    float r2 = hash21(cid + vec2(37.0, 71.0));
    float litRatio = mix(0.11, 0.32, fract(vSeed * 0.71));
    float lit = step(1.0 - litRatio * clamp(uWindowLight, 0.0, 1.6) * 0.62, r1);
    // 偶尔整层亮灯（办公楼通铺灯），让立面有节奏
    float rowLit = step(0.93, hash21(vec2(mod(id.y, 211.0), 17.0))) * step(0.12, r1);
    lit = max(lit, rowLit);
    vec3 warm = vec3(1.0, 0.72, 0.40);
    vec3 cool = vec3(0.50, 0.82, 1.0);
    vec3 pink = vec3(1.0, 0.34, 0.74);
    vec3 wc = mix(warm, cool, step(0.52, hash21(cid + vec2(3.1, 9.7))));
    wc = mix(wc, pink, step(0.94, hash21(cid + vec2(9.2, 5.3))));
    // 窗内亮度梯度：靠窗顶更亮，避免整块死平
    float grad = mix(0.62, 1.0, 1.0 - f.y);
    float power = mix(0.18, 0.95, r2) * lit;
    // 窗框十字：竖梃 + 横档
    float mull = smoothstep(0.012, 0.032, abs(f.x - 0.5));
    float transom = smoothstep(0.014, 0.036, abs(f.y - 0.5));
    float frame = mix(1.0, 0.35 + 0.65 * min(mull, transom), detail);
    emissive += wc * winMask * power * grad * frame * mix(0.34, 1.0, uWindowLight);
    // 玻璃：吸光 + 轻微冷色反射
    albedo = mix(albedo, vec3(0.013, 0.017, 0.026), winShape * 0.96);

    // ---- 底层店面灯带 ----
    float store = 1.0 - smoothstep(1.2, 6.2, vWorld.y);
    // 店面分间：亮橱窗之间留暗柱
    float bays = smoothstep(0.28, 0.42, abs(fract(fuv.x / 6.5) - 0.5));
    float storeBand = store * (0.30 + 0.70 * smoothstep(0.0, 1.0, vWorld.y)) * mix(0.3, 1.0, bays);
    float shopRnd = hash11(floor(fuv.x / 6.5) * 0.37 + fract(vSeed) * 5.0);
    vec3 shopCol = mix(vec3(1.0, 0.55, 0.25), vec3(0.35, 0.95, 1.0), shopRnd);
    emissive += shopCol * storeBand * (0.14 + shopRnd * 0.30) * mix(0.5, 1.0, uWindowLight);
    albedo *= mix(1.0, 0.72, storeBand);

    // ---- 霓虹边线 / 顶部灯带 ----
    float tangent = an.x > an.z ? vLocal.z : vLocal.x;
    float edge = smoothstep(0.035, 0.0, min(tangent, 1.0 - tangent));
    float styleGate = smoothstep(0.35, 0.75, vStyle);
    emissive += vAccent * edge * styleGate * 0.55 * uNeon;

    float topBand = smoothstep(0.045, 0.0, abs(vLocal.y - 0.965));
    emissive += vAccent * topBand * styleGate * 0.5 * uNeon;

    // 竖向灯管（部分建筑）
    float stripe = smoothstep(0.02, 0.0, abs(fract(fuv.x / 12.0 + fract(vSeed) * 0.31) - 0.5) - 0.47);
    emissive += mix(vAccent, vec3(1.0), 0.25) * stripe * pow(1.0 - vLocal.y, 2.0) * styleGate * 0.5 * uNeon;
  } else {
    // 屋顶：排气口附近的微弱热度 + 边缘泛光
    float rim = smoothstep(0.06, 0.0, min(min(vLocal.x, 1.0 - vLocal.x), min(vLocal.z, 1.0 - vLocal.z)));
    emissive += vAccent * rim * 0.35 * uNeon;
  }

  // ---- 光照 ----
  float ndl = max(dot(N, normalize(uSunDir)), 0.0);
  float sky = 0.5 + 0.5 * N.y;
  vec3 ambient = uAmbientColor * uAmbient * (0.42 + 0.58 * sky);
  vec3 lit = albedo * (uSunColor * ndl * 1.05 + ambient);

  // 街道霓虹溢出（低处更多）
  float spill = exp(-max(vWorld.y, 0.0) * 0.055) * uNeon;
  lit += albedo * uStreetTint * spill * 0.55;

  // 接地环境遮蔽
  float baseAO = mix(0.42, 1.0, smoothstep(0.0, 26.0, vWorld.y));
  lit *= mix(1.0, baseAO, uGroundShade);

  vec3 col = lit + emissive;
  float dist = length(vWorld - cameraPosition);
  col = fogApply(col, dist, uFogColor, uFogDensity);
  // 地平线暖光晕（大气透视）
  col += uHorizonColor * 0.06 * smoothstep(300.0, 1400.0, dist) * (1.0 - roof);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const GROUND_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const GROUND_FRAG = /* glsl */ `
precision highp float;
${COMMON}

uniform sampler2D uAsphalt;
uniform sampler2D uHeight;
uniform float uCell;
uniform float uBlock;
uniform float uHalf;
uniform float uTime;
uniform float uFogDensity;
uniform float uNeon;
uniform float uWindowLight;
uniform vec3 uFogColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uHorizonColor;
uniform vec3 uAmbientColor;
uniform float uAmbient;
uniform float uGroundShade;

varying vec3 vWorld;

void main() {
  vec2 p = vWorld.xz;
  vec2 local = mod(p + uHalf, uCell);
  float street = uCell - uBlock;
  float roadX = step(uBlock - 0.5, local.x);
  float roadZ = step(uBlock - 0.5, local.y);
  float road = max(roadX, roadZ);

  // 沿街坐标
  float centerX = uBlock + street * 0.5;
  float centerZ = uBlock + street * 0.5;
  float dCenter = 999.0;
  if (roadX > 0.5) dCenter = min(dCenter, abs(local.x - centerX));
  if (roadZ > 0.5) dCenter = min(dCenter, abs(local.y - centerZ));

  vec3 asphalt = texture2D(uAsphalt, p / 6.5).rgb;
  vec3 paving = texture2D(uAsphalt, p / 2.4 + 0.31).rgb;
  float wet = smoothstep(0.5, 0.85, fbm(p * 0.045) * 0.7 + fbm(p * 0.19) * 0.3);

  vec3 albedo = mix(vec3(0.150, 0.153, 0.166) * (0.7 + asphalt.r * 1.7),
                    vec3(0.238, 0.231, 0.224) * (0.7 + paving.r * 1.1), road);

  // 人行道砖缝
  if (road < 0.5) {
    vec2 tile = abs(fract(p / 2.2) - 0.5);
    float joint = smoothstep(0.46, 0.5, max(tile.x, tile.y));
    albedo *= 1.0 - joint * 0.45;
  }

  // ---- 车道线 ----
  float paint = 0.0;
  if (road > 0.5) {
    float along = roadX > 0.5 ? local.y : local.x;
    float across = roadX > 0.5 ? local.x : local.y;
    float dash = step(0.5, fract(along / 7.5));
    float centerLine = (1.0 - smoothstep(0.10, 0.22, abs(across - centerX))) * dash;
    float edgeLine = 1.0 - smoothstep(0.10, 0.22, abs(abs(across - centerX) - (street * 0.5 - 1.8)));
    paint = max(centerLine, edgeLine * 0.8);
    // 斑马线：路口附近
    float inter = step(uBlock - 0.5, local.x) * step(uBlock - 0.5, local.y);
    float zebra = inter * step(0.5, fract(along / 1.9));
    paint = max(paint, zebra * 0.55);
  }
  albedo = mix(albedo, vec3(0.52, 0.53, 0.5), paint * 0.42 * (0.6 + 0.4 * (1.0 - wet)));

  // ---- 高度图 AO ----
  vec2 huv = (p + uHalf) / (uHalf * 2.0);
  float occ = 0.0;
  occ += texture2D(uHeight, huv).r;
  occ += texture2D(uHeight, huv + vec2(0.0035, 0.0)).r;
  occ += texture2D(uHeight, huv - vec2(0.0035, 0.0)).r;
  occ += texture2D(uHeight, huv + vec2(0.0, 0.0035)).r;
  occ += texture2D(uHeight, huv - vec2(0.0, 0.0035)).r;
  occ *= 0.2;
  float ao = 1.0 - clamp(occ * 2.4, 0.0, 0.62) * uGroundShade;

  // ---- 湿地面霓虹反射 ----
  vec3 neonA = vec3(1.0, 0.22, 0.72);
  vec3 neonB = vec3(0.16, 0.92, 1.0);
  vec3 neonC = vec3(1.0, 0.62, 0.2);
  float n1 = fbm(p * 0.021 + 11.0);
  vec3 reflCol = mix(neonA, neonB, smoothstep(0.35, 0.75, n1));
  reflCol = mix(reflCol, neonC, smoothstep(0.62, 0.95, fbm(p * 0.013 + 5.3)) * 0.55);

  float streak = smoothstep(0.45, 0.95, fbm(vec2(p.x * 0.09, p.y * 0.012))) * (0.3 + 0.7 * wet);
  vec3 reflection = reflCol * (wet * 0.55 + 0.06) * (0.35 + ao * 0.8) * uNeon * (0.35 + streak);
  reflection *= 0.44;

  float ndl = max(dot(vec3(0.0, 1.0, 0.0), normalize(uSunDir)), 0.0);
  vec3 lit = albedo * (uAmbientColor * uAmbient * 1.55 + uSunColor * ndl * 0.62);
  lit *= ao;

  // 路灯/店铺在地面上的暖光池（街道网格 34m 一盏）
  vec2 poolD = abs(fract(p / 34.0) - 0.5);
  float pool = exp(-dot(poolD, poolD) * 120.0) * (0.4 + 0.6 * (1.0 - ao));
  vec3 pools = vec3(1.0, 0.70, 0.42) * pool * 0.20 * uNeon;

  vec3 col = lit + reflection + pools;

  // 远处地面逐渐被雾吞掉，避免地平线出现硬边
  float dist = length(vWorld - cameraPosition);
  col = fogApply(col, dist, uFogColor, uFogDensity);
  col += uHorizonColor * 0.04 * smoothstep(400.0, 1500.0, dist);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;
}
`;

export const SKY_FRAG = /* glsl */ `
precision highp float;
${COMMON}

uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform vec3 uHabGlow;
uniform float uTime;
uniform float uStars;
uniform float uSunSize;

varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, -1.0, 1.0);

  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.52));
  col = mix(uFogColor, col, smoothstep(-0.22, 0.05, h));

  // 太阳
  vec3 sd = normalize(uSunDir);
  float cosA = dot(dir, sd);
  float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.55, cosA);
  col += uSunColor * disc * 6.0;
  col += uSunColor * pow(max(cosA, 0.0), 22.0) * 0.75;
  col += uSunColor * pow(max(cosA, 0.0), 3.0) * 0.16;

  // 云层（低角度横向拉丝）
  float cloudBand = smoothstep(-0.02, 0.12, h) * (1.0 - smoothstep(0.22, 0.55, h));
  float cn = fbm(vec2(dir.x, dir.z) / max(0.08, h + 0.16) * 2.2 + uTime * 0.006);
  float clouds = smoothstep(0.52, 0.86, cn) * cloudBand * 0.55;
  col = mix(col, mix(uHorizon, vec3(1.0), 0.35) * 0.85, clouds * 0.55);

  // 星空
  if (uStars > 0.001 && h > -0.02) {
    vec3 q = floor(dir * 420.0);
    float s = hash21(q.xz + q.y * 17.0);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 60.0);
    float star = step(0.9975, s) * smoothstep(-0.02, 0.2, h) * tw;
    col += vec3(0.75, 0.85, 1.0) * star * uStars * 2.0;
  }

  // 地平线城市辉光
  float hz = exp(-abs(h) * 16.0);
  col += uHabGlow * hz * 0.5;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const SIGN_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aPhase;
attribute vec2 aUvMin;
attribute vec2 aUvSize;
varying vec2 vUv;
varying vec3 vColor;
varying float vPhase;
varying float vDist;
void main() {
  vUv = aUvMin + uv * aUvSize;
  vColor = aColor;
  vPhase = aPhase;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const SIGN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uTime;
uniform float uNeon;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec3 vColor;
varying float vPhase;
varying float vDist;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float flick = 0.86 + 0.14 * sin(uTime * (3.0 + fract(vPhase * 7.0) * 12.0) + vPhase * 31.0);
  float dropout = step(0.03, fract(sin(floor(uTime * 6.0 + vPhase * 13.0)) * 43758.5453));
  float lum = tex.a * flick * dropout;
  vec3 col = (tex.rgb * 1.35 + vColor * 0.9) * lum * uNeon;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(f, 0.0, 0.9));
  gl_FragColor = vec4(col, lum);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
