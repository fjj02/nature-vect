# presets.md —— 转换参数与预设

本文件说明 `nature-vect.js convert` 支持的参数。默认值等价于「Adobe 兼容 + 填充 + 不分组」的稳妥配置；高级参数按需打开，避免误伤输出质量。

> 转换产出的是 **Adobe 兼容 SVG**（中间/可交付产物）。基础模式与文字模式默认都会在本机 Illustrator 中把它重绘为原生 `.ai` 交付（见 `SKILL.md` 基础模式第 8 步 / 文字模式第 8 步，命令见 `direct-adobe.md`）；只有用户点名“只要 SVG”或本机确实无 AI（降级）时才把 `.svg` 作为最终交付。

## 预设（--preset）

| 预设 | 底层等效 | 适用 |
|---|---|---|
| `default` | 填充模式、不分组、Adobe 兼容 | 通用首选；还原度最高 |
| `grouped` | 填充模式 + `groupBy=color` | 多色插画/图标，方便在 AI 里按颜色管理 |
| `lineart` | 描边模式，覆盖色 #000000、宽 1、非缩放 | 单色线稿/漫画线 |
| `edges` | 描边边缘模式，同上描边参数 | 只要轮廓，不要内部填充色 |

## CLI 参数（可在预设基础上叠加覆盖）

| 参数 | 说明 | 默认 |
|---|---|---|
| `--draw-style fill\|stroke\|strokeEdges` | 绘制风格：填充 / 描边 / 描边边缘 | `fill` |
| `--group-by color\|parent\|layer` | 分组方式：按颜色 / 按父级 / 按图层；不传 = 不分组 | 不分组 |
| `--stroke-color #hex` | 描边/描边边缘的覆盖颜色 | `#000000` |
| `--stroke-width <n>` | 描边宽度（用户单位） | `1` |
| `--no-non-scaling` | 关闭“非缩放描边”（默认开启） | 开启 |
| `--no-adobe-compat` | 关闭 Adobe 兼容（默认开启，建议保持） | 开启 |
| `--extra '<json>'` | 追加任意底层参数，与原默认做浅合并 | 无 |

## 底层参数说明（--extra 可写；一般不用）

转换服务实际接收一个 JSON 配置。convert 脚本默认构造：

```json
{
  "adobeCompatibilityMode": true,
  "drawStyle": "fill",
  "shapeStacking": "cutouts",
  "svgOptions": {
    "fixedSized": false,
    "adobeCompatibilityMode": true
  }
}
```

常用可改项：
- `groupBy`：`""`（不分组）/ `"color"` / `"parent"` / `"layer"`。
- `drawStyle`：`"fill"` / `"stroke"` / `"strokeEdges"`。
- `strokeStyle`（当 drawStyle 不是 fill 时生效）：
  - `useOverrideColor`：是否使用统一覆盖色（布尔）
  - `overrideColor`：覆盖色，如 `"#000000"`
  - `strokeWidth`：描边宽度，如 `1`
  - `nonScalingStroke`：非缩放描边（布尔）
- `svgOptions`：`fixedSized`（是否固定画布尺寸）、`adobeCompatibilityMode`（Adobe 兼容）。
- `shapeStacking`：默认 `"cutouts"`（剪切式叠放）。

改法示例（把“描边边缘 + 2px 蓝色描边 + 按父级分组”透传进去）：

```bash
node scripts/nature-vect.js convert in.png -o out.svg \
  --draw-style strokeEdges --group-by parent \
  --stroke-color '#0055ff' --stroke-width 2
```

或直接用 `--extra`：

```bash
node scripts/nature-vect.js convert in.png -o out.svg \
  --extra '{"groupBy":"layer","svgOptions":{"fixedSized":true,"adobeCompatibilityMode":true}}'
```

## 行为约定

- 命令行参数 > 预设 > 脚本内置默认；`--extra` 最后浅合并、优先级最高。
- `drawStyle=fill` 时描边相关字段会被忽略（与 BioSketch 前端一致），想描边请用 `stroke` / `strokeEdges`。
- 不知道改什么参数时，保持默认即可；过度调参可能让简单图复杂化、复杂图劣化。
