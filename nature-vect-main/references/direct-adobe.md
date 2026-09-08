# direct-adobe.md —— 在 Adobe Illustrator 中绘制（文字模式主路，agent 执行用）

本文描述 nature-vect 文字模式在 **agent 直接控制本机 Adobe Illustrator** 下的执行方式：把 Master SVG（矢量图形 + live `<text>`）交给引擎，由 agent 驱动 Illustrator 把图形与文字**逐批原生画入当前画板**，文字一律建成 **live TextFrame（可编辑文本对象）**，最后 agent 在画板内**目视微调文字对位**并交付 .ai/.png。

> 与旧路径的关系：text-inject 的"坐标预测精确对位"不再是主路——绘制后 agent 目视微调即可把文字放到正确位置。text-inject 仅用于 **生成 Master SVG**（把记录文字以原坐标/层级插回矢量）与 **绘制不可行时的兜底交付**（.text.svg + ai-export.jsx 手动另存）。

## 0. 两条绘制引擎（cached 与 direct，先选路）

"照着 Master SVG 现场画"由**两套互不依赖的引擎**实现，均把文字建成可编辑文本框：

| | cached 引擎（默认） | direct 引擎（兜底） |
|---|---|---|
| 脚本 | `prep-replay-cache.py` + `run_nv_replay.ps1` | `run_nv_direct.ps1` |
| 谁解析 SVG | Python(fontTools) 先把 SVG 算成几何 cache | **Illustrator 自己**在 NoUI 后台文档导入 SVG 再采样 |
| 文字 | ✅ live TextFrame | ✅ live TextFrame（nature-vect 增强，cell-lct 原版不支持） |
| 颜色 | 仅 RGB/hex/命名色 | 支持导入后 AI 的 RGB/CMYK/Gray/Lab/NoColor |
| 断点续跑 | ✅ playback.json 幂等 | ❌ 一次性画完；重跑用 `-ReplaceExistingGroup` |
| 批处理 | 20–50 原子/批，复杂原子单批 | 整图一批，或 `-AtomicBatchJson`/`-AtomicIndex` 原子级调试 |
| 适配 SVG | 拒 class/style 依赖、渐变、clipPath、mask、filter、use、dash、tspan、image 等 | 依赖 AI 导入器表现；**clipped group 明确拒绝** |
| **体型上限** | 几乎无上限（离线拆原子，逐批喂） | **只适合小图元**：几千 line/circle/短 path 可；**巨型/海量长 path（如数百~上千个、单 path 上万字符）会让 AI 整图导入崩溃（RPC 断→卡死）** |
| 前提 | Windows + AI 已开 | 同左，另需 python3+fontTools（仅解析用） |

**选路规则（实测铁律）**：
1. **默认走 cached**——只要 `prep-replay-cache.py` 能解析（不报 `Unsupported SVG element …`/不支持构造）就用 cached，尤其 **path 多/超大/复杂**的图**必须** cached（AI 整图导入会崩）。
2. 仅当 cached prep 报"不支持构造"（gradient/clip/use/dash/tspan/image 等）且图是**小图元为主**时，才改跑 direct。
3. direct 仍拒（如 clipped group）→ 回退"AI 打开导入"（§6）。

> 实测对照（2026-09-08）：`普氏菌素A机制图准确.svg`（4666 line+1336 circle+891 path 小图元）direct 可过；`纳米杂化材料组装示意图.svg`（2195 个巨型 path，d 合计 ~1MB）**direct 直接压垮 AI（0x800706BE→进程崩溃）**，同文件走 cached = prep 拆 2224 原子/61 批一把画完。**图大必走 cached。**

## 1. 时机与前提（不满足请勿启动）

- [ ] 本机 **Windows**（脚本用 Illustrator COM）；Illustrator **2019+ 已打开**且已打开目标文档（agent 只接管当前画板，**绝不代启动/关闭/移动窗口**）。
- [ ] agent 具备本机 **GUI/computer-use**（能看到画板、可微调文字）。
- [ ] cached 路：已装 **python3 + fontTools**（`pip install fonttools`）；direct 路无需。
- [ ] 已有 **Master SVG**：`base.svg`（去字后 convert 产物）+ 由 `text-inject` 把 manifest 文字以 live `<text>` 合并回来（paint order 正确）。

任一项不满足：**不要硬跑**，走兜底（见 §6）。

## 2. 标准命令（在装有 AI 的本机执行）

### 2a. cached 路（默认）

先建工作目录并一次性解析缓存（可单独先跑看是否会报"不支持构造"）：

```powershell
python <skill目录>/scripts/prep-replay-cache.py `
  --input <master.svg> --output-dir <工作目录> --job-id <basename>
```

预期输出形如 `OK|...|atoms=N|batches=M|completed=0`；若报 `Unsupported SVG element …` 之类，说明该产物不能走 cached，**改走 2b**。

然后执行绘制（把图形+文字逐批画入当前活动文档）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File <skill目录>/scripts/run_nv_replay.ps1 `
  -InputSvg <master.svg> -WorkDir <工作目录> `
  [-OutputAi <out.ai>] [-OutputPng <out.png>] [-DelayMs 0]
```

可选参数与说明（默认即推荐）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `-MinBatchSize/-MaxBatchSize` | 20 / 50 | 每批原子数（DP 自动拆分；整图<20 单批） |
| `-Placement` | center | 画板内放置位置（center/top-left/…） |
| `-MaxWidthFraction/-MaxHeightFraction` | 0.72 / 0.78 | 相对画板的最大占幅比例 |
| `-DelayMs` | 0 | 每原子可见延迟毫秒；演示时再调大 |
| `-TargetLayerName` | 空(活动图层) | 画入指定图层 |
| `-DryRun` | off | 只做缓存与自检，不触碰 Illustrator |
| `-QuietExistingGroups` | off | 断点续跑时不打印 SKIP 行 |

成功结尾输出：`NATURE_VECT_REPLAY_COMPLETE|...|ai=...|png=...|batches=M/M|mode=fresh|illustrator_window_untouched=true`。中途失败输出 `RESUME_REQUIRED|failed_batch=…|state=…`：直接用**同一条命令重跑**即可从断点续跑（playback.json 幂等）。

### 2b. direct 路（cached 拒收 / 含 CMYK/Gray/Lab 时的兜底）

> ⚠️ **体型门槛（实测铁律）**：direct 让 AI **整图导入 SVG**。只适合**小图元为主**的 SVG（几千 line/circle/短 path）。**巨型/海量长 path（数百~上千个 path、d 数据几十万~上百万字符）会直接压垮 AI 导入器：COM RPC 断（`0x800706BE`）→ AI 卡死/崩溃。** 图大请一律走 2a cached；AI 若已因 direct 崩溃，需手动重启 Illustrator。

一次调用完成（Illustrator 自己导入并采样重画，无预解析缓存）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File <skill目录>/scripts/run_nv_direct.ps1 `
  -InputSvg <master.svg> [-OutputAi <out.ai>] [-OutputPng <out.png>] [-DelayMs 0]
```

可选参数与说明：

| 参数 | 默认 | 说明 |
|---|---|---|
| `-Placement` | center | center/bottom-right/top-right/bottom-left/top-left |
| `-MaxWidthFraction/-MaxHeightFraction` | 0.72 / 0.78 | 相对画板最大占幅比例 |
| `-DelayMs` | 0 | 每原子可见延迟毫秒（演示调大） |
| `-NewDocument` | off | 新建文档代替画入当前活动文档（调试用） |
| `-DocumentWidth/-DocumentHeight` | 1254 / 1254 | 仅 `-NewDocument` 时生效 |
| `-ReplaceExistingGroup` | true | 重跑时先移除同名旧根组 |
| `-AtomicIndex N` | -1 | 只重画第 N 个原子（原子级调试） |
| `-AtomicBatchJson '<json>'` | 空 | 按指定原子/组名列表分批画（断点自续调试） |
| `-SaveOutputs` | true | 是否存 .ai/.png |
| `-GroupName` | `NATURE_VECT_DIRECT_Runtime_SVG` | 目标根组名 |

成功结尾输出 `OK|...|atomicObjects=N|sourceAtomicObjects=N|...|saved=true`；失败输出 `ERROR|message|line|context`（`clipped groups`/`Unsupported imported item type` 之类说明该 SVG 不适用 direct，按 §6 回退）。direct 无续跑：失败修图后整条命令重跑（`-ReplaceExistingGroup` 自动清旧组）。

## 3. 绘制完成后 agent 必须做的事（对位收敛的关键）

脚本负责"画得对、文字可编辑"；**位置的精修由 agent 目视完成**：

1. 切回 Illustrator 画板（cached 路已逐批画出图形；direct 路已整体画出，文字为可编辑文本框）。
2. 用**选择工具**点选文字 → 属性应显示为"文字/文本对象"；双击可进入编辑（改字/换字体）——向用户确认"文字可编辑"。
3. 逐个文字框核对位置：与底图图形是否重合、是否漏字/串位、多行间距。位置不对时**直接拖动文字框**或改字号即可，不需回改 manifest 坐标（manifest 只保证初值）。
4. 颜色/字体替换提示（缺字体时 AI 弹出）：优先换成目标机已装字体。
5. 全部核对无误后（文件已由脚本存为 out.ai；png 已导出一次），告知用户交付路径；中间产物 clean.png/base.svg/master/manifest 一并说明。

> 参考：操作菜单与失败兜底见 `illustrator-computer-use.md`。

## 4. 流程与文件的关系

```
去字图 clean.png ─convert─> base.svg
manifest.json + base.svg ─text-inject─> master(带 live <text>) ─┬─ 已打开 AI：在 Illustrator 中绘制（direct-adobe，本文件）
                                                                  └─ 无 GUI  ：「AI 打开导入」交付 .text.svg（§6，绘制不可行时）

master ─┬─ cached：prep-replay-cache.py ─> geometry-cache.json + playback.json
        │          run_nv_replay.ps1 ─COM─> illustrator-replay-runtime.jsx ─逐批─> 画板原生路径 + live TextFrame
        └─ direct：run_nv_direct.ps1 ─COM─> illustrator-direct-runtime.jsx ─整体─> NoUI 导入采样 → 画板原生路径 + live TextFrame
                                                                                          │
agent 目视微调文字 → 交付 out.ai / out.png
```

脚本说明：
- `prep-replay-cache.py`（cached）：一次性解析 Master SVG → `geometry-cache.json`（原子几何/文字/批次）+ `playback.json`（完成状态，供断点续跑）。
- `illustrator-replay-runtime.jsx`（cached）：AI 内运行时，`draw`/`save`/`export` 三种操作；文字原子经 Python 解析为 text 后再以 pointText 建 live TextFrame。
- `run_nv_replay.ps1`（cached）：Windows COM 编排器，调 py、逐批调 jsx、检查点存盘、QA、PNG 一次导出。
- `illustrator-direct-runtime.jsx`（direct）：AI 内运行时，一次完成 NoUI 导入→采样 PathItem/CompoundPathItem/**TextFrame**→原生重画 + saveAs/PNG。
- `run_nv_direct.ps1`（direct）：Windows COM 编排器，一次调用画完，含原子级调试参数。

## 5. QA 清单（汇报"完成"前逐项过）

- [ ] 缓存预备 OK（cached 路），产物能被解析（无非纯色/裁剪等拒绝项）；或 direct 路导入采样成功（无 clipped groups 等报错）。
- [ ] cached：结尾 `NATURE_VECT_REPLAY_COMPLETE` 且 `batches=M/M`；QA `missing=0/placed=0/raster=0`。direct：结尾 `OK|...` 且 `atomicObjects` 计数合理。
- [ ] 画板内全部既有内容未被删除/移动/覆盖；根组与批组命名 `NATURE_VECT_REPLAY_*` / `NATURE_VECT_DIRECT_Runtime_SVG`。
- [ ] 文字点选为文本对象、可双击编辑，位置经 agent 目视微调与图形对齐。
- [ ] out.ai 与 out.png 已存在且为最新；PNG 只导出一次。

## 6. 兜底与失败处理

| 现象 | 处理 |
|---|---|
| 本机不是 Windows / 无 AI / AI 未打开 | 停；改用 text-inject 兜底交付 `.text.svg`，请用户在有 AI 的机器打开另存 .ai |
| agent 无 GUI 控制 | 同上；或让用户在 AI 里 `文件→打开 master.svg` 后手动调字 |
| cached 路 prep 报"不支持构造"（class/gradient/clip/mask/dash/tspan/image 等） | 先确认**图是小图元**再改走 direct（§2b）；图大/海量 path 时无构造可破——重生成可被 prep 接受的 master（见 text-workflow） |
| **direct 一跑 AI 就 RPC 断/卡死/崩溃（0x800706BE）** | **典型原因：图太大**（海量/超长 path 整图导入压垮 AI）。停 direct → 该图走 cached（prep 拆原子逐批画）；手动重启 Illustrator 后再跑 |
| direct 报 clipped group / 不支持类型 | 回退：AI 直接打开 master.svg（矢量自动准），文字用文字工具逐块补在正确位置 |
| prep 报 python/fontTools 缺失 | 安装 python3 + `pip install fonttools`；或（仅小图）改走 direct |
| cached 中途 `RESUME_REQUIRED` | 同命令重跑续跑（playback.json 幂等） |
| direct 中途失败 | 修好输入后整条重跑（`-ReplaceExistingGroup` 清旧组）；`-AtomicIndex N` 定位失败原子 |
| 单批/单原子反复失败到重试上限 | 看 stdout 失败原子名与 message，按 illustrator-computer-use.md 兜底清单处置；必要时回退 |
| 文字位置仍偏 | 不重算坐标——直接在 AI 里拖到正确位置；想改初值则重跑 text-inject 后再画一遍 |

## 7. 版权与依赖

- cached/direct 绘制机制移植自本地 cell-lct（同作者），命名空间 `NATURE_VECT_REPLAY_*` 与 `NATURE_VECT_DIRECT_*`。
- nature-vect 的 direct 引擎为 cell-lct direct 引擎的移植，并**增强支持 TextFrame**（cell-lct 原版 direct 只画图形、遇文字报错；nature-vect 要求带可编辑文字的 master 也能 direct 画为 live 文本）。
- 依赖：Windows + Illustrator 2019+（COM）+（cached 路）python3/fontTools + agent GUI。**不引入第三方图片清理服务**；去字仍由客户端自带能力完成（豆包=自带像素级覆盖字）。
