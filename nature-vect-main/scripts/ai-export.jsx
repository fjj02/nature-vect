// ai-export.jsx —— nature-vect：把 SVG 在 Adobe Illustrator 中另存为 .ai
// -----------------------------------------------------------------------------
// 用途：文字模式第 8 步的兜底工具（v2.0 起主路已由 run_nv_replay/direct + 
//       -AutoCanvasFromSvg 自动重绘交付 .ai；本脚本用于 agent 无法自动绘制、
//       用户知情同意降级时的"代存"）。本脚本由 agent 在装有
//       Adobe Illustrator 2019–2026 的目标机上执行，负责把 convert + text-inject
//       产出的 SVG 打开并另存为 .ai 原生文件。SVG 内的 <text> 在 .ai 中仍是
//       可编辑文本对象，双击即可改字。
//
// 执行方式（三选一，全部由 agent 自动完成）：
//   1) 用文本编辑器把下方两个路径改好后，在 AI 里执行：
//        文件 → 脚本 → 其他脚本…（File → Scripts → Other Script…）→ 选本文件
//   2) 把本文件拖入 Illustrator 画板/窗口即可运行
//   3) 放入 Illustrator 预设脚本目录后从 文件→脚本 菜单运行
//
// 说明：脚本文件以 UTF-8(with BOM) 保存，中文内容在中文版 AI 中显示正常。
//       若你的 AI 版本对某个保存选项报错，请改用 manual 兜底：
//       在 AI 里 文件→打开 该 SVG → 文件→另存为→类型选“Illustrator”，手动完成。
// -----------------------------------------------------------------------------

#target illustrator

// ================== 需要 agent 填写的路径（编辑下面三行） ==================
var SVG_PATH = '';                 // 例如 'E:/out/sample.text.svg'（必填：含可编辑 <text> 的 SVG）
var OUT_PATH = '';                 // 例如 'E:/out/sample.ai'（必填：目标 .ai 路径）
var PDF_COMPATIBLE = true;         // 建议 true：.ai 附带 PDF 兼容，其它软件也能预览
// ==========================================================================

function ask(what, filter) {
    var f = new File();
    if (f[what](what === 'openDialog' ? '请选择文件' : '请指定保存位置', filter)) return f.fsName;
    return '';
}

function main() {
    var src = String(SVG_PATH || '').trim();
    if (!src) src = ask('openDialog', 'SVG 文件:*.svg');
    if (!src) { alert('未选择 SVG，已取消。'); return; }

    var dst = String(OUT_PATH || '').trim();
    if (!dst) dst = ask('saveDialog', 'Illustrator:*.ai');
    if (!dst) { alert('未指定保存位置，已取消。'); return; }

    var srcFile = new File(src);
    if (!srcFile.exists) { alert('找不到文件：' + src); return; }

    // 尽量静默执行（个别版本不支持则忽略）
    try { app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS; } catch (e) {}
    try { app.displayDialogs = DialogModes.NO; } catch (e) {}

    var doc = app.open(srcFile);                 // 打开 SVG（<text> 自动成为文本对象）
    if (!doc) { alert('打开 SVG 失败：' + src); return; }

    var outFile = new File(dst);
    if (outFile.exists) outFile.remove();

    try {
        var opts = new IllustratorSaveOptions();
        opts.pdfCompatible = Boolean(PDF_COMPATIBLE);
        doc.saveAs(outFile, opts);
    } catch (e) {
        // 个别版本对 IllustratorSaveOptions 支持不同 → 退回最简保存
        doc.saveAs(outFile);
    }

    doc.close(SaveOptions.DONOTSAVECHANGES);
    alert('导出完成：\n' + outFile.fsName + '\n\nSVG 中的文字为可编辑文本对象，可在 AI 中双击修改字体、内容与排版。');
}

main();
