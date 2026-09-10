# nature-vect

把位图（PNG / JPG / WebP…）转成**可在 Adobe Illustrator 2019–2026 中打开并编辑**的 SVG 矢量图。以 Agent Skill 形式分发，兼容豆包 / Codex /等多款 AI agent（基于 Agent Skills 开放标准，SKILL.md）。

支持两种模式：
- **基础模式**：位图 → 可编辑矢量 SVG（图中文字作为字形路径保留外观，不能直接改字）。
- **文字模式**：位图里的文字可变成 Illustrator 里的**可编辑文本对象**——先由 agent 清掉位图文字再转矢量，随后把文字以可编辑 `<text>` 注入 SVG 成 Master，再请用户打开 Adobe Illustrator，由 agent 在打开的文档中**绘制**（图形原生画入画板、文字建成可双击改字的文本框），最后交付 `.ai` + `.png`。
- **额度查询**：向agent输入额度查询即可查询当前api key的额度

> nature-vect 是独立于 BioSketch 的矢量转换能力包。本仓库 **不包含任何服务方 API key**，key 由用户自行购买与配置。文字模式的“去字”由 agent 自带视觉与图像能力完成，**同样不引入额外 key**。

## 它做什么

- 图片 → 可编辑矢量 SVG（默认开启 Adobe 兼容模式）
- 支持预设与高级参数（描边 / 分组 / 叠放…）
- **文字模式**：agent 视觉识别文字 → 校对 → 清字 → 转矢量 → 注入可编辑 `<text>`（Master SVG）→ **在 Illustrator 中绘制**（双引擎：cached 逐批画 / direct AI 自导入），文字为可编辑文本框，全程 agent 自动完成
- 若你使用的 agent 具备 computer-use：可控制本机 Illustrator 完成绘制 / 验证（见 `references/direct-adobe.md` 与 `references/illustrator-computer-use.md`）

范围说明：
- 基础模式产物中，原图文字按矢量路径保留（外观 80% 保真，但当图形处理）。
- 文字模式产物中，文字是真正的文本对象（.ai / SVG 打开可编辑改字）；复杂排版（多行行距、艺术字变形等）以 AI 内微调收尾。

## 快速开始

### 1. 安装

本 skill 是一个标准 Agent Skills 包。把整个仓库目录放到你所用 agent 的 skills 目录下即可（目录名保持 `nature-vect`）。

| agent | 个人级（所有项目可用） | 项目级（当前项目可用） | 状态 |
|---|---|---|---|
| Codex / ChatGPT | 见 OpenAI Codex 官方 skills 文档 | — | 采用 Agent Skills |
| 豆包 | 按豆包官方技能导入方式 | — | 采用 Agent Skills |
| workbuddy | 按其官方文档 | — | 未逐版本核实* |

\* 标注“未逐版本核实”的 agent：本仓库按 Agent Skills 标准封装，若该产品不支持标准导入，最稳妥的兜底是把仓库放进任意项目目录，再用其“添加目录 / 加载文件”能力（如 opencode/Claude Code 的 `--add-dir`、`/add-dir`）指向该目录，并让 agent 读取 `SKILL.md`。以你所用产品的最新官方文档为准。

Windows 用户若用 Git Bash：`mkdir -p ~/.claude/skills` 后把仓库 `nature-vect/` 目录复制进去即可。

### 2. 配置 API key（需先购买）

key 是独立商业授权，请通过卖家渠道获取（**购买方式见下方[获取 key]**）。

打开你安装好本 skill 的 agent，对它说：

> 用 nature-vect 把 `<图片路径>` 转成矢量。API key 是 `<你的 key>`

agent 会自动执行 `init` 把 key 写入用户级配置（`~/.nature-vect/config.json`），**不会进入仓库文件**。

也可以自己手动配置：

```bash
node scripts/nature-vect.js init <KEY>     # 或 export NATURE_VECT_API_KEY=<KEY>
node scripts/nature-vect.js check
```

### 3. 使用

在 agent 里一句话即可：

> 把 `xxx.png` 用 nature-vect 转成矢量，存到 `E:\out\xxx.svg`

首次会话 agent 会先与你**确认保存路径**，之后在对话里告诉你产物位置。

需要**文字可编辑 / .ai 文件**时，告诉 agent：

> 把 `xxx.png` 转矢量，图里的文字要能在 Illustrator 里改，最后给我 .ai

agent 会进入文字模式（先通读 `references/text-workflow.md` 与 `references/direct-adobe.md`），按“识别文字→与你校对→清字→转矢量→注入可编辑文字→请你打开 Illustrator 后在软件中绘制”自动执行：请在 Adobe Illustrator 中新建与图片等大的画板并告知，agent 会把图形+文字绘制为原生对象并交付 `.ai` + `.png`；无法在本机绘制时如实说明并交付 `.text.svg` 由你在 AI 里另存。

命令行直接跑：

```bash
node scripts/nature-vect.js convert 输入.png -o 输出.svg            # 基础模式（默认 Adobe 兼容）
node scripts/nature-vect.js text-inject base.svg manifest.json -o master.svg   # 文字模式：注入可编辑文字生成 Master
node scripts/nature-vect.js validate out.svg                        # 结构自检
node scripts/nature-vect.js -h                                       # 全部参数
```

`text-inject` 与文字模式完整用法（manifest 字段、去字红线、在 Illustrator 中绘制）见 [`references/text-workflow.md`](references/text-workflow.md) 与 [`references/direct-adobe.md`](references/direct-adobe.md)。

## 参数与预设

常用预设：`default`（推荐）/ `grouped` / `lineart` / `edges`。全部参数、底层字段与改法见 [`references/presets.md`](references/presets.md)。高级参数也可以直接让 agent 帮你调。

## 兼容性与 Illustrator 展示

- Illustrator 兼容细节与注意事项：`references/adobe-compatibility.md`
- 文字模式完整手册（识别 / 校对 / 去字 / 注入 / 在 Illustrator 中绘制 / 双轨差异）：`references/text-workflow.md`
- 在 Illustrator 中绘制手册（cached/direct 双引擎命令、文字支持对照、兜底）：`references/direct-adobe.md`
- 用 computer-use 在 Illustrator 中打开/展示 SVG 的手册（中英菜单、Codex / 豆包差异与兜底）：`references/illustrator-computer-use.md`

## 目录结构

```
nature-vect/
├─ SKILL.md                     # Agent Skills 元数据 + 主工作流（agent 读它，含基础/文字两模式）
├─ scripts/nature-vect.js       # 引擎：init / check / convert / text-inject / validate（Node>=18，零依赖）
├─ scripts/ai-export.jsx        # 无 GUI 兜底：在 Illustrator 里把 SVG 另存为 .ai
├─ scripts/prep-replay-cache.py # cached 绘制引擎：解析 Master SVG 出几何/批次缓存（python3+fontTools）
├─ scripts/run_nv_replay.ps1    # cached 绘制引擎编排器（Windows COM，逐批画入 AI，断点续跑）
├─ scripts/illustrator-replay-runtime.jsx  # cached 路 AI 内运行时（draw/save/export，文字建 live TextFrame）
├─ scripts/run_nv_direct.ps1    # direct 绘制引擎编排器（Illustrator 自己导入 SVG 重画，一次完成）
├─ scripts/illustrator-direct-runtime.jsx  # direct 路 AI 内运行时（NoUI 导入采样 Path/Compound/TextFrame 并原生重画）
├─ references/                  # presets / text-workflow / direct-adobe / adobe-compatibility / illustrator-computer-use
├─ assets/                      # 示例图片、示例清单 manifest.sample.json、示例输出 sample.svg / sample.text.svg
├─ README.md
└─ LICENSE
```

运行要求：能执行 Node.js（>=18）的机器即可，无需 npm install（零第三方依赖）。导出 `.ai` 需目标机装有 Illustrator；在 Illustrator 中绘制需 Windows + Illustrator 2019+（cached 路另需 python3 + fontTools）。

## 如何获取 key

**处于刚发布阶段，每人加入skills交流群即可领取   免费测试额度，1额度=1张图**
<div align="center">
  <img src="assets/team.png" width="200">
</div>

## 免责声明

- 文字模式的“清字 / 识别”由运行本 skill 的 agent 自带能力完成，质量与可用性取决于该 agent 客户端，本仓库不保证任何特定客户端可用。
- “computer-use 自动打开 Illustrator / 导出 .ai”依赖你所用的 agent 产品具备 GUI 控制能力，本仓库只提供操作指引（脚本与手册），不保证任何特定客户端可用。
- 示例图片 `assets/sample.*` 仅为演示用，发布前可替换为你自己的素材。

## License

MIT，见 [LICENSE](LICENSE)。
