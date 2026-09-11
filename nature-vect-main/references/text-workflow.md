# text-workflow.md —— 「可编辑文字」模式完整手册（agent 执行用）

> 版本：以 `nature-vect ≥ v1.9` 为准。文字模式主线为「agent 自动打开 Adobe Illustrator 并新建与 Master SVG 等大的画板（1px=1pt），把图形+文字绘制为 live 文本并交付 .ai」（见 `references/direct-adobe.md`——agent 驱动 Illustrator 原生画入并把文字建成 live 文本，位置由画板内目视收敛）。绘制含双引擎：默认 cached（Python 预解析→逐批画），complex 构造被拒时改走 direct（AI 自导入 SVG 重画，同样支持 live 文字）。`text-inject` 定位为**生成 Master SVG** 与 **环境确实无法绘制、用户知情同意后的兜底交付**；其 dry-run 明细、`--fit/--shift/--size/--scale` 微调、manifest 的 `dx/dy` 在兜底路径依然有效。
>
> 本文的「识别 → 记录 → 去字」方法论已收紧：识别范围更全、记录字段更细；**去字必须走生成式图像模型做语义清除，禁止像素级覆盖 / 蒙版等替代手段**，并以原图为参照做整体目视校验。manifest 默认使用新格式 `schema_version:"1.0"` / `text_elements`；旧 `texts[]` 格式仍兼容。

本文供**具备视觉理解 + 自带生成式图像编辑模型 + 可控制本机 Illustrator（Windows/GUI/COM）的 agent** 使用：让用户图里原来的文字，最终以**可编辑文本对象**出现在 Illustrator 产物中（`.ai`，文字可双击改字），而不是字形路径。整个流程由 agent 自动完成，需要停下的节点：前置声明（仅在无法绘制时）、文字清单校对、去字结果、降级前知情同意。**绘制环节不依赖用户在场**——agent 自动打开 AI 并新建等大画板。

> 读本文前先确认你具备：①视觉看图能力（识别文字内容与位置）；②一个可用的**生成式图像编辑模型**（能按语义只删除文字并自然补全背景，如 Codex 的图像编辑模型；豆包/其它须具备语义图像编辑能力方可用）。**不使用像素级覆盖字等非模型手段**。两者皆无才不进文字模式。

## 0. 何时进入文字模式

用户想要「文字可编辑、能改字」，且原图明显含文字时进入本模式。原图无文字、或用户只要纯矢量 → 走基础模式（convert 后默认重绘交付 .ai；用户点名只要 SVG 则交付 .svg）。

## 1. 总流程（9 步）

```
⓪ 前置声明与能力自检：交付物写死为 .ai，不问用户交付形式；自检 Windows+AI2019+ + GUI/COM 控制
   （cached 另需 python3+fontTools）。不满足 → 开工前停下，给基础模式或换环境选项，勿白做。
① 视觉识别原图文字（覆盖所有标注）→ manifest.json ──② 与用户校对内容/字体/"待确认"项──→
③ 去字：用生成式图像模型按提示词整图语义清除文字（禁像素级覆盖），以原图为参照、整体目视对比 → clean.png
   ──④ 硬门禁：校验无文字残留（未过不得转矢量）→ 给用户确认去字干净且构图未变──→
⑤ nature-vect convert clean.png → base.svg
⑥ nature-vect text-inject base.svg manifest.json → Master SVG（矢量 + live <text>；双 schema 自动识别）
⑦ agent 自动打开 Adobe Illustrator 并新建与 Master SVG 等大的画板（1px=1pt），把图形+文字绘制进去
   （必须走，不可用纯 SVG 交付代替；无需用户开 AI）：
   · 默认 cached（prep 预解析→逐批画，可续跑，图大必走它）；prep 拒收且图是小图元时才改走 direct。
   · 绘制命令用 -AutoCanvasFromSvg 由脚本建板并画入（见 references/direct-adobe.md §2）。
     两者文字都建成可编辑文本框。
     ⚠️ 海量/超长 path 的图绝不可走 direct——AI 整图导入会崩（RPC 0x800706BE→卡死）。
   · 画入后 agent 在画板内目视微调文字对位，存 out.ai + 导出一次 out.png。
⑧ 完成闸口：核验 out.ai 磁盘真实存在（本次新建）+ out.png 已导出 + 文字可双击编辑，全过才许完成。
   环境确实无法绘制（非 Windows/未装 AI/无法控制本机 AI）且用户知情同意 → 降级交付 .text.svg（§7b）
```

交付：`out.ai`（Illustrator 原生，文字可编辑）+ `out.png`（绘制完成后自动导出一次）。**绘制是主路、写死交付 `.ai`，不以用户是否在场为准。** 仅环境根本做不到且用户知情同意时才交付 `out.svg`，由用户在 AI 里 `文件→打开` 另存 .ai，并如实说明未在 Illustrator 中完成绘制。中间产物 `clean.png`、`base.svg`、`master`、`manifest.json` 一并说明给用户，是否保留由用户定。

## 2. manifest.json：文字清单（agent 视觉识别产出）

### 2.0 记录要求（对齐 cell_su7 口径）

- **记录原图上所有文字型内容**，不仅限"标题/坐标轴文字"：面板字母（panel letter）、图例、坐标轴刻度数字与单位、曲线上标、符号、说明文字都算。逐条保存，别漏也别合并成一块。
- **去字前就把 manifest 存好**（含每块像素级 `source_bbox`、基线 y 等），**不要**从 clean.png 反推位置。
- 保持内容拼写/大小写/换行、位置、旋转、颜色、字族与字号尽量贴近原图。**不确定的文字标注为“待确认”并在校对时问用户，绝不编造**（错字比缺字更难返工）。

### 2.1 推荐格式（schema `"1.0"`，引擎默认按此解析）

顶层字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `schema_version` | 是 | `"1.0"` |
| `source_canvas` | 是 | `{width, height}`：原图像素尺寸。坐标/字号换算的基准 |
| `text_elements[]` | 是 | 每块文字，至少 1 块 |

`text_elements[i]` 字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 唯一 id，且不得与 SVG 内已有元素 id 冲突（引擎会校验） |
| `content` | 是 | 文字内容；`\n` 表示换行（多行输出多个 `<text>`，共用基线锚点与行距） |
| `x` / `y` | 是 | **基线锚点**像素坐标。`y` 是首行基线（SVG `<text>` 的 y 即基线），**不是** bbox 顶 |
| `source_bbox` | 否 | `[left, top, width, height]`（原图像素）。**只作去字/对位的比对参照，不用于自动定位** |
| `coordinate_space` | 否 | `pixels`（默认）/ `normalized`（占整幅画布比例）/ `svg`（已是 SVG 单位）。`normalized` 时 y 仍为基线 |
| `font_size` | 推荐 | 原图像素字号（em）。缺省按 `source_bbox[3]` 高估字（dry-run 会标注"字号由框高估算"） |
| `font_size_space` | 否 | `pixels`（默认）；当 `coordinate_space=normalized` 且此值 `normalized` 时，字号按画布高的比例算 |
| `font_family` | 否 | 建议字体名（优先目标机已装字体，如 `Microsoft YaHei`/`SimHei`/`Arial`） |
| `font_weight` | 否 | `normal` / `bold` |
| `font_style` | 否 | `normal` / `italic` |
| `fill` | 否 | 文字颜色，如 `#2f4a1e`。缺省 `#000000` |
| `text_anchor` | 否 | `start` / `middle` / `end`（x 即该锚点，缺省 `start`） |
| `rotation` | 否 | 绕 (x, y) 基线的旋转角度（度）。cached 绘制引擎能读 transform 旋转 |
| `line_height` | 否 | 多行行距倍数，缺省 1.2 |
| `paint_order` | 否 | 文字之间的叠放顺序（大的在上）。注意：注入器把文字统一插在最上层，见 §9 |
| `dx` / `dy` | 否 | 该块额外平移（原图像素），不改坐标手算即可试偏 |

示例见 `assets/manifest.sample.json`。坐标换算：引擎按 `SVG viewBox尺寸 / source_canvas` 比例把像素换算为 SVG 坐标；`y` 直接用基线，比从 bbox 顶推算更准。

### 2.2 兼容旧格式（`texts[]`）

引擎自动识别：清单含 `schema_version:"1.0"` 且 `text_elements` 数组走新格式；否则按旧格式 `{canvas:{w,h}, texts:[{id,content,bbox:{x,y,w,h},fontSize,fontFamily,fontWeight,fill,align/baseline/glyphRatio/dx/dy,…}]}` 解析。新任务建议用新格式；旧工程清单无需迁移，仍可直接跑。

### 2.3 量得准（决定对位精度的关键，量之前先做）

1. **放大再看**：把原图放大到能看清单字的程度再读数，坐标尽量取整像素（差 1~2px 用 `dx/dy` 收）。
2. **优先量基线**：能看出文字底边（基线）就直接给 `y`（像素），比量顶再由引擎猜字形更准。
3. **`source_bbox` 必须贴墨**：`top` 取第一行大写/升部顶，`height` 取首行顶到末行降部底，`width` 取左右视觉墨边——别把两侧空白算进去（`text_anchor: middle/end` 时尤其影响观感）。
4. **多行**：`content` 用 `\n` 分多行；若没给 `font_size`，引擎按行数分摊 `source_bbox` 高估字，注意 dry-run 标注"(字号由框高估算)"的块是否合理。
5. **`font_size` 给准收益最大**：能推断原图字号就填上，别只靠框高。
6. **旋转/斜体**：有旋转就填 `rotation`；斜体填 `font_style:"italic"`，绘制时 Illustrator 会自动用斜体字。

## 3. 去字：用生成式图像模型语义清除（最关键，必做）

**必做步骤，不得跳过、不得反向索要底图。** 用 agent **自带的生成式图像编辑模型**，对整图执行一次“只删除文字、邻近背景自然补全”的**语义编辑**，输出同尺寸 `clean.png`。

**只许图像模型语义清除；禁止像素级覆盖、蒙版、色块、阈值、克隆、模糊、手绘涂抹、本地描摹等非模型手段。**（对齐 cell-lct `workflow-spec.md` 去字口径）

### 3.1 去字提示词（中英各一，按模型偏好择一；Codex 类图像模型建议优先英文）

- 中文：
  > 只删除图中所有可见文字与文字相关符号（含标注文字、字母、数字、单位、符号、图例文字、坐标轴刻度文字、panel 字母等），并用相邻背景自然补全被删位置。完整保留箭头及箭尾、连接线、框、坐标轴与刻度线、热图、图例色块、图形主体、图标、曲线、纹理、颜色、比例、尺寸、相对位置、层级与整体构图；不得新增、移动、缩放、重绘、改写或美化任何非文字元素。输出必须与原图保持完全相同的画布尺寸与构图。
- English：
  > Remove only the visible text and text-related glyphs (labels, letters, numbers, units, symbols, legend text, axis tick text, panel letters, etc.) and inpaint each removed area using the surrounding background. Preserve everything else exactly: arrows and arrowheads, connectors, frames, axes and tick marks, heatmaps, legend swatches, subject artwork, icons, curves, textures, colors, proportions, dimensions, relative positions, layering, and overall layout. Do not add, move, scale, redraw, rewrite, or beautify any non-text element. Output must keep the exact same canvas size and composition as the input.
- 可选负向提示（模型支持时）：新增文字或伪文字、重绘图形、改变布局、改变画布尺寸、模糊、色块伪影

### 3.2 操作口径

1. **以原图为参照**，单独产出 `clean.png`，不要在原图上直接改。
2. **箭头、箭尾、连接线、框、坐标轴、热图、图例色块、图形主体、布局必须保留**，即使紧挨文字也不得删除或挪动。
3. **模型处理 ≠ 保真**：清除后把 clean.png 与原图**整体目视对比**，必要时放大文字区复查——查残留字形、图形是否被改、连接线/箭头是否断、画布/对齐有无漂移。

### 3.3 红线（硬门禁，违反即停）

1. **去干净是转矢量的前置条件。** `clean.png` 未通过“**无文字残留**”校验之前，**禁止执行 `convert`（转矢量）**。
2. **校验方法**：原图与 `clean.png` 整体目视对比，并**逐条核对 manifest 里每一块文字是否都已消失**；出现任何残留字形、伪字、糊字即判**不合格**。
3. **不合格只有两条出路**：① 换更强图像模型 / 提高分辨率重清；② 请用户提供**无字底图**（以用户图当 `clean.png`）。**不接受“带瑕疵继续转换”，不得静默跳过。**
4. **必须保持与去字前同尺寸、同构图**：禁止整图重画、禁止改画布大小/比例、禁止移动或美化非文字元素。
5. **禁止**用像素级覆盖、蒙版、色块、克隆、模糊、手绘涂抹等非模型手段“补”去字效果。

### 3.4 用户闸口

校验通过后，**第 ④ 步把 clean.png 给用户过目**，确认去字干净且构图未变，**才可进入第 ⑤ 步转矢量**。去字效果不足时如实告知用户，不得自行放行。

## 4. 转换：nature-vect convert

```bash
node <skill目录>/scripts/nature-vect.js convert clean.png -o base.svg
```

默认参数即可（Adobe 兼容 + 填充 + 不分组）。产物不应含文字字形（去字成功的前提）。

## 5. 注入文字：nature-vect text-inject（双 schema 自动识别）

**先 dry-run 核对推算明细**（每块打印 kind/字号/首行基线/行距/是否估字号，新格式还会打印 `anchor/rot/space`，并给出将插入的 XML）：

```bash
node <skill目录>/scripts/nature-vect.js text-inject base.svg manifest.json --dry-run
```

明细合理后再真正写入：

```bash
node <skill目录>/scripts/nature-vect.js text-inject base.svg manifest.json -o out.svg
```

对位模型（新格式）：`x/y` 直接作为 text-anchor 锚点与首行基线；`font_size` 缺省按行数分摊 `source_bbox` 高估字并在 dry-run 标注。`rotation` 会写成 `<g transform="rotate(deg x y)">`。`id` 唯一性与 SVG 冲突会在注入时报错。

对位不理想时的修正顺序（不用回改坐标手算，能原地快速迭代）：

| 现象 | 修法 |
|---|---|
| 单块整体偏上/下/左/右 | 清单该块加 `dx/dy`（或直接改 `y` 基线 / `x` 锚点）重跑 |
| 所有文字同方向同量偏移 | 加 `--shift dx,dy`（SVG 坐标单位，如 `--shift 0,3`） |
| 全部文字字号统一偏大/偏小 | 加 `--size 0.95` 或 `1.05` |
| 整体坐标+字号按同比例不对 | 加 `--scale 1.02`（等比缩放，画布原点为基准） |
| 引擎等比收缩过、aspect 失配 | 换 `--fit uniform` 再跑 |

先小步试（如 1px 一档），dry-run 看明细 → 注入 → validate，闭环两三次即可对齐。

## 6. 结构自检

```bash
node <skill目录>/scripts/nature-vect.js validate out.svg
```

应看到 `"textNodes": N`（N≥1，按 `<text>` 节点计，多行=多节点）。若 textNodes 为 0，说明注入失败，检查上一步报错。

## 7. 在 Illustrator 中绘制并交付（必须走；agent 自动完成，见 SKILL 第 8 步）

### 7a. 主路：agent 自动打开 Illustrator、新建等大画板并绘制

1. **前置已通过（SKILL 第 0 步）**：Windows + AI 2019+ + 可控制本机。此环节无需用户打开 AI。
2. 按 `references/direct-adobe.md` §2 用 **`-AutoCanvasFromSvg`** 让脚本自动启动 Illustrator（未运行则 COM 自启）并**新建与 Master SVG 等大的 RGB 画板**（宽高 = SVG viewBox，1px=1pt，内容 1:1 落位）为活动文档，随后绘制：**默认 cached**（`prep-replay-cache.py` + `run_nv_replay.ps1`，可断点续跑，图越大越必须 cached）；仅当 cached 被 prep 拒收且图是**小图元**时才改 direct（`run_nv_direct.ps1`）。海量/超长 path 绝不可走 direct。两种引擎都把文字建成可编辑文本框。
3. 画入后 **agent 在画板内目视微调文字对位**（直接拖动文字框/调字号），确认 `out.ai` 已保存、`out.png` 已导出一次。
4. **完成闸口（全过才可宣布完成）**：核验 `out.ai` 磁盘真实存在且为本次新建（看文件时间/大小，非旧文件残留）、`out.png` 已导出、文字点选为文本对象可双击编辑。缺任一项 → 修正或如实说明未完成。
5. 全部通过后交付 `out.ai`，提示“文字在 Illustrator 中双击即可改字”。

### 7b. 环境无法绘制时的降级：仅用户知情同意才交付 out.svg（或代存 .ai）

仅当**环境根本做不到**（本机不是 Windows / 未装 Illustrator / agent 无本机 GUI/COM 控制能力）且已**向用户说明原因并取得知情同意**后，才按以下降级：
- 交付 `out.svg`（含可编辑 `<text>`），请用户在 AI 里 `文件→打开`（Ctrl+O）选 out.svg → `文件→另存为`（Ctrl+Shift+S）→ 类型选「Illustrator (*.AI)」→ 保存。打开若出现「导入 SVG」对话框：保持默认确定。
- 用户同意代存时：用 `scripts/ai-export.jsx`（把顶部 `SVG_PATH`/`OUT_PATH` 改成实际路径后拖入 AI 或 `文件→脚本→其他脚本` 运行）；jsx 失败则用 computer-use 按上面菜单手动另存。
- **降级必须明示**：向用户说明「未在本机 Illustrator 中完成绘制，SVG 只是含可编辑文字的中转文件」。用户没应答 / 会话非交互 **不是**降级理由——绘制不依赖用户在场。

### 验证（交付前做一次）

- 用选择工具点选一处文字：属性应显示为**文字/文本对象**（不是路径），说明文字可编辑。
- 双击文字能进入文字编辑状态、能改内容换字体——可向用户汇报「已可编辑」。若点选后是路径锚点而不是文本框，说明导入没识别成文字，回到第 5 步检查 base.svg 是否被 convert 后又处理过、或直接重跑 text-inject。
- `out.ai` 在磁盘存在且为本次绘制新生成（这是「完成」的必要条件，`validate` 通过不代表完成）。

## 8. 双轨 agent 差异

| 环节 | 具备 Windows+AI+GUI/COM 的 agent（Codex / 豆包桌面端等） | 无本机 GUI 控制的纯脚本 agent |
|---|---|---|
| ① 视觉识别 | ✅ 自带视觉读图 | ❌ → 走基础模式 |
| ③ 去字 | 必须用生成式图像模型语义清除（禁像素级覆盖/局部涂抹）；无模型则**停**并说明 | ❌ |
| ⑦⑧ 自动开 AI + 等大画板绘制，交付 .ai | ✅ `-AutoCanvasFromSvg` 自启 AI、建等大画板并绘制，交付 out.ai；绘制不依赖用户在场 | ❌ 只能交付 `.text.svg` 兜底，且须先向用户说明原因并取得知情同意，并如实说明未完成绘制 |

任何 agent 做不了的一步：**不要假装做了**。把已完成的中间产物与下一步该由谁做讲清楚。绘制不可行时，纯脚本 agent 只能交付 `.text.svg`（用户知情同意后），让用户自己在 AI 里打开另存，且必须如实说明未在 Illustrator 中绘制。

## 9. 已知限制（如实告知用户）

- **对位是近似**：引擎按 `viewBox/source_canvas` 比例换算；`y` 给基线可把纵向误差收到很小，横向按锚点即可。极端构图（引擎非等比收缩、去字后内容大幅裁剪、替换字体字宽不同）仍可能偏位。manifest 给准 `y`/`x` + 实测 `dx/dy`/`--shift` 可把误差收敛到可视一致。
- **字体**：目标机缺 manifest 里的字体时，AI 会自动替换（打开时或保存时提示）；替换字体的字宽/基线差异会导致居中与纵向偏差。校对时优先选目标机已装字体可减少替换。
- **旋转**：`rotation` 写成 SVG `transform`，cached 绘制引擎（`prep-replay-cache.py`）已解析 transform 旋转并在 AI 内建旋转文本；direct 或绘制不可行的兜底路径请目视复核一次。
- **叠放**：`paint_order` 只决定**文字彼此之间**的顺序；注入器把全部文字插在几何之上（恒置顶）。若个别标签需要压在图形中间，到 AI 里手动调整图层/叠放即可。
- **坐标空间**：`normalized` 按整幅画布算，假设 SVG viewBox 原点为 0；带非零原点 viewBox 的 SVG 以 `pixels`/`svg` 空间更稳。
- **多行/复杂排版**：`<text>` 表达简单多行尚可；精确行距、字距、沿路径、艺术字变形建议在 AI 里手动精调。
- **去字瑕疵**：复杂背景留痕会让对应矢量区域带色块——**这是转矢量前的硬门禁**（§3.3），未清干净不得进入 `convert`。
- **.ai 版本**：ai-export.jsx 存为当前 AI 版本格式。发给他人前可 `另存为` 降版本。

## 10. 失败兜底

| 现象 | 处理 |
|---|---|
| 用户视觉识别结果明显读错 | 停下重新校对 manifest，不要带错进行 |
| 去字后仍有文字残留/伪字 | **禁止转矢量**（§3.3 硬门禁）：换更强图像模型重清，或请用户提供无字底图 |
| 去字后构图/尺寸变了 | 不用该 clean 图；重新去字或找用户要无字版 |
| 新格式缺 `source_canvas` / 缺 `x,y` / id 重复或与 SVG 冲突 / 字段类型错 | 按报错补正后重跑（引擎已给出中文错误与下标） |
| text-inject 报 viewBox/source_canvas 缺 | manifest 补 `source_canvas{width,height}`；SVG 确认来自 convert |
| dry-run 明细里估字号块字号离谱/坐标跳变 | 回查该块 `source_bbox` 是否贴墨、是否漏了 `font_size`/`y` |
| 单块位置偏 | 清单该块加 `dx/dy` 或直接改 `y`/`x`（勿手算整套坐标） |
| 所有文字同向同量偏 | `--shift dx,dy` 重跑 |
| 整体字号统一偏大/偏小 | `--size <倍数>` 重跑 |
| AI 打开文字不可编辑（是路径） | 确认 out.svg 由 text-inject 生成；重跑第 5~6 步 |
| cached 预解析拒收（gradient/clip/use/CMYK 等） | 先确认**小图元**再改走 direct 引擎（见 direct-adobe.md §2b/§6）；大图拒收应重生成可被 prep 接受的 master |
| **direct 一跑 AI 崩/卡死（0x800706BE）** | 图太大（海量/超长 path 整图导入压垮 AI）→ 该图走 cached；手动重启 AI |
| direct 引擎报 clipped group / 不支持类型 | 回退 AI 直接打开 master.svg，文字用文字工具逐块补 |
| jsx 弹保存选项错误 | 删掉脚本里 IllustratorSaveOptions 段落或改用 7b |
| 任何不确定 | 停止，把当前产物路径与问题如实告诉用户 |
