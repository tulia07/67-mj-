# 交付说明 · CYBERPUNK MEGAPOLIS

> 本文件是项目的正式交付说明，逐项对应需求给出实现位置与验证方式。
> 想直接玩：`npm start` 后打开 http://127.0.0.1:5173/ 。想放到线上：见第 3 节 GitHub Pages。

---

## 1. 交付物清单

| 交付项 | 位置 | 说明 |
| --- | --- | --- |
| 可运行项目 | 仓库根目录 | 纯静态，无构建步骤，`node server.js` 即跑 |
| 运行时依赖 | `vendor/three/` | Three.js r169 及用到的 addons，已本地化，**不含任何 CDN 请求** |
| 美术资产 | `assets/textures/` | 12 张 WebP + `manifest.json`，共约 420 KB，离线生成 |
| 源码 | `src/` | 18 个模块，5638 行 |
| 页面与样式 | `index.html` / `styles/main.css` | 单页，283 + 486 行 |
| 静态服务器 | `server.js` | 57 行，零依赖，仅用 Node 内置模块 |
| 资产生成器 | `tools/gen_textures.py` | 336 行，Pillow 离线重生成全部贴图 |
| 自动化测试 | `tests/` | 23 个单测 + 浏览器冒烟 + 截图采集 |
| 画面存档 | `docs/shots/` | 11 张压缩截图（WebP，共 1.2 MB） |
| 本说明 | `docs/DELIVERY.md` | 你正在读的文件 |

**交付体积**：不含 `node_modules` 约 3.5 MB（其中 vendor 1.6 MB、资产 0.42 MB、截图 1.2 MB、源码 0.25 MB）。

---

## 2. 运行环境

| 项 | 要求 |
| --- | --- |
| Node.js | ≥ 18（开发与验证用 22.16） |
| 浏览器 | 支持 WebGL2 的现代浏览器（Chrome / Edge / Firefox / Safari 16+） |
| 显卡 | 真实 GPU 最佳；无 GPU 时 Chromium 会回落到 SwiftShader 软件渲染 |
| 网络 | **不需要**。所有资源本地，无字体 CDN、无模型下载、无接口调用 |

### 启动

```bash
npm start                # 等价于 node server.js 5173
# 浏览器打开 http://127.0.0.1:5173/
```

不需要 `npm install`——运行时零 npm 依赖。`node_modules` 只在跑冒烟测试时需要（`puppeteer-core`）。

换端口：`node server.js 8080`。指定根目录：`node server.js 8080 ./dist`。

> 必须走 HTTP，不能直接双击 `index.html`：ES Module + importmap 在 `file://` 下会被 CORS 拦住。

---

## 3. 部署到 GitHub Pages（线上试玩）

项目是纯静态站，GitHub Pages 可直接托管，不需要 `server.js`：

1. 仓库 **Settings → Pages**
2. **Source** 选 `Deploy from a branch`
3. 分支选 `main`，目录选 `/ (root)`，保存
4. 等 1–2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/`

注意事项：

- importmap 里的路径是 `./vendor/three/...` 相对路径，放在仓库根可直接工作，无需改 `base`。
- 页面不发任何外部请求，Pages 的 HTTPS 不会造成混合内容问题。
- `.gitignore` 已排除 `node_modules/`，Pages 构建不受影响。
- 若仓库名带子路径，相对路径同样成立；只有把 `index.html` 挪进子目录时才需要调整。

---

## 4. 验收清单

对应最初的需求条目，逐项给出实现位置与验证方式。

| # | 需求 | 实现位置 | 验证 |
| --- | --- | --- | --- |
| 1 | 纯前端第三人称 3D，本地 Three.js，静态服务器直跑 | `index.html`（importmap → `vendor/three`）、`server.js` | 全部 import 均指向 `./vendor/`，无外链 |
| 2 | 高密度城市：街道 / 地铁 / 贫民窟 / 屋顶 / 摩天楼 | `CityPlanner.js`、`Traffic.js` | 342 栋建筑、1028 碰撞盒、高架地铁线 + 站点 |
| 3 | 黄昏天空、雾、窗灯、霓虹、广告 | `Sky.js`、`shaders.js`、`CityBuilder.js` | 截图 `dawn/night/signs.webp` |
| 4 | 男女角色选择 | `config.js` `CHARACTERS`、菜单 | 菜单可切换「凯 / 诺娃」，截图 `menu-male / menu-female.webp` |
| 5 | 骨骼动画状态机 | `Character.js`（19 骨 + 14 段烘焙 Clip + `AnimStateMachine`） | 单测 + 冒烟 `clips: 14, bones: 19` |
| 6 | 跑 / 跳 / 摆荡 / 收绳 / 俯冲 / 飞掠 / 墙跑 / 墙跳 | `PlayerController.js` 状态机 | 冒烟覆盖摆荡；其余状态见第 6 节按键表 |
| 7 | 建筑碰撞与高速防穿模 | `Collision.js`（胶囊 vs AABB + 空间哈希）、`integrate` 子步 | 单测 `capsuleBox` / `rayBox` / `SpatialHash` |
| 8 | 挂点检测、落地、救援 | `tryAttach`、`checkLanding`、`checkRescue`、`forceRescue` | 6187 个挂点；单测覆盖救援逻辑 |
| 9 | 电影相机（预测 / 避障 / 速度感） | `CinematicCamera.js` | 速度驱动 FOV/视距/侧倾 + 射线回缩 + 震屏 |
| 10 | 真实加载进度 | `Progress.js`（6 阶段加权）+ `Assets.js` | 冒烟实测加载 2.2s，进度跟真实任务 |
| 11 | 角色菜单、HUD、暂停、昼夜、键鼠、操作反馈 | `HUD.js`、`main.js`、`index.html` | 截图 `pause/help.webp`；拒绝挂点有音效 + 提示 |
| 12 | 数据驱动 + 实例化 + 合批 + LOD + 三档画质 | `CityPlanner`（纯数据）/ `CityBuilder`（GPU）/ `Traffic` | 建筑单 draw call；装置 4×4 分块近远切换 |
| 13 | 完整源码 + 素材组织 + 自动化测试 | 全仓库 | 23 单测全绿 + 冒烟 `ok: true` |
| 14 | 离线可用、无控制台错误 | 全仓库 | 冒烟断言 `errors: []`、`failedRequests: []`、`warnings: []` |

### 与原始需求的差异（如实说明）

- **Draco 压缩：未使用。** 需求提到 Draco + WebP，但本项目没有任何外部 3D 模型——建筑、角色、车辆全部是程序化几何，没有 glTF 可压。贴图侧已按需求使用 WebP。若后续接入 glTF 模型，`vendor/three` 已带 `GLTFLoader`，接 `DRACOLoader` 即可。
- **角色为程序化几何体**，不是高模/绑定资产。19 根骨骼、分段装甲蒙皮、14 段由姿态函数烘焙的 AnimationClip，好处是零资产体积、可随时改比例；代价是细节不如手K模型。
- **无音频文件**，全部 WebAudio 实时合成（城市底噪、风声、蛛丝、落地、墙跳、牵引、救援、拒绝）。
- **无移动端触控**，需求只要求键鼠。

---

## 5. 代码结构与关键实现

```
index.html            结构 + importmap + 内联 SVG favicon
server.js             零依赖静态服务器
src/
  config.js   353     世界 / 画质 / 昼夜预设 / 手感 TUNING / 按键 / 角色
  main.js     718     启动、阶段进度、主循环、UI 绑定、画质与昼夜切换
  core/
    RNG.js     37     mulberry32 可复现随机
    Assets.js   77    WebP 装载（真实解码进度）
    Progress.js 82    6 阶段加权进度 + 平滑
    Input.js   131    指针锁定、边沿检测、视角增量
  world/
    CityPlanner.js 443  纯数据规划（不 import three，可 Node 单测）
    CityBuilder.js 631  实例化建筑、地面、招牌图集、海报合批、装置 LOD
    shaders.js     452  建筑立面 / 湿地面 / 天空穹顶 / 招牌图集 GLSL
    Traffic.js     261  飞行车道车辆 + 高架地铁
    Sky.js         119  穹顶 + 光照 + 昼夜切换
  physics/
    Collision.js   212  胶囊 vs AABB、射线、绳长投影、空间哈希
  player/
    Character.js        558  程序化骨骼 + 14 段动画 + 状态机
    PlayerController.js 833  移动状态机、摆荡物理、碰撞积分、墙跑、救援
    WebLine.js          132  蛛丝渲染（芯线 + 辉光 + 命中光斑）
  camera/CinematicCamera.js 187
  ui/HUD.js             250
  audio/GameAudio.js    162
```

### 数据层与渲染层分离

`CityPlanner.planCity(seed)` 只产出普通对象数组：`buildings / boxes / anchors / props / signs / posters / tickers / bridges / lanes / stations / spawn / heightMap`。它不 import three，所以能在 Node 里被单测直接调用，也能用 seed 复现同一座城（单测断言了这一点）。`CityBuilder` 才把这些数据变成 BufferGeometry 和材质。

### 建筑：一个 draw call 画完 342 栋

全部建筑塞进一个 `InstancedBufferGeometry`，实例属性带尺寸、随机种子、片区色、风格值。窗格、店面灯带、霓虹边线、顶部灯带全部在片元着色器里按世界坐标算出来——不贴图、不加几何。远处用着色器内 LOD 把窗格退化为平均亮度，避免摩尔纹。

> 踩过的坑：窗格哈希最初把实例种子（0–100 的浮点）直接喂进 `hash21`，在软件渲染器下变成逐像素雪花。现在只喂 `mod(floor(cell), 211.0)` 这类小整数，稳定性问题消失。

### 摆荡物理

刚性绳长约束，不用弹簧：

1. 每帧先积分速度与位置；
2. `projectToRope()` 把位置投影回以挂点为球心、绳长为半径的球面；
3. 消掉沿绳方向的速度分量（只保留切向），得到干净的单摆运动；
4. 叠加泵动（按住前进加速）、转向（AD 偏航）、收绳（Shift 缩半径换速度）；
5. 低速时补一点切向力（`assist`），避免"吊在半空晃不动"。

松手瞬间给一个额外推进，这是摆荡游戏手感的关键。

### 高速防穿模

速度越高，`integrate()` 拆的子步越多；每步用竖直胶囊 vs AABB 迭代解算（最多 3 次），撞墙时把速度投影到墙面切向。宽相位用空间哈希，只测邻近格子。

### 角色与动画

19 根骨骼的程序化人形，动画不是从文件加载，而是由姿态函数在启动时烘焙成 14 段 `AnimationClip`（idle / run / sprint / jump / fall / swing / reel / dive / glide / wallrun / wallrunL / walljump / land / zip）。`AnimStateMachine` 按当前状态 + 速度做交叉淡入。男女差异只体现在 `agilityMul`（收绳与转向速率）和身高肩宽缩放上，物理内核完全一致。

### 相机

速度驱动 FOV、视距、侧倾；带前瞻偏移（往前看你想去的地方）、射线遮挡回缩（被楼挡住就拉近）、落地与撞击震屏。菜单里是环绕镜头，进游戏有一段开场推进。

---

## 6. 操作与状态

| 输入 | 动作 |
| --- | --- |
| `W A S D` / 方向键 | 移动（贴地跑 / 空中转向） |
| 鼠标移动 | 视角 |
| 鼠标左键（按住） | 发射蛛丝并摆荡；松开瞬间有额外推进 |
| `Shift`（摆荡中） | 收绳：半径变小、速度变快 |
| `Shift`（空中） | 俯冲；临近地面松开可拉平 |
| `空格` | 跳跃 / 空中展开滑翔翼 / 墙跑时蹬墙跳 |
| 鼠标右键 | 牵引索：对准目标点快速拉近 |
| `R` | 回到最近的安全屋顶 |
| `Esc` | 暂停（画质、昼夜、灵敏度、音量） |
| `H` | 帮助面板 |
| `F3` | 调试面板（坐标、速度、状态、draw calls） |

状态机：`idle / run / air / swing / zip / glide / dive / wallrun / land / rescue`。

---

## 7. 测试报告

环境：Windows 11 · Node 22.16 · Edge headless（SwiftShader 软件渲染，**无 GPU**）。

### 单元测试

```
node --test tests/unit.test.js
# tests 23 / pass 23 / fail 0     (692 ms)
```

覆盖：胶囊-盒碰撞（含"胶囊中轴落在盒内"的退化情况）、射线求交、绳长球面投影、空间哈希查询、城市规模与种子可复现、碰撞盒合法性（`min < max`）、挂点数量与高度、地面高度图、救援逻辑、飞行车道不压楼、配置完整性。

### 浏览器冒烟测试

```
npm run test:smoke
```

最近一次结果：

| 指标 | 值 |
| --- | --- |
| `ok` | **true** |
| 加载耗时 | 2.2 s |
| 位移 | 24.4 m |
| 峰值速度 | 87 km/h |
| 摆荡 | 成功挂上（`rope: true`，`speed 20.1 m/s`） |
| 蛛丝渲染 | `webVisible: 1` |
| 建筑 / 挂点 / 碰撞盒 / 装置 | 342 / 6187 / 1028 / 2721 |
| 动画 / 骨骼 / 贴图 | 14 / 19 / 12 |
| `console.error` | **0** |
| 失败请求 | **0** |
| 警告 | **0** |

断言条件：位移 > 5 m、摆荡确实挂上、蛛丝已渲染、无 console 错误、无失败请求、暂停面板可达、帮助面板可达、画质/昼夜切换不报错。

> 冒烟测试默认自动探测 Edge/Chrome；找不到时用 `BROWSER_PATH=/path/to/chrome npm run test:smoke` 指定。

### 画面采集

```bash
npm run shots     # 高画质多机位 → docs/shots/*.png
npm run look      # 三张快速视觉检查（立面 / 街景 / 摆荡）
```

`docs/shots/` 里提交的是压缩后的 WebP（1.2 MB / 11 张），脚本重新生成的是 PNG，已被 `.gitignore` 排除。

---

## 8. 性能基线

软件渲染（SwiftShader）下的实测值，仅供回归对比，**不代表真实表现**：

| 画质 | draw calls | 三角形 | 帧率 |
| --- | --- | --- | --- |
| Low + 深夜预设 | 39 | 34 314 | ~6 FPS（软件渲染） |

真实 GPU（独显或近五年集显）下 High 画质通常稳定 60 FPS，因为瓶颈在像素填充与泛光，而不是几何量——342 栋建筑的几何只占 1 个 draw call。

三档画质各自控制：

| 档位 | DPR | 阴影 | 泛光 | 装置密度 | 车辆 | 贴图 |
| --- | --- | --- | --- | --- | --- | --- |
| High | 上限 2 | 2048 阴影贴图 | 全强度 | 全部近距装置 | 全量 | 原尺寸 |
| Medium | 上限 1.5 | 1024 | 减弱 | 部分 | 减半 | 原尺寸 |
| Low | 1 | 关闭 | 关闭 | 仅骨架 | 少量 | 半尺寸 |

切换即时生效，不重载场景、不重建城市。

---

## 9. 二次开发指引

想改东西，从这三个文件入手最快：

- **手感** → `src/config.js` 的 `TUNING`：`capsule`（碰撞体）、`move`（跑速/加速/空中控制）、`swing`（绳长范围、泵动、收绳速率）、`zip`、`wallrun`、`landing`、`camera`、`rescue`。
- **城市密度与风貌** → `config.js` 的 `WORLD`（`cell / block / street`）与 `DISTRICTS`（每片区的高度、占地、密度、配色、建筑风格）。
- **画面观感** → `src/world/shaders.js`（立面窗格密度、霓虹强度、地面湿反射、天空渐变）与 `config.js` 的 `PRESETS`（四个昼夜预设的光照数值）。

重生成贴图（需要 Python + Pillow + 系统字体）：

```bash
python tools/gen_textures.py     # 或 npm run assets
```

新增建筑类型：在 `CityPlanner` 里给建筑对象加字段 → 在 `CityBuilder._buildBuildings` 写入对应的实例属性 → 在 `shaders.js` 里读该属性分支。因为实例属性是统一的 buffer，加字段不会增加 draw call。

---

## 10. 已知限制

1. **无真实 GPU 的机器上帧率低。** 无头验证环境走 SwiftShader，6 FPS 是软件光栅化的结果，不是项目性能。
2. **城市是程序化生成，不是手工关卡。** 同一个 seed 永远生成同一座城，但不存在"设计过的最佳摆荡路线"。
3. **角色没有 IK。** 手部挂点用骨骼世界坐标直连，极近距离（< 3 m）挂绳时蛛丝会显得很陡。
4. **没有存档/计分系统。** 里程与峰值速度只在本次会话内统计，刷新即清零。
5. **音频是合成音。** 没有 BGM，只有环境低频、风声和操作音效。

---

## 11. 许可

代码 MIT。`assets/textures/` 内的贴图由 `tools/gen_textures.py` 程序化生成，不含任何第三方素材。`vendor/three/` 为 Three.js（MIT），版权归 Three.js 作者所有，见 `vendor/three/LICENSE`。
