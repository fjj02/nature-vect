---
name: nature-vect
description: 把位图（PNG/JPG/WebP 等）转成可在 Adobe Illustrator 2019–2026 中打开的可编辑 SVG 矢量；当用户要求图中文字也可编辑时进入文字模式：先清掉位图文字再转矢量，把可编辑 <text> 注入 SVG，再请用户打开 Adobe Illustrator，由 agent 在打开的文档中绘制成可编辑文本对象并交付 .ai（无法在本机 Illustrator 中绘制时，交付可编辑 SVG 由用户另存 .ai）。当用户说“把这张图转矢量”“图片转 SVG/矢量图”“导出 Illustrator 能用的图”“文字要可编辑”“查询额度/还有多少额度/剩余次数”“nature-vect”等时使用。首次使用需要用户提供一把 API key（向卖家购买），由 agent 调用本 skill 的 init 命令写入用户级配置。
license: MIT
metadata:
  output: 基础模式=可编辑矢量 SVG（文字按字形路径保留）；文字模式=可编辑文本对象（agent 在 Adobe Illustrator 中绘制交付 .ai，双击可改字）；无法在本机绘制时兜底=带可编辑 <text> 的 .text.svg 由用户另存 .ai
---

# nature-vect —— 图片转可编辑 SVG 矢量

把位图转换成可在 Adobe Illustrator 中编辑的矢量 SVG。转换由本 skill 自带的 Node.js 脚本完成，默认开启 Adobe 兼容模式（Illustrator 2019–2026）。

**两种模式，先判断再走流程：**

| 模式 | 适用情况 | 最终文字形态 | 流程 |
|---|---|---|---|
| 基础模式 | 原图无文字，或用户只要纯矢量 | 字形路径（当图形处理，不能改字） | convert → validate |
| 文字模式 | 用户要图中文字**可编辑、能改字** | 可编辑文本框，在 Illustrator 中绘制后可双击改字 | 识别校对 → 去字 → convert → text-inject(master) → 请用户打开 Illustrator，由 agent 在其中绘制(见 direct-adobe.md) → 交付 .ai；无法在本机绘制则停下交付 .text.svg |

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
- **文字模式额外前提**：你自己具备 ①视觉看图（识别文字内容与位置）②把图中文字区域清掉的能力（局部图像编辑/清除）。缺任一能力请勿硬跑文字模式（见降级说明）。

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
3. 否则 → 基础模式（下文「主流程——基础模式」），一把过，最快最稳。
4. 用户没给图、只问额度 → 走上方「查询剩余额度（辅助）」。

# 主流程——基础模式

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

每次会话**第一次**产生 SVG 前，必须先向用户确认「保存到哪个路径、叫什么文件名」，得到明确回答后再写文件。不要在未确认的情况下自作主张把 SVG 写到临时或猜测目录。

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

### 第 7 步（可选）：用 computer-use 打开展示 / 验证

只有你具备 GUI / computer-use 能力且用户要求“打开看看”时执行；否则直接把产物路径告诉用户即可。

原则：**只打开，不重画**。用 Illustrator 的“打开”导入即可，禁止用画笔工具照着重画。详细操作见 `<skill目录>/references/illustrator-computer-use.md`（中英菜单、快捷键、失败兜底）。

# 主流程——文字模式

**先通读 `<skill目录>/references/text-workflow.md`**（含 manifest 字段、去字红线、注入与导出细节），再按下面骨架执行。需要**停下与用户交互**的节点：文字清单校对、去字结果、请用户打开 Illustrator（第 8 步）。

### 第 1 步：确认 key（同基础模式第 1 步）

### 第 2 步：视觉识别文字 → 生成 manifest.json

用你的视觉能力读**去字前原图**，把原图里**所有文字型内容**逐块记录进 manifest：标注文字、panel 字母、图例、坐标轴刻度、单位、符号等都算。字段见 text-workflow.md §2，示例见 `<skill目录>/assets/manifest.sample.json`（新格式 `schema_version:"1.0"` / `text_elements`；旧 `texts[]` 格式仍兼容，引擎自动识别）。**坐标一律用原图像素**，顶部 `source_canvas{width,height}` 填原图尺寸，`x/y` 指文字基线锚点。**看不准的文字内容标注“待确认”，先停下问用户，禁止编造。**

### 第 3 步：与用户校对（强制闸口）

把 manifest 的每块文字内容、建议字体、大致位置，以及被标成**“待确认”的项**，列给用户确认（防读错、防后续生图改字、防不确定内容被当成确定）。有出入就改清单再对。

### 第 4 步：去字 → clean.png（用你自己的图像能力）

用你自己的图像能力，把 manifest 里覆盖的文字区域清掉，**以原图为参照、单独产出 clean.png**。推荐提示词：“仅删除所有文字、字母、数字与标注字符，并修复其覆盖的小范围背景。其余图形、图标、曲线、箭头、连线、边框、纹理、颜色、布局、比例、画布尺寸与裁切完全保持原样。不要重画或优化、美化、移动、新增任何非文字元素。”**红线：保持同尺寸同构图、只清文字区域、禁止整图重画、保留箭头与图例色块**；完成后把原图与 clean.png **整体目视对比**（必要时放大文字区复查），确认图形未被改动，若有改动先修正受影响区域再继续。最后把 clean.png 给用户过目（第二次强制闸口）。去字效果不足**不得静默跳过**——如实告知用户，让其提供无文字版底图或接受瑕疵。

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

### 第 8 步：请用户打开 Adobe Illustrator，由 agent 在其中绘制并交付（必须完成）

`out.svg`（Master SVG = 矢量 + 可编辑 `<text>`）生成后，**必须**在 Adobe Illustrator 中完成绘制并交付 `.ai`，不得以“只交付 SVG”代替。

1. **向用户提出打开请求（固定话术）**：
   > 请打开 Adobe Illustrator，我将在其中为你绘制。请新建一个与图片等大的画板（或打开你要追加的 .ai 文档），打开后告诉我。
   全程对用户**不得**出现“直播/重现/重绘/重播/直控”等内部说法；只按上述方式表达“由 agent 在 Illustrator 中绘制”。
2. 用户已打开目标文档后，按 `<skill目录>/references/direct-adobe.md` 双引擎执行：**默认 cached**（`prep-replay-cache.py` + `run_nv_replay.ps1`），图越大越必须 cached；仅当 cached 被 prep 拒收（gradient/clip/use/CMYK 等）且图是**小图元**时才改 direct（`run_nv_direct.ps1`）。**铁律：海量/超长 path 的图绝不可走 direct（AI 整图导入会崩），只能 cached。**两者都把文字建成可编辑文本框。
3. 画入后在画板内**目视微调文字对位**（直接拖动文字框/调字号即可），存为 `out.ai`（另导出一次 `out.png`），交付并提示“文字在 Illustrator 中双击即可改字”，附中间产物 clean.png/base.svg/manifest 位置。
4. **无法完成绘制的边界**（本机不是 Windows / 未装 Illustrator / agent 无本机 GUI 控制能力 / 用户未打开或拒绝打开 AI）：**停下，如实说明原因**，交付 `out.svg`（含可编辑 `<text>`），请用户自己在 AI 里 `文件→打开` 并另存 `.ai`；用户同意时也可用 `<skill目录>/scripts/ai-export.jsx` 代存。**严禁假装已完成绘制、严禁虚构交付。**

## 降级路径（能力不足时）

- 只有视觉、没有去字能力：交付「字形路径」基础模式产物，并如实说明文字不能改字。
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
