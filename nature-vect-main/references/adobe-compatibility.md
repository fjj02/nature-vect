# adobe-compatibility.md —— Illustrator 2019–2026 兼容清单

目标：让 nature-vect 产出的 SVG 能在 Adobe Illustrator 2019 至 2026 各版本直接打开、可编辑、不串样式。

## 脚本已内置的保证

convert 默认开启：
- `adobeCompatibilityMode: true`（顶层）
- `svgOptions.adobeCompatibilityMode: true`
- `shapeStacking: "cutouts"`（避免复杂的布尔运算形状）
- `svgOptions.fixedSized: false`（画布随内容自适应，AI 打开不出现多余裁切框）

因此直接 convert 的产物已是 SVG 1.1 + 内联样式 + XML DOCTYPE，Illustrator 全系可读。不要在这些默认值上随意改动。

## 如果仍然要做二次修改，遵守以下规则

### 必须避免（AI 可能解析失败或表现异常）
- 依赖外部 CSS 文件、`<style>` 里的 `@import`、远程字体。
- CSS 属性只写在 `<style>` 而非元素属性上（AI 能读一部分，但内联属性最稳）。
- SVG 2 语法：`<filter>` 的新写法、`inset` 简写等。
- `currentColor`、`vector-effect: non-scaling-stroke` 以外的 CSS 变体关键字堆叠。
- 极多 `<use>` 深链、`<symbol>` 跨文档引用。
- 超长单路径（几十万字符）建议交给转换引擎处理，不要手改。

### 推荐写法（AI 可编辑）
- 形状一律用 `<path>` / `<rect>` / `<ellipse>`，属性写死（`fill`、`stroke`、`stroke-width` 直接放元素上）。
- 分组用 `<g>`，组内放 `fill` 等统一属性，AI 可整体选中。
- 文字：基础模式产物中的文字为字形路径，作为普通图形处理即可；文字模式下 text-inject 注入的是点文字 `<text>`（属性内联），AI 导入即为可编辑文本对象。
- 单位统一用不带前缀的数字（用户单位）或显式 `px`；避免 `em`、`pt` 混用造成 AI 缩放换算差异。

## 打开后若发现问题（排查顺序）

1. 先确认 convert 时没加 `--no-adobe-compat`。
2. 检查 SVG 是否含 `<style>`/`<defs>` 外部引用，全部内联化。
3. 用 `validate` 确认结构无缺标签。
4. 仍异常：把出问题的元素单独复制出来对比，通常是该元素属性用了 AI 不认识的写法。

## 版本差异提示

- AI 2019–2022 对 SVG 的导入接近“照单全收”，个别高级滤镜效果会以位图栅格化——可接受。
- 2023+ 对 CSS 变量、渐变写法更宽容，但为保证全系一致，仍按上面的“内联化”标准输出。
- 最终验收：拿一份 sample.svg 在不同 AI 版本各打开一次，确认无报错、可选中编辑即可。
