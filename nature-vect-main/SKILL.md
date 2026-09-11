---
name: nature-vect
description: 把位图（PNG/JPG/WebP 等）转成 Adobe Illustrator 原生 .ai/.svg：基础模式=可编辑矢量（文字按字形路径保留，不能改字）；文字模式=可编辑文本对象（文字可双击改字）。默认由 agent 自动打开本机 Adobe Illustrator、新建与图等大的画板，把图形/文字绘制为原生对象并交付 .ai；仅当环境确实无法在本机绘制且用户知情同意时才降级交付 .svg。当用户说“把这张图转矢量”“图片转 SVG/矢量图”“导出 Illustrator 能用的图”“文字要可编辑”“查询额度/还有多少额度/剩余次数”“nature-vect”等时使用。首次使用需要用户提供一把 API key（向卖家购买），由 agent 调用本 skill 的 init 命令写入用户级配置。
license: MIT
metadata:
  output: 基础模式=agent 自动开 Illustrator 重绘交付 .ai（可编辑矢量，文字按字形路径保留）+ .png；文字模式=同左，但文字为 live 文本可双击改字；仅本机确实无法绘制且用户知情同意时降级交付 .svg；用户显式只要 SVG 时按用户指定交付 .svg 不算降级
---

# nature-vect —— 图片转可编辑 AI / SVG 矢量

把位图转换成可在 Adobe Illustrator 中编辑的矢量。转换由本 skill 自带的 Node.js 脚本完成（产出 Adobe 兼容 SVG），再由 agent 自动开本机 Illustrator 把它重绘为原生 `.ai` 交付（Illustrator 2019–2026）。

**两种模式，先判断再走流程：** 两种模式默认都以 `.ai` 交付（agent 自动开 Illustrator 重绘为原生对象）；区别只在文字能否改字。

| 模式 | 适用情况 | 最终文字形态 | 流程 |
|---|---|---|---|
| 基础模式 | 原图无文字，或用户只要纯矢量 | 字形路径（当图形处理，不能改字） | convert → validate → agent 自动开 AI 重绘交付 .ai；无 AI 且用户知情同意才降级 .svg；用户点名只要 SVG 按用户指定 |
| 文字模式 | 用户要图中文字**可编辑、能改字** | 可编辑文本框，agent 自动开 Illustrator 绘制后可双击改字 | 前置声明自检 → 识别校对 → 去字 → convert → text-inject(master) → agent 自动开 AI 并新建等大画板、在其中绘制(见 direct-adobe.md) → 交付 .ai；仅环境无法绘制且用户知情同意才降级交付 .text.svg |

## 何时使用本 skill

- 用户要把一张位图图片转成矢量图 / SVG
- 用户要为 AI 绘图 / 印刷 / 刻字机等准备矢量文件
- 用户明确说要用 nature-vect，或要求“导出 Illustrator 能用的图”
- 用户询问「额度 / 剩余次数 / 还能转几张」：查询剩余额度（见下方「查询剩余额度」小节）
- 若用户同时要求“文字可编辑 / 能改字 / 要 .ai 文件且文字能改”：进入**文字模式**

不适合：纯文字转换排版、需要逐像素还原的照片（矢量化会把照片变成色块，质量由第三方引擎决定）。

## 环境要求

- 能执行 Node.js（>= 18）。多数 agent（opencode / Claude Code / Codex / Trae 等）可执行 `node`。
- 首次使用必须先配置 API key（见下）。key 通过脚本写入用户级配置，**不进入任何项目或仓库文件**。
- **两种模式共用绘制前提（交付 .ai 必须）**：本机 **Windows** + 已装 **Illustrator 2019+**，且你能控制本机（GUI / COM）。最终交付是 **agent 自动打开 Illustrator 并绘制出的 .ai**；缺此前提时**开工前**就要停下并如实告知（见各模式第 0 步），不要做完再降级。
- **文字模式额外前提**：你自己具备 ①视觉看图（识别文字内容与位置）②一个可用的**生成式图像编辑模型**（能按语义只删除文字并自然补全背景）。**去字只许走图像模型的语义清除，禁止像素级覆盖 / 蒙版 / 色块 / 阈值 / 克隆 / 模糊 / 手绘 / 本地描摹**；缺任一能力请勿硬跑文字模式（见降级说明）。

# 查询剩余额度（辅助）

用户问「额度 / 还剩多少 / 剩余次数 / 还能转几张」时，运行：

```bash
node <skill目录>/scripts/nature-vect.js credit
```

- 脚本从用户级配置（`~/.nature-vect/config.json`）或环境变量 `NATURE_VECT_API_KEY` 读 key 查询额度，成功后打印剩余次数（1 次 ≈ 1 张图）。
- 把返回的剩余次数如实转述用户；遇到 401/403 说明 key 无效需重新 init，遇到 402 提示充值，遇到网络错误则转述错误原文，**不要编造额度**。
- key 未配置时先走「第 1 步：确认 key 已配置」的 init，再查额度。

## 模式选择（收到任务先做这个判断）

1. 用户给了一张位图要求转矢量。先看原图是否含文字、用户是否提到“文字可编辑/能改字/字要能改”。
2. **含文字且要可编辑** → 文字模式（跳到下文「主流程——文字模式」）。
3. **用户点名要 SVG**（“转成/输出/存成 .svg”“要 .svg 文件 / 只要 SVG / 不用 .ai”“刻字机、激光等只认 SVG”）→ 仍走基础模式，但按用户指定**只交付 .svg**（走下方基础模式即可，跳过第 8 步绘制，不算降级）。
4. 否则 → 基础模式（下文「主流程——基础模式」）：默认 convert → validate → agent 自动开 AI 重绘交付 `.ai`。
5. 用户没给图、只问额度 → 走上方「查询剩余额度（辅助）」。

# 主流程——基础模式

### 第 0 步：确认交付形态与自检（开工前必做）

- 若用户**点名要 SVG**（如“转成/输出/存成 .svg”“要 SVG 文件”“只要 SVG / 不用 .ai”“用于刻字机、激光等只认 SVG 的软件”）：
  直接以 **.svg 为最终交付**，不需要 AI，跳过本步的 AI 自检，也跳过下文第 8 步绘制，第 1–7 步后即交付 .svg。
- 否则基础模式默认交付 **`.ai`**（agent 自动开 Illustrator 把 SVG 重绘为原生矢量对象，文字为字形路径），开工前自检：
  - [ ] 本机是 **Windows**
  - [ ] 已装 **Illustrator 2019+**
  - [ ] agent 具备本机 **GUI / COM 控制**能力
  自检不通过 → **在动手 convert 之前就停下**，如实告诉用户「此环境无法把矢量重绘成 .ai」，并给出选择：a) 改交付 .svg（Adobe 兼容、AI 可直接打开，但非原生 .ai）；b) 用户换具备 Windows+AI+本机控制的 agent / 机器重跑。**红线：不得先转完再降级；不得假装已交付 .ai。**

### 第 1 步：确认 key 已配置

- 若尚未配置，询问用户「购买得到的 API key」，然后由你执行：

  ```bash
  node <skill目录>/scripts/nature-vect.js init <KEY>
  ```

  或者让用户设置环境变量 `NATURE_VECT_API_KEY` 后跳过 init。

- 校验配置：

  ```bash
  node <skill目录>/scripts/nature-vect.js check
  ```

安全红线：
- 绝不在对话里原样重复用户的 key；绝不把 key 写入任何项目文件、聊天记录外的文件，绝不 git 提交。
- 若用户只是“贴了 key 想试用”，也走 init，不要存到别处。

### 第 2 步：定位输入图片

- 用户给图片路径则直接用；没有就给用户一个上传/放图的目录并等待。
- 确认图片确实可读后再进入转换。

### 第 3 步：确定转换参数

默认参数等价于“Adobe 兼容 + 填充 + 不分组”，对绝大多数场景够用，**用户没要求就不要改**。

- 常用预设：`--preset default|grouped|lineart|edges`。
- 想调整细节（描边、分组、叠加、更多底层参数）时，先阅读 `<skill目录>/references/presets.md`。

预设速查：
| 预设 | 效果 |
|---|---|
| `default` | 填充、不分组、Adobe 兼容（推荐先试这个） |
| `grouped` | 填充 + 按颜色分组，多色插画更好管理 |
| `lineart` | 单色描边线稿（覆盖色 #000000、宽度 1、非缩放描边） |
| `edges` | 仅描边边缘轮廓 |

### 第 4 步：确认输出路径（强制）

每次会话**第一次**产出文件前，必须先向用户确认「保存到哪个目录、用什么文件名」，得到明确回答后再写文件。`.svg`（中间/点名交付）与 `.ai/.png`（默认交付）用同一路径与主文件名（如 `out.svg` → `out.ai`/`out.png`）。不要在未确认的情况下自作主张写到临时或猜测目录。

### 第 5 步：执行转换

```bash
node <skill目录>/scripts/nature-vect.js convert <输入图片> -o <已确认的输出.svg> [--preset ...]
```

- 脚本默认自动创建输出文件的父目录；成功后打印保存位置，你应向用户复述完整路径。

### 第 6 步：输出自检

```bash
node <skill目录>/scripts/nature-vect.js validate <输出.svg>
```

校验不通过时，把报错告诉用户，必要时重试转换或调整参数。

### 第 7 步：把 SVG 交付给用户（用户点名“只要 SVG”时到此处即完成）

若第 0 步判定本单只要 SVG：到这里把 `.svg` 路径交付给用户（Adobe 兼容，AI 2019–2026 可直接打开编辑），并说明“文字是字形路径、当图形处理”。**这是用户指定的正常交付，不是降级。**

### 第 8 步：agent 自动重绘并交付 .ai（默认主路，必须完成）

`.svg`（Adobe 兼容矢量，文字为字形路径）生成后，默认**必须**由 agent 自动重绘为 Illustrator 原生 `.ai`：

1. **自动开 Illustrator + 新建与 SVG 等大的画板**：用 `run_nv_replay.ps1 -AutoCanvasFromSvg`（AI 未运行且已获用户同意则加 `-AllowLaunch`），画板宽高 = SVG viewBox（1px=1pt），内容 1:1 落位。命令与引擎说明见 `<skill目录>/references/direct-adobe.md` §2——**默认 cached**（图越大越必须 cached），仅 cached 被 prep 拒收且图是小图元时才改 direct；海量/超长 path 绝不可走 direct。
2. 画入后 **agent 在画板内目视核对**图形完整性（矢量对象可选中、无缺失），脚本已存 `out.ai` 并导出一次 `out.png`。
3. **完成闸口（全过才可宣布完成）**：
   - [ ] `out.ai` 在磁盘**真实存在**且是本次重绘新生成（看时间/大小，非旧文件）；
   - [ ] `out.png` 已导出；
   - [ ] 画板内矢量对象可点选、无丢块。
   任一项不满足 → 不宣布完成：修正（重跑/重导出）或如实说明未完成。
4. 通过后交付 `out.ai` + `out.png`，说明“Illustrator 原生 .ai，可编辑；图中文字为字形路径，若需改字请走文字模式”。

**降级（仅本机确实无法绘制 + 用户知情同意）**：第 0 步自检不过却仍被要求交付 .ai 时——停下说明原因，经用户知情同意后才交付 `.svg`（Adobe 兼容），并明确“未重绘成原生 .ai”。**严禁假装已完成绘制。**

### 第 9 步（可选）：用 computer-use 打开展示 / 验证

只有你具备 GUI / computer-use 能力且用户要求“打开看看”时执行；否则直接把产物路径告诉用户即可。

原则：**只打开，不重画**。用 Illustrator 的“打开”导入即可，禁止用画笔工具照着重画。详细操作见 `<skill目录>/references/illustrator-computer-use.md`（中英菜单、快捷键、失败兜底）。

# 主流程——文字模式

**先通读 `<skill目录>/references/text-workflow.md`**（含 manifest 字段、去字红线、注入与导出细节），再按下面骨架执行。需要**停下与用户交互**的节点：前置声明（第 0 步，仅在无法绘制时）、文字清单校对、去字结果、降级前知情同意。**绘制环节不依赖用户在场**：agent 自动打开 Illustrator 并新建画板，无需用户手动打开。

### 第 0 步：前置声明与能力自检（开工前必做，不满足立即停下）

文字模式交付物**写死为 Illustrator 原生 `.ai`**（在 AI 中绘制，文字可双击改字），**不需要询问用户交付形式**。开工（识别/去字/转矢量/注入）之前先做两件事：

1. **向用户声明**：本模式将自动打开本机 Adobe Illustrator、新建与图等大的画板，把图形与文字绘制为原生对象并交付 `.ai` + `.png`。用户无需手动打开 AI。
2. **agent 自检绘制前提是否成立**：
   - [ ] 本机是 **Windows**
   - [ ] 已装 **Illustrator 2019+**
   - [ ] agent 具备本机 **GUI / COM 控制**能力（脚本 `run_nv_*.ps1` 走 Illustrator COM）
   - [ ] cached 引擎还需 **python3 + fontTools**（direct 引擎无需；图大必走 cached）

自检不通过（例如不是 Windows / 未装 AI / 无法控制本机 AI）：**在动手识别、去字、转换之前就停下**，如实告诉用户「此环境无法完成 Illustrator 绘制、交付不了 .ai」，并给出选择：
- 改走**基础模式**（文字为字形路径不能改字；本机无 AI 时降级交付 Adobe 兼容 .svg，用户知情同意；本机有 AI 时按基础模式第 8 步交付 .ai）；
- 用户换用**具备 Windows + Illustrator + 本机控制的 agent / 机器**重跑文字模式。

**红线：不得先跑完识别→去字→转换→注入整套流程、最后一步才暴露做不了；也不得以“用户没应答”为由中途把 SVG 当正常交付。** 第 0 步没通过就不进入后续步骤。

### 第 1 步：确认 key（同基础模式第 1 步）

### 第 2 步：视觉识别文字 → 生成 manifest.json

用你的视觉能力读**去字前原图**，把原图里**所有文字型内容**逐块记录进 manifest：标注文字、panel 字母、图例、坐标轴刻度、单位、符号等都算。字段见 text-workflow.md §2，示例见 `<skill目录>/assets/manifest.sample.json`（新格式 `schema_version:"1.0"` / `text_elements`；旧 `texts[]` 格式仍兼容，引擎自动识别）。**坐标一律用原图像素**，顶部 `source_canvas{width,height}` 填原图尺寸，`x/y` 指文字基线锚点。**看不准的文字内容标注“待确认”，先停下问用户，禁止编造。**

### 第 3 步：与用户校对（强制闸口）

把 manifest 的每块文字内容、建议字体、大致位置，以及被标成**“待确认”的项**，列给用户确认（防读错、防后续生图改字、防不确定内容被当成确定）。有出入就改清单再对。

### 第 4 步：用生成式图像模型去字 → clean.png（必须走图像模型）

用你所用的 agent **自带的生成式图像编辑模型**，对原图执行一次“只删除文字、邻近背景自然补全”的**语义编辑**，**以原图为参照、单独产出同尺寸 clean.png**。**只许图像模型语义清除，禁止像素级覆盖 / 蒙版 / 色块 / 阈值 / 克隆 / 模糊 / 手绘 / 本地描摹。**

固定去字提示词（中英各一，按模型偏好择一；Codex 类图像模型建议优先英文）：

- 中文：
  > 只删除图中所有可见文字与文字相关符号（含标注文字、字母、数字、单位、符号、图例文字、坐标轴刻度文字、panel 字母等），并用相邻背景自然补全被删位置。完整保留箭头及箭尾、连接线、框、坐标轴与刻度线、热图、图例色块、图形主体、图标、曲线、纹理、颜色、比例、尺寸、相对位置、层级与整体构图；不得新增、移动、缩放、重绘、改写或美化任何非文字元素。输出必须与原图保持完全相同的画布尺寸与构图。
- English:
  > Remove only the visible text and text-related glyphs (labels, letters, numbers, units, symbols, legend text, axis tick text, panel letters, etc.) and inpaint each removed area using the surrounding background. Preserve everything else exactly: arrows and arrowheads, connectors, frames, axes and tick marks, heatmaps, legend swatches, subject artwork, icons, curves, textures, colors, proportions, dimensions, relative positions, layering, and overall layout. Do not add, move, scale, redraw, rewrite, or beautify any non-text element. Output must keep the exact same canvas size and composition as the input.
- 可选负向提示（模型支持时）：新增文字或伪文字、重绘图形、改变布局、改变画布尺寸、模糊、色块伪影

**红线（硬门禁，违反即停）：**
1. **去干净是转矢量的前置条件。** `clean.png` 必须通过“无文字残留”校验，**否则禁止执行 `convert`（转矢量）**。
2. 校验方法：原图与 `clean.png` **整体目视对比**，并**逐条核对 manifest 里每一块文字是否都已消失**；出现任何残留字形、伪字、糊字即判不合格。
3. 不合格**只有两条出路**：① 换更强图像模型 / 提高分辨率重清；② 请用户提供**无字底图**（以其图当 `clean.png`）。**不接受“带瑕疵继续转换”。**
4. 只清文字区域；保持**同尺寸同构图**，禁止整图重画、禁止移动或美化非文字元素、保留箭头与图例色块。
5. 去字效果不足**不得静默跳过**，须如实告知用户。

校验通过后把 clean.png 给用户过目（第二次强制闸口），确认去字干净且构图未变，**才可进入第 5 步转矢量**。

### 第 5 步：转矢量

```bash
node <skill目录>/scripts/nature-vect.js convert clean.png -o base.svg
```

### 第 6 步：注入可编辑文字

先 dry-run 核对推算坐标（内容/字号/基线是否合理，尤其是估字号的块）：

```bash
node <skill目录>/scripts/nature-vect.js text-inject base.svg manifest.json --dry-run
```

无误再真正注入：

```bash
node <skill目录>/scripts/nature-vect.js text-inject base.svg manifest.json -o out.svg
```

对位不对时的修法顺序：① 换 `--fit uniform`；② 整体偏移用 `--shift dx,dy`、整体字号用 `--size 倍数`、整体缩放用 `--scale 倍数`；③ 个别块仍偏 → 旧格式 `texts[]` 改该块 `baseline`/`dx`/`dy` 或调 `bbox`；新格式 `text_elements` 改其 `y`（基线）/`dx`/`dy`/`font_size`/`source_bbox` 后重跑。详见 text-workflow.md §5。

### 第 7 步：结构自检

```bash
node <skill目录>/scripts/nature-vect.js validate out.svg
```

结果应显示 `"textNodes": N`（N≥1）。

### 第 8 步：agent 自动打开 Illustrator、新建等大画板并绘制，交付 .ai（必须完成）

`out.svg`（Master SVG = 矢量 + 可编辑 `<text>`）生成后，**必须**由 agent 在 Adobe Illustrator 中完成绘制并交付 `.ai`。此环节**无需用户打开 AI**，全程 agent 自动完成：

1. **自动打开 Illustrator 并新建与 SVG 等大的画板**：通过脚本（`-AutoCanvasFromSvg`）自动启动 Illustrator（未运行则 COM 自启），并新建一个宽高 = Master SVG viewBox 尺寸（1px = 1pt）的 RGB 文档作为活动画板。见 `<skill目录>/references/direct-adobe.md` §2 的等大画板命令。
2. **绘制（双引擎选路）**：按 `<skill目录>/references/direct-adobe.md` 执行——**默认 cached**（`prep-replay-cache.py` + `run_nv_replay.ps1`），图越大越必须 cached；仅当 cached 被 prep 拒收（gradient/clip/use/CMYK 等）且图是**小图元**时才改 direct（`run_nv_direct.ps1`）。**铁律：海量/超长 path 的图绝不可走 direct（AI 整图导入会崩），只能 cached。**两者都把文字建成可编辑文本框，且绘制命令本身就在等大画板上执行，无需用户先开文档。
3. **画入后在画板内目视微调文字对位**（直接拖动文字框/调字号即可），存为 `out.ai`（另导出一次 `out.png`）。
4. **完成闸口（交付前强制核验，全部通过才可宣布完成）**：
   - [ ] `out.ai` 在磁盘上**真实存在**且是本次绘制新生成（核对文件时间/大小，不是旧文件残留）；
   - [ ] `out.png` 已导出一次；
   - [ ] 用选择工具点选一处文字，确认是**文本对象**（属性显示为文字，可双击进入编辑）。
   任一项不满足 → 不宣布完成：继续修正（重画 / 重新导出）或如实说明未完成原因。
5. 全部通过后交付 `out.ai`，提示“文字在 Illustrator 中双击即可改字”，附中间产物 clean.png/base.svg/manifest 位置。

全程对用户**不得**出现“直播/重现/重绘/重播/直控”等内部说法；只按“自动打开 Illustrator、绘制并交付 .ai”向用户表达。

**降级兜底（仅环境根本做不到 + 用户知情同意）**：仅当本机确实无法绘制（非 Windows / 未装 Illustrator / 无法控制本机 AI）且已向用户说明原因、取得用户**知情同意**后，才交付 `out.svg`（含可编辑 `<text>`）请用户自己在 AI 里 `文件→打开` 并另存 `.ai`；用户同意时也可用 `<skill目录>/scripts/ai-export.jsx` 代存。**该兜底是失败降级，必须明确告知用户未在 Illustrator 中完成绘制，严禁假装已完成绘制、严禁把 SVG 当正常交付。**

## 降级路径（能力不足时）

- **文字模式绘制做不了**（非 Windows / 未装 AI / 无本机 GUI 控制）：**第 0 步自检即停**，不给 SVG 当文字模式交付；除非用户知情同意后走「文字清单 + 无字底图」由脚本完成 convert + text-inject 出 `.text.svg`，让用户在别处另存 `.ai`。
- **基础模式交付 .ai 做不了**（无 Windows/AI/本机控制）：**第 0 步自检即停**，改交付 Adobe 兼容 `.svg`（需用户知情同意），如实说明未重绘成原生 .ai；或用户换具备本机 Illustrator 控制的 agent / 机器。
- 只有视觉、**没有可用的生成式图像编辑模型**：文字模式降级为「字形路径」交付（等同基础模式 .ai，文字不能改字），并如实说明；**不得用像素级覆盖等方式硬凑去字**。
- 完全没有视觉/GUI：连视觉识别都做不了 → 只走基础模式；用户需文字可编辑时，请其提供「无文字底图 + 文字清单」再由脚本完成 convert + text-inject。

## 错误处理（基础模式通用）

| 现象 | 含义与处理 |
|---|---|
| `HTTP 402` | 账户积分不足，请用户充值后重试 |
| `HTTP 429` | 请求过于频繁，稍等片刻再试 |
| `请求超时` | 大图转换较慢，脚本会自动重试一次；仍失败可加 `--timeout <毫秒>` |
| `未找到 API key` | 还没配置，走 key 配置步骤 |
| `上游未返回 SVG` | 大概率是参数/服务商问题，把错误原文给用户 |

文字模式特定失败（去字留痕、对位偏差、文字不可编辑、jsx 报错等）：见 text-workflow.md §9–10。任何失败：把脚本 stderr 的错误原文转述给用户，不要编造原因。

## 兼容性说明

- 脚本默认带 `adobeCompatibilityMode`，产物是 SVG 1.1 + 内联样式，Illustrator 2019–2026 可打开编辑。
- 注入的 `<text>` 用内联属性（font-family/font-size/fill/text-anchor 写在元素上），AI 导入为可编辑文本对象。更细的 Illustrator 兼容清单见 `<skill目录>/references/adobe-compatibility.md`。
- 文字对位为近似（按 viewBox/原图画布比例换算），AI 内微调属正常操作。

## 相关文件

- `scripts/nature-vect.js` —— 唯一引擎：`init / check / convert / text-inject / validate / credit`（零依赖，Node>=18）
- `scripts/ai-export.jsx` —— 无 GUI 兜底：在 Illustrator 里把 SVG 另存为 .ai（agent 自动执行）
- `scripts/prep-replay-cache.py` —— cached 绘制引擎：解析 Master SVG 出几何/批次缓存（python3+fontTools）
- `scripts/run_nv_replay.ps1` —— cached 绘制引擎编排器（Windows COM，逐批画入 AI，断点续跑）
- `scripts/illustrator-replay-runtime.jsx` —— cached 路 AI 内运行时（draw/save/export，文字建 live TextFrame）
- `scripts/run_nv_direct.ps1` —— direct 绘制引擎编排器（Illustrator 自己导入 SVG 后重画，一次完成）
- `scripts/illustrator-direct-runtime.jsx` —— direct 路 AI 内运行时（NoUI 导入采样 Path/Compound/TextFrame 并原生重画）
- `references/presets.md` —— 转换参数与预设对照
- `references/text-workflow.md` —— **文字模式完整手册**（manifest 字段、去字红线、注入、在 Illustrator 中绘制、双轨差异、兜底）
- `references/direct-adobe.md` —— **在 Illustrator 中绘制手册**（cached/direct 引擎命令、文字支持对照、兜底）
- `references/adobe-compatibility.md` —— Illustrator 2019–2026 兼容细节
- `references/illustrator-computer-use.md` —— computer-use 打开/验证操作手册（中英）
- `assets/sample.*` —— 示例输入/输出；`assets/manifest.sample.json` —— 文字清单示例（schema 1.0；旧 `texts[]` 格式仍兼容）

## 安全提示

- key 属用户购买的商业资产，视为敏感信息。全程只允许把 key 写入用户级 `~/.nature-vect/config.json`（或环境变量），其它一律禁止。
- manifest / SVG / .ai 均为用户图文产物，不含服务密钥，可正常读写与交付。
