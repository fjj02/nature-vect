#!/usr/bin/env node
// nature-vect —— 图片转 SVG 矢量 + 可编辑文字注入（Node.js >= 18 零依赖 CLI）
// License: MIT. 详见项目 README。API key 仅存于用户级配置，不写入本仓库。

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '1.4.0';
const ENDPOINT = 'https://vectorizer-api.etoolbox.cn/v1/vectorize';
const CREDIT_ENDPOINT = 'https://vectorizer-api.etoolbox.cn/v1/credit';
const CONFIG_DIR = path.join(os.homedir(), '.nature-vect');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_TIMEOUT_MS = 300000;

const HELP = `nature-vect ${VERSION} —— 图片转 SVG 矢量（兼容 Adobe Illustrator 2019-2026）+ 可编辑文字注入

用法:
  node nature-vect.js init [KEY]            首次写入 API key（用户级配置，不入库）
  node nature-vect.js check                 校验 key 配置与网络连通性
  node nature-vect.js convert <图片> -o <svg> [选项]   转换图片为 SVG
  node nature-vect.js text-inject <svg> <manifest.json> [-o <out.svg>]   把文字清单注入为可编辑 <text>（自动识别旧 texts[] 或新 schema_version 1.0 / text_elements）
  node nature-vect.js validate <svg>        输出文件结构自检
  node nature-vect.js credit                查询剩余额度（key 读配置/环境变量/--key）

key 读取优先级: --key 参数 > 环境变量 NATURE_VECT_API_KEY > 配置文件(config.json)
key 绝不回显、绝不写入任何项目/仓库文件。

convert 选项:
  -o, --output <路径>     输出 .svg 路径（父目录自动创建）
  -p, --preset <名称>     预设: default|grouped|lineart|edges
  --draw-style <值>       fill(填充)|stroke(描边)|strokeEdges(描边边缘)
  --group-by <值>         color|parent|layer（不填=不分组）
  --stroke-color <#hex>   描边覆盖色（默认 #000000）
  --stroke-width <数字>    描边宽度（默认 1）
  --no-non-scaling        关闭非缩放描边
  --no-adobe-compat       关闭 Adobe 兼容模式（默认开启）
  --extra '<json>'        追加任意底层参数（与原默认值做浅合并）
  --key <KEY>             临时指定 key（仅本次运行，不落盘）
  --timeout <毫秒>         请求超时（默认 300000）

预设说明（详细见 references/presets.md）:
  default  填充、不分组、Adobe 兼容（等价 BioSketch 前端默认）
  grouped  填充 + 按颜色分组（多色插画）
  lineart  纯描边线稿（覆盖色 #000，宽 1，非缩放）
  edges    仅描边边缘轮廓

text-inject 选项:
  <svg>            基础矢量 SVG（建议来自 convert，且其中不含文字）
  <manifest.json>  文字清单（字段见 references/text-workflow.md；旧 texts[] 与新 text_elements 均支持）
  -o, --output     输出路径（默认 <svg 同名>.text.svg）
  --fit stretch|uniform  坐标缩放模式: stretch 按 viewBox 与画布各自比例(默认);
                     uniform 等比缩放(取 min 比例, 适用于引擎等比收缩场景)
  --shift <dx,dy>  整体平移全部文字（SVG 坐标单位，如 --shift 0,3.5 或 -2,-1）
  --size <倍数>     仅整体缩放文字字号（如 0.95 缩小 5%），位置锚点不变
  --scale <倍数>    整体等比缩放文字几何(坐标+字号, 以画布原点为基准)，如 1.02
  --dry-run        只打印将插入的 XML 与每块推算明细，不写文件

退出码:
  0 成功  1 用法/配置错误  2 上游服务返回错误(4xx/5xx)  3 网络/超时  4 本地文件错误
`;

function mask(key) {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(Math.min(8, key.length - 8)) + key.slice(-4);
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

function fail(code, msg) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeConfig(obj) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), 'utf8');
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {}
}

function resolveKey(cliKey) {
  const envKey = process.env.NATURE_VECT_API_KEY;
  const fileKey = (readConfig() || {}).apiKey;
  return cliKey || envKey || fileKey || '';
}

function isPlaceholder(key) {
  const v = String(key || '').trim().toLowerCase();
  return !v || /^(your|xxx|replace|changeme|placeholder|demo)/.test(v);
}

// ---------- init ----------
function cmdInit(key) {
  if (!key || isPlaceholder(key)) {
    fail(1, '缺少有效 key。用法: node nature-vect.js init <KEY>（或设置环境变量 NATURE_VECT_API_KEY）。');
  }
  const cur = readConfig();
  const next = Object.assign({}, cur, { apiKey: String(key).trim() });
  writeConfig(next);
  log(`已写入用户级配置: ${CONFIG_PATH}`);
  log(`key 掩码: ${mask(next.apiKey)}（绝不入库，请注意保管）`);
}

// ---------- check ----------
async function cmdCheck() {
  const cfg = readConfig();
  const hasEnv = Boolean(process.env.NATURE_VECT_API_KEY);
  const fileKey = cfg.apiKey;
  log(`配置文件: ${CONFIG_PATH}`);
  log(`配置文件 key: ${fileKey ? mask(fileKey) : '（未配置）'}`);
  log(`环境变量 key: ${hasEnv ? mask(process.env.NATURE_VECT_API_KEY) : '（未配置）'}`);
  log(`Node 版本: ${process.version}`);

  const key = resolveKey(null);
  if (!key) {
    log('校验结果: 未找到 key。请先运行 init 或设置 NATURE_VECT_API_KEY。');
    return;
  }
  if (isPlaceholder(key)) {
    log('校验结果: 当前 key 疑似占位符，请确认已填入真实 key。');
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(ENDPOINT, { method: 'GET', signal: ctrl.signal });
    clearTimeout(timer);
    log(`服务可达: 转换服务返回 HTTP ${res.status}（GET 非业务调用，仅验证连通）`);
    log('校验结果: key 已配置、服务可达。可开始 convert。');
  } catch (e) {
    clearTimeout(timer);
    fail(3, `网络连通性检查失败: ${e && e.message ? e.message : e}`);
  }
}

// ---------- credit ----------
async function cmdCredit(cliKey) {
  const key = resolveKey(cliKey);
  if (!key) fail(1, '未找到 API key。先运行 init，或设置 NATURE_VECT_API_KEY，或用 --key 临时传入。');
  if (isPlaceholder(key)) fail(1, '当前 key 疑似占位符，请先通过 init 写入真实 key。');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(CREDIT_ENDPOINT, {
      method: 'GET',
      headers: { 'x-api-key': key },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (res.status === 200 || res.status === 201) {
      let json;
      try {
        json = await res.json();
      } catch {
        fail(2, '上游返回非 JSON 响应: ' + (await res.text()).slice(0, 200));
      }
      const remaining = json && (json.remaining ?? json.credit ?? json.credits ?? json.quota);
      if (remaining === undefined || remaining === null) {
        log(JSON.stringify({ ok: true, remaining: null, raw: json }));
        log('响应中未解析到额度字段，请查看上方原始返回。');
        return;
      }
      log(JSON.stringify({ ok: true, remaining }));
      log(`剩余额度：${remaining} 次（1 次 ≈ 1 张图）`);
      return;
    }

    if (res.status === 401 || res.status === 403) fail(2, 'key 无效或无权限（HTTP ' + res.status + '），请确认已用 init 写入正确的 key。');
    if (res.status === 402) fail(2, '积分不足（HTTP 402），请充值后重试。');
    if (res.status === 429) fail(2, '请求过于频繁（HTTP 429），请稍后再试。');

    const body = (await res.text()).slice(0, 500);
    fail(2, `上游返回 HTTP ${res.status}: ${body}`);
  } catch (e) {
    clearTimeout(timer);
    const msg = e && e.message ? e.message : String(e);
    if (e && e.name === 'AbortError') fail(3, '请求超时（>15s），请稍后重试或检查网络。');
    fail(3, `网络请求失败: ${msg}`);
  }
}

// ---------- preset / option -> config ----------
const PRESETS = {
  default: {},
  grouped: { drawStyle: 'fill', groupBy: 'color' },
  lineart: {
    drawStyle: 'stroke',
    strokeStyle: { useOverrideColor: true, overrideColor: '#000000', strokeWidth: 1, nonScalingStroke: true },
  },
  edges: {
    drawStyle: 'strokeEdges',
    strokeStyle: { useOverrideColor: true, overrideColor: '#000000', strokeWidth: 1, nonScalingStroke: true },
  },
};

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff' };
  return map[ext] || 'image/png';
}

function buildConfig(opts) {
  const presetName = opts.preset || 'default';
  const preset = PRESETS[presetName];
  if (!preset) fail(1, `未知预设: ${presetName}（可选: ${Object.keys(PRESETS).join(' | ')}）`);

  const adobe = opts.adobeCompat !== false;
  const cfg = {
    adobeCompatibilityMode: adobe,
    groupBy: opts.groupBy || undefined,
    drawStyle: opts.drawStyle || preset.drawStyle || 'fill',
    shapeStacking: 'cutouts',
    svgOptions: { fixedSized: false, adobeCompatibilityMode: adobe },
  };

  let strokeBase = preset.strokeStyle
    ? Object.assign({}, preset.strokeStyle)
    : { useOverrideColor: true, overrideColor: '#000000', strokeWidth: 1, nonScalingStroke: true };

  if (opts.strokeColor !== undefined) strokeBase.overrideColor = opts.strokeColor;
  if (opts.strokeWidth !== undefined) strokeBase.strokeWidth = opts.strokeWidth;
  if (opts.nonScaling === false) strokeBase.nonScalingStroke = false;

  if (cfg.drawStyle !== 'fill') {
    cfg.strokeStyle = strokeBase;
    cfg.strokeStyle.useOverrideColor = true;
  } else {
    delete cfg.strokeStyle;
  }

  if (opts.extra) {
    let extra;
    try {
      extra = JSON.parse(opts.extra);
    } catch {
      fail(1, `--extra 不是合法 JSON: ${opts.extra}`);
    }
    Object.assign(cfg, extra);
  }

  for (const k of Object.keys(cfg)) {
    if (cfg[k] === undefined) delete cfg[k];
  }
  return cfg;
}

// ---------- convert ----------
async function cmdConvert(imagePath, opts) {
  const key = resolveKey(opts.key);
  if (!key) fail(1, '未找到 API key。先运行 init，或设置 NATURE_VECT_API_KEY，或用 --key 临时传入。');
  if (isPlaceholder(key)) fail(1, '当前 key 疑似占位符，请先通过 init 写入真实 key。');

  let imageData;
  try {
    imageData = fs.readFileSync(imagePath);
  } catch (e) {
    fail(4, `无法读取图片: ${imagePath}（${e && e.message ? e.message : e}）`);
  }
  if (!imageData || imageData.length === 0) fail(4, '图片文件为空。');

  let outPath = opts.output;
  if (!outPath) {
    const cfg = readConfig();
    const dir = cfg.outputDir;
    if (dir) outPath = path.join(dir, path.basename(imagePath, path.extname(imagePath)) + '.svg');
  }
  if (!outPath) fail(1, '缺少输出路径，请用 -o <路径> 指定生成的 SVG 保存位置（首次使用请与用户确认路径）。');
  if (!/\.svg$/i.test(outPath)) fail(1, '输出路径需以 .svg 结尾。');

  const cfg = buildConfig(opts);
  const filename = path.basename(imagePath);
  const form = new FormData();
  form.append('image', new Blob([imageData], { type: mimeOf(imagePath) }), filename);
  form.append('config', JSON.stringify(cfg));

  const timeoutMs = opts.timeout || DEFAULT_TIMEOUT_MS;
  let svgText = null;
  let lastErr = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'x-api-key': key },
        body: form,
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (res.status === 200 || res.status === 201) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const json = await res.json();
          const svg = (json && (json.svg || (json.data && json.data.svg))) || null;
          if (!svg) fail(2, '上游返回 JSON 但未包含 SVG 内容。');
          svgText = svg;
        } else {
          svgText = await res.text();
        }
        break;
      }

      if (res.status === 402) fail(2, '积分不足（HTTP 402），请充值后重试。');
      if (res.status === 429) fail(2, '请求过于频繁（HTTP 429），请稍后再试。');

      const body = (await res.text()).slice(0, 500);
      lastErr = `上游返回 HTTP ${res.status}: ${body}`;
      if (res.status >= 500) continue;
      fail(2, lastErr);
    } catch (e) {
      clearTimeout(timer);
      const msg = e && e.message ? e.message : String(e);
      if (e && e.name === 'AbortError') lastErr = `请求超时（>${Math.round(timeoutMs / 1000)}s），第 ${attempt} 次失败`;
      else lastErr = `网络请求失败: ${msg}，第 ${attempt} 次失败`;
      if (attempt === 2) {
        fail(3, lastErr.includes('超时') ? `${lastErr}，请稍后重试或调大 --timeout。` : lastErr);
      }
    }
  }

  if (svgText === null || svgText === undefined) fail(3, lastErr || '未获得 SVG 结果。');
  const trimmed = svgText.trim();
  if (!/^<svg[\s>]/i.test(trimmed) && !/^<\?xml/i.test(trimmed)) {
    fail(2, '上游未返回 SVG 文档，疑似响应异常: ' + trimmed.slice(0, 200));
  }

  try {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, svgText, 'utf8');
  } catch (e) {
    fail(4, `写入 SVG 失败: ${outPath}（${e && e.message ? e.message : e}）`);
  }

  const size = Buffer.byteLength(svgText, 'utf8');
  log(JSON.stringify({ ok: true, svgPath: path.resolve(outPath), bytes: size, preset: opts.preset || 'default' }));
  log(`完成：SVG 已写入 ${path.resolve(outPath)}（${size} 字节）`);
}

// ---------- validate ----------
function stripComments(svg) {
  return svg.replace(/<!--[\s\S]*?-->/g, '');
}

function cmdValidate(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(4, `无法读取 SVG: ${file}（${e && e.message ? e.message : e}）`);
  }
  const svg = stripComments(raw);
  const issues = [];
  if (!svg.trim()) issues.push('文件为空');
  if ((svg.match(/<svg[\s>]/i) || []).length !== 1) issues.push('应恰好包含 1 个 <svg> 根元素');
  if (!/<\/svg>/i.test(svg)) issues.push('缺少 </svg> 闭合标签');

  const openText = (svg.match(/<text[\s>]/gi) || []).length;
  const closeText = (svg.match(/<\/text>/gi) || []).length;
  if (openText !== closeText) issues.push(`<text> 开闭不平衡（开 ${openText} / 闭 ${closeText}）`);

  if (issues.length) {
    fail(2, '结构自检未通过:\n - ' + issues.join('\n - '));
  }
  log(JSON.stringify({ ok: true, svgPath: path.resolve(file), bytes: Buffer.byteLength(raw, 'utf8'), textNodes: openText }));
  log('结构自检通过（基础校验，非完整 XML 解析）。');
}

// ---------- text-inject ----------
function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n) {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0';
}

function parseNumList(src) {
  const nums = String(src).trim().split(/[\s,]+/).filter(Boolean).map(Number);
  return nums.length === 4 && nums.every(Number.isFinite) ? nums : null;
}

// 读取 <svg> 的 viewBox（无则用 width/height），返回 {w,h}
function svgCanvas(svgText) {
  const root = svgText.match(/<svg[^>]*>/i);
  if (!root) return null;
  const tag = root[0];
  const vb = tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
  if (vb) {
    const n = parseNumList(vb[1]);
    if (n) return { w: n[2], h: n[3] };
  }
  const w = Number((tag.match(/\bwidth\s*=\s*["']([^"']+)["']/i) || [])[1]);
  const h = Number((tag.match(/\bheight\s*=\s*["']([^"']+)["']/i) || [])[1]);
  if (Number.isFinite(w) && Number.isFinite(h)) return { w, h };
  return null;
}

function numProp(o, keys, fallback) {
  for (const k of keys) {
    if (o && o[k] !== undefined && Number.isFinite(Number(o[k]))) return Number(o[k]);
  }
  return fallback;
}

const TEXT_ANCHOR = { left: 'start', start: 'start', center: 'middle', middle: 'middle', right: 'end', end: 'end' };

const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F\u3040-\u30FF]/;
const CAPS_RE = /^[\x20-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E0-9A-Z]*$/;

function kindOf(content) {
  const c = String(content == null ? '' : content);
  if (CJK_RE.test(c)) return 'cjk';
  if (CAPS_RE.test(c)) return 'caps';
  return 'latin';
}

const GLYPH_METRIC = {
  cjk: { top: 0.86, em: 0.98 },
  caps: { top: 0.72, em: 0.72 },
  latin: { top: 0.85, em: 0.95 },
};

function glyphRatioOf(text) {
  if (text.glyphRatio != null && Number.isFinite(Number(text.glyphRatio))) return Number(text.glyphRatio);
  return GLYPH_METRIC[kindOf(text.content)].top;
}

function parseShift(s) {
  const m = String(s || '').trim().match(/^(-?[\d.]+)[,，]\s*(-?[\d.]+)$/);
  return m ? { dx: Number(m[1]), dy: Number(m[2]) } : null;
}

function parseScalar(s, name) {
  const v = Number(s);
  if (!Number.isFinite(v) || v <= 0) fail(1, `${name} 需为正数，如 --size 0.95 / --scale 1.02`);
  return v;
}

// 生成一块文字的 <text> 节点列表；global 提供整体 zoom/size/shift
function buildTextLines(text, sx, sy, global) {
  const g = global || {};
  const zoom = Number.isFinite(g.zoom) ? g.zoom : 1;
  const size = Number.isFinite(g.size) ? g.size : 1;
  const shiftX = Number.isFinite(g.shiftX) ? g.shiftX : 0;
  const shiftY = Number.isFinite(g.shiftY) ? g.shiftY : 0;

  const b = text.bbox || {};
  const kind = kindOf(text.content);
  const metric = GLYPH_METRIC[kind];
  const anchor = TEXT_ANCHOR[(text.align || text.anchor || 'left').toLowerCase()] || 'start';
  const lines = String(text.content == null ? '' : text.content).split('\n');
  const n = lines.length;
  const lineHeight = numProp(text, ['lineHeight'], 1.2);

  let fs = 16;
  if (text.fontSize != null && Number.isFinite(Number(text.fontSize))) {
    fs = Number(text.fontSize) * sy;
  } else {
    const boxH = numProp(b, ['h', 'height'], 0) * sy;
    const denom = (n - 1) * lineHeight + metric.em;
    if (boxH > 0 && denom > 0) fs = boxH / denom;
  }
  const fsFinal = fs * zoom * size;
  const lineH = fsFinal * lineHeight;

  let xRef = numProp(b, ['x', 'left'], 0) * sx;
  if (anchor === 'middle') xRef += numProp(b, ['w', 'width'], 0) * sx / 2;
  else if (anchor === 'end') xRef += numProp(b, ['w', 'width'], 0) * sx;
  xRef = (xRef + numProp(text, ['dx'], 0) * sx) * zoom + shiftX;

  let yRef;
  const hasBaseline = text.baseline != null && Number.isFinite(Number(text.baseline));
  if (hasBaseline) {
    yRef = (Number(text.baseline) * sy + numProp(text, ['dy'], 0) * sy) * zoom + shiftY;
  } else {
    const yTop = (numProp(b, ['y', 'top'], 0) * sy + numProp(text, ['dy'], 0) * sy) * zoom + shiftY;
    yRef = yTop + glyphRatioOf(text) * fsFinal;
  }

  const fill = text.fill || '#000000';
  const weight = text.fontWeight || text.weight || 'normal';
  const family = text.fontFamily || text.font || '';
  const css = [];
  if (family) css.push(`font-family="${xmlEscape(family)}"`);
  css.push(`font-size="${fmtNum(fsFinal)}"`);
  css.push(`font-weight="${xmlEscape(String(weight))}"`);
  css.push(`fill="${xmlEscape(fill)}"`);
  css.push(`text-anchor="${anchor}"`);

  const nodes = [];
  lines.forEach((ln, i) => {
    if (ln.trim() === '' && n === 1) return;
    const yBase = yRef + i * lineH; // SVG <text> 的 y 为基线
    nodes.push(`    <text x="${fmtNum(xRef)}" y="${fmtNum(yBase)}" ${css.join(' ')}>${xmlEscape(ln)}</text>`);
  });
  nodes._meta = {
    kind,
    fs: fsFinal,
    x: xRef,
    yFirst: yRef,
    baseline: hasBaseline,
    lineH,
    estimatedSize: !(text.fontSize != null && Number.isFinite(Number(text.fontSize))),
  };
  return nodes;
}

function fmtMeta(m) {
  return `${m.kind.padEnd(5)} fs=${fmtNum(m.fs).padStart(7)} x=${fmtNum(m.x).padStart(8)} firstBaselineY=${fmtNum(m.yFirst).padStart(8)} lineH=${fmtNum(m.lineH).padStart(6)} ${m.estimatedSize ? '(字号由框高估算)' : '(显式字号)'} ${m.baseline ? '(显式基线)' : ''}`;
}

function collectSvgIds(svgRaw) {
  const ids = new Set();
  const re = /<[a-zA-Z_][^>]*\bid\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(svgRaw))) ids.add(m[1]);
  return ids;
}

// 新版清单（schema_version "1.0" / text_elements）：归一化为像素画布域内部对象。
function normalizeV1Element(el, i, cw, ch) {
  if (el == null || typeof el !== 'object') fail(1, `text_elements[${i}] 不是对象。`);
  for (const key of ['id', 'content', 'x', 'y']) {
    if (el[key] === undefined) fail(1, `text_elements[${i}] 缺 ${key}。`);
  }
  const content = String(el.content);
  if (!content.trim()) fail(1, `text_elements[${i}] content 不能为空。`);
  const space = String(el.coordinate_space || 'pixels').toLowerCase();
  if (!['pixels', 'normalized', 'svg'].includes(space)) {
    fail(1, `text_elements[${i}] coordinate_space 非法: ${el.coordinate_space}（可选 pixels|normalized|svg）。`);
  }
  let x = Number(el.x);
  let y = Number(el.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail(1, `text_elements[${i}] x / y 必须是有限数值。`);
  const fsSpace = String(el.font_size_space || 'pixels').toLowerCase();
  let fs = null;
  if (el.font_size !== undefined) {
    fs = Number(el.font_size);
    if (!Number.isFinite(fs) || fs <= 0) fail(1, `text_elements[${i}] font_size 必须是正数。`);
  }
  if (space === 'normalized') {
    x *= cw;
    y *= ch;
    if (fs != null && fsSpace === 'normalized') fs *= ch;
  }
  const t = {
    id: String(el.id),
    content,
    x,
    y,
    space,
    fs,
    font_family: String(el.font_family || 'Arial'),
    font_weight: String(el.font_weight || 'normal'),
    font_style: String(el.font_style || 'normal'),
    fill: el.fill == null ? '#000000' : String(el.fill),
    text_anchor: String(el.text_anchor || 'start').toLowerCase(),
    rotation: el.rotation === undefined ? 0 : Number(el.rotation),
    line_height: el.line_height === undefined ? 1.2 : Number(el.line_height),
    paint_order: el.paint_order === undefined ? null : Number(el.paint_order),
    source_bbox: Array.isArray(el.source_bbox) ? el.source_bbox.map(Number) : null,
    dx: el.dx === undefined ? 0 : Number(el.dx),
    dy: el.dy === undefined ? 0 : Number(el.dy),
  };
  if (!['start', 'middle', 'end'].includes(t.text_anchor)) {
    fail(1, `text_elements[${i}] text_anchor 非法: ${el.text_anchor}（可选 start|middle|end）。`);
  }
  if (el.rotation !== undefined && !Number.isFinite(t.rotation)) fail(1, `text_elements[${i}] rotation 必须是有限数值（度）。`);
  if (el.line_height !== undefined && (!Number.isFinite(t.line_height) || t.line_height <= 0)) {
    fail(1, `text_elements[${i}] line_height 必须是正数。`);
  }
  if (el.paint_order !== undefined && !Number.isFinite(t.paint_order)) fail(1, `text_elements[${i}] paint_order 必须是有限数值。`);
  if (t.source_bbox && t.source_bbox.some((v) => !Number.isFinite(v))) {
    fail(1, `text_elements[${i}] source_bbox 须为 4 个有限数值 [left, top, width, height]。`);
  }
  if (!Number.isFinite(t.dx) || !Number.isFinite(t.dy)) fail(1, `text_elements[${i}] dx / dy 必须是有限数值。`);
  return t;
}

// 新版块生成器：x/y 直接作为 text-anchor 锚点与首行基线，支持旋转/多行/id。
function buildTextLinesV1(t, sx, sy, global) {
  const g = global || {};
  const zoom = Number.isFinite(g.zoom) ? g.zoom : 1;
  const size = Number.isFinite(g.size) ? g.size : 1;
  const shiftX = Number.isFinite(g.shiftX) ? g.shiftX : 0;
  const shiftY = Number.isFinite(g.shiftY) ? g.shiftY : 0;
  const svgSpace = t.space === 'svg';
  const bx = svgSpace ? 1 : sx;
  const by = svgSpace ? 1 : sy;
  const kind = kindOf(t.content);
  const metric = GLYPH_METRIC[kind];
  const anchor = t.text_anchor;
  const lines = String(t.content).split('\n');
  const n = lines.length;
  const lineHeight = t.line_height;
  let fsPx = 16;
  let estimated = true;
  if (t.fs != null) {
    fsPx = t.fs;
    estimated = false;
  } else {
    const boxH = t.source_bbox && t.source_bbox.length >= 4 ? t.source_bbox[3] : 0;
    const denom = (n - 1) * lineHeight + metric.em;
    if (boxH > 0 && denom > 0) fsPx = boxH / denom;
  }
  const fsFinal = fsPx * by * zoom * size;
  const lineH = fsFinal * lineHeight;
  const xRef = (t.x * bx + t.dx * bx) * zoom + shiftX;
  const yRef = (t.y * by + t.dy * by) * zoom + shiftY;
  const css = [];
  css.push(`font-family="${xmlEscape(t.font_family)}"`);
  css.push(`font-size="${fmtNum(fsFinal)}"`);
  css.push(`font-weight="${xmlEscape(t.font_weight)}"`);
  if (String(t.font_style).toLowerCase() !== 'normal') css.push(`font-style="${xmlEscape(t.font_style)}"`);
  css.push(`fill="${xmlEscape(t.fill)}"`);
  css.push(`text-anchor="${anchor}"`);
  const inner = lines
    .map((ln, i) => `    <text x="${fmtNum(xRef)}" y="${fmtNum(yRef + i * lineH)}" ${css.join(' ')}>${xmlEscape(ln)}</text>`)
    .join('\n');
  const groupAttrs = [];
  if (t.id !== '') groupAttrs.push(`id="${xmlEscape(t.id)}"`);
  if (t.rotation) groupAttrs.push(`transform="rotate(${fmtNum(t.rotation)} ${fmtNum(xRef)} ${fmtNum(yRef)})"`);
  return {
    xml: `  <g${groupAttrs.length ? ' ' + groupAttrs.join(' ') : ''}>\n${inner}\n  </g>`,
    meta: {
      kind, fs: fsFinal, x: xRef, yFirst: yRef, lineH, estimatedSize: estimated,
      anchor, rotation: t.rotation, space: t.space,
    },
  };
}

function fmtMetaV1(m) {
  return `${m.kind.padEnd(5)} fs=${fmtNum(m.fs).padStart(7)} x=${fmtNum(m.x).padStart(8)} firstBaselineY=${fmtNum(m.yFirst).padStart(8)} lineH=${fmtNum(m.lineH).padStart(6)} ${m.estimatedSize ? '(字号由框高估算)' : '(显式字号)'} anchor=${m.anchor} rot=${fmtNum(m.rotation)} space=${m.space}`;
}

function cmdTextInject(svgFile, manifestFile, opts) {
  let svgRaw;
  try {
    svgRaw = fs.readFileSync(svgFile, 'utf8');
  } catch (e) {
    fail(4, `无法读取基础 SVG: ${svgFile}（${e && e.message ? e.message : e}）`);
  }
  const cv = svgCanvas(svgRaw);
  if (!cv) fail(1, `无法从 SVG 解析画布尺寸（无 viewBox / width / height）: ${svgFile}`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (e) {
    fail(4, `无法读取或解析文字清单: ${manifestFile}（${e && e.message ? e.message : e}）`);
  }
  const isV1 = Boolean(manifest && manifest.schema_version === '1.0');
  const canvasSrc = isV1 ? (manifest.source_canvas || {}) : (manifest.canvas || {});
  const cw = numProp(canvasSrc, ['w', 'width'], 0);
  const ch = numProp(canvasSrc, ['h', 'height'], 0);
  if (!cw || !ch) {
    fail(1, isV1
      ? '文字清单缺 source_canvas 尺寸（应含 source_canvas: {width, height}，即去字前的原图像素尺寸）。'
      : '文字清单缺 canvas 尺寸（应含 canvas: {w, h}，即去字前的原图像素尺寸）。');
  }
  if (isV1) {
    if (!Array.isArray(manifest.text_elements)) fail(1, '文字清单缺 text_elements 数组。');
  } else if (!Array.isArray(manifest.texts)) {
    fail(1, '文字清单缺 texts 数组。');
  }

  const sx = cv.w / cw;
  const sy = cv.h / ch;
  let scaleX = sx;
  let scaleY = sy;
  if (opts.fit === 'uniform') {
    const s = Math.min(sx, sy);
    scaleX = scaleY = s;
  }

  const shift = parseShift(opts.shift);
  if (opts.shift != null && !shift) fail(1, `--shift 格式应为 dx,dy（如 0,3.5 或 -2,-1）。`);
  const zoom = opts.scale != null ? parseScalar(opts.scale, '--scale') : 1;
  const size = opts.size != null ? parseScalar(opts.size, '--size') : 1;
  const global = { zoom, size, shiftX: shift ? shift.dx : 0, shiftY: shift ? shift.dy : 0 };

  const blocks = [];
  const metas = [];
  let textCount = 0;

  if (isV1) {
    const svgIds = collectSvgIds(svgRaw);
    const seenIds = new Set();
    const items = manifest.text_elements.map((el, i) => {
      const t = normalizeV1Element(el, i, cw, ch);
      if (seenIds.has(t.id)) fail(1, `text_elements 的 id 重复: ${t.id}`);
      if (svgIds.has(t.id)) fail(1, `text_elements 的 id 与 SVG 中已有元素冲突: ${t.id}`);
      seenIds.add(t.id);
      return t;
    });
    const sorted = items
      .map((t, i) => ({ t, i }))
      .sort((a, b) => {
        const pa = a.t.paint_order == null ? Number.MAX_SAFE_INTEGER : a.t.paint_order;
        const pb = b.t.paint_order == null ? Number.MAX_SAFE_INTEGER : b.t.paint_order;
        if (pa !== pb) return pa - pb;
        return a.i - b.i;
      })
      .map((entry) => entry.t);
    sorted.forEach((t, index) => {
      const built = buildTextLinesV1(t, scaleX, scaleY, global);
      metas.push(`  #${index} ${fmtMetaV1(built.meta)}  内容: ${String(t.content).split('\n').join(' / ')}`);
      blocks.push(built.xml);
    });
    textCount = items.length;
  } else {
    manifest.texts.forEach((t, i) => {
      if (t == null || typeof t !== 'object') fail(1, `texts[${i}] 不是对象。`);
      if (!t.bbox || !Number.isFinite(numProp(t.bbox, ['x', 'left'])) || !Number.isFinite(numProp(t.bbox, ['y', 'top']))) {
        fail(1, `texts[${i}] 缺 bbox.x / bbox.y。`);
      }
      const lines = buildTextLines(t, scaleX, scaleY, global);
      if (lines._meta) {
        metas.push(`  #${i} ${fmtMeta(lines._meta)}  内容: ${String(t.content || '').split('\n').join(' / ')}`);
      }
      delete lines._meta;
      if (lines.length) blocks.push(`  <g>\n${lines.join('\n')}\n  </g>`);
    });
    textCount = manifest.texts.length;
  }

  if (!blocks.length) fail(1, '文字清单解析后没有可插入的文本内容（每块需有非空 content）。');
  const injection = blocks.join('\n');

  if (opts.dryRun) {
    log('---- 每块推算明细（先核对坐标/字号，再决定是否微调）----');
    log(metas.join('\n'));
    log('--------------------------------------------------------');
    log('---- 将要插入的 XML ----');
    log(injection);
    log('------------------------');
    log(JSON.stringify({ ok: true, dryRun: true, texts: textCount, fit: opts.fit || 'stretch', shift: global.shiftX || global.shiftY ? { dx: global.shiftX, dy: global.shiftY } : null, size, zoom, svgCanvas: cv, manifestCanvas: { w: cw, h: ch } }));
    return;
  }

  const outPath = opts.output || path.join(path.dirname(path.resolve(svgFile)), path.basename(svgFile, '.svg') + '.text.svg');
  if (!/\.svg$/i.test(outPath)) fail(1, '输出路径需以 .svg 结尾。');
  const closeIdx = svgRaw.search(/<\/svg>\s*$/i);
  if (closeIdx < 0) fail(1, `基础 SVG 缺少 </svg> 闭合标签: ${svgFile}`);

  const outSvg = svgRaw.slice(0, closeIdx) + injection + '\n' + svgRaw.slice(closeIdx);
  try {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, outSvg, 'utf8');
  } catch (e) {
    fail(4, `写入 SVG 失败: ${outPath}（${e && e.message ? e.message : e}）`);
  }
  log(JSON.stringify({ ok: true, svgPath: path.resolve(outPath), bytes: Buffer.byteLength(outSvg, 'utf8'), textBlocks: textCount, fit: opts.fit || 'stretch', shift: global.shiftX || global.shiftY ? { dx: global.shiftX, dy: global.shiftY } : null, size, zoom }));
  log(`完成：已注入 ${textCount} 块可编辑文字到 ${path.resolve(outPath)}`);
  log('提示：可在 Illustrator 中打开该 SVG 验证文字已是文本对象；交付 .ai 请按 SKILL.md 基础模式第 8 步 / 文字模式第 8 步（agent 自动重绘交付 .ai）。');
}

// ---------- main ----------
function main() {
  const argv = process.argv.slice(2);
  const [sub, ...rest] = argv;

  if (!sub || sub === '-h' || sub === '--help' || sub === 'help') {
    log(HELP);
    return;
  }
  if (sub === '-v' || sub === '--version' || sub === 'version') {
    log(VERSION);
    return;
  }

  if (sub === 'init') {
    const argKey = rest.find((a) => !a.startsWith('-')) || undefined;
    cmdInit(argKey || process.env.NATURE_VECT_API_KEY || '');
    return;
  }

  if (sub === 'check') {
    cmdCheck().catch((e) => fail(3, e && e.message ? e.message : String(e)));
    return;
  }

  if (sub === 'credit') {
    const idx = rest.indexOf('--key');
    const cliKey = idx >= 0 && rest[idx + 1] ? rest[idx + 1] : undefined;
    cmdCredit(cliKey || '').catch((e) => fail(3, e && e.message ? e.message : String(e)));
    return;
  }

  if (sub === 'validate') {
    if (rest.length < 1) fail(1, '用法: node nature-vect.js validate <svg 文件>');
    cmdValidate(rest[rest.length - 1]);
    return;
  }

  if (sub === 'convert') {
    const positional = [];
    const opts = {};
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      const take = () => (++i < rest.length ? rest[i] : null);
      switch (a) {
        case '-o':
        case '--output': opts.output = take(); break;
        case '-p':
        case '--preset': opts.preset = take(); break;
        case '--draw-style': opts.drawStyle = take(); break;
        case '--group-by': opts.groupBy = take(); break;
        case '--stroke-color': opts.strokeColor = take(); break;
        case '--stroke-width': opts.strokeWidth = Number(take()); break;
        case '--extra': opts.extra = take(); break;
        case '--key': opts.key = take(); break;
        case '--timeout': opts.timeout = Number(take()); break;
        case '--no-non-scaling': opts.nonScaling = false; break;
        case '--no-adobe-compat': opts.adobeCompat = false; break;
        default:
          if (a.startsWith('-')) fail(1, `未知参数: ${a}\n${HELP}`);
          positional.push(a);
      }
    }
    if (positional.length < 1) fail(1, '缺少输入图片路径。\n' + HELP);
    if (opts.drawStyle && !['fill', 'stroke', 'strokeEdges'].includes(opts.drawStyle)) {
      fail(1, `--draw-style 非法: ${opts.drawStyle}（可选 fill|stroke|strokeEdges）`);
    }
    cmdConvert(positional[0], opts).catch((e) => fail(3, e && e.message ? e.message : String(e)));
    return;
  }

  if (sub === 'text-inject') {
    const positional = [];
    const opts = {};
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      const take = () => (++i < rest.length ? rest[i] : null);
      switch (a) {
        case '-o':
        case '--output': opts.output = take(); break;
        case '--fit': opts.fit = take(); break;
        case '--shift': opts.shift = take(); break;
        case '--size': opts.size = take(); break;
        case '--scale': opts.scale = take(); break;
        case '--dry-run': opts.dryRun = true; break;
        default:
          if (a.startsWith('-')) fail(1, `未知参数: ${a}\n${HELP}`);
          positional.push(a);
      }
    }
    if (positional.length < 2) fail(1, '用法: node nature-vect.js text-inject <基础.svg> <manifest.json> [-o 输出.svg]\n' + HELP);
    if (opts.fit && !['stretch', 'uniform'].includes(opts.fit)) fail(1, `--fit 非法: ${opts.fit}（可选 stretch|uniform）`);
    cmdTextInject(positional[0], positional[1], opts);
    return;
  }

  fail(1, `未知子命令: ${sub}\n${HELP}`);
}

main();
