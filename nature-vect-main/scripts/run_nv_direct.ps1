# run_nv_direct.ps1 -- nature-vect "direct replay" orchestrator (Windows + Illustrator COM).
# Direct engine: Illustrator itself imports the master SVG in a no-UI document, samples
# native PathItem/CompoundPathItem/TextFrame geometry, and redraws it into a target
# document. With -AutoCanvasFromSvg it first creates an equal-size RGB document from the
# SVG viewBox (1 px = 1 pt); otherwise it draws into the current active artboard.
# Text becomes live, editable TextFrame objects. Ported from cell-lct's
# scripts/run_cell_lct_direct.ps1 (same author); namespace NATURE_VECT_DIRECT_*.
# Note: visible default delay is 0 (matches the cached engine).
param(
    [Parameter(Mandatory = $true)]
    [string]$InputSvg,

    [switch]$AutoCanvasFromSvg,

    [string]$OutputAi,
    [string]$OutputPng,

    [ValidateSet('center', 'bottom-right', 'top-right', 'bottom-left', 'top-left')]
    [string]$Placement = 'center',

    [ValidateRange(0.01, 1.0)]
    [double]$MaxWidthFraction = 0.72,

    [ValidateRange(0.01, 1.0)]
    [double]$MaxHeightFraction = 0.78,

    [ValidateRange(0, 5000)]
    [int]$DelayMs = 0,

    [switch]$NewDocument,

    [ValidateRange(10, 16348)]
    [double]$DocumentWidth = 1254,

    [ValidateRange(10, 16348)]
    [double]$DocumentHeight = 1254,

    [bool]$ReplaceExistingGroup = $true,

    [ValidateRange(-1, 1000000)]
    [int]$AtomicIndex = -1,

    [bool]$SaveOutputs = $true,

    [string]$AtomicBatchJson,

    [string]$GroupName = 'NATURE_VECT_DIRECT_Runtime_SVG',
    [string]$IllustratorProgId = 'Illustrator.Application.CC.2019'
)

$ErrorActionPreference = 'Stop'

$resolvedInput = (Resolve-Path -LiteralPath $InputSvg).Path
if ([IO.Path]::GetExtension($resolvedInput) -ne '.svg') {
    throw "Input must be an SVG file: $resolvedInput"
}

# -AutoCanvasFromSvg: read the SVG viewBox (or width/height) in px and turn it into
# a brand-new equal-size document (1 px = 1 pt), content placed 1:1 (fractions -> 1.0).
function Read-SvgCanvasSize([string]$svgPath) {
    $raw = [IO.File]::ReadAllText($svgPath)
    $root = [regex]::Match($raw, '<svg[^>]*>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $root.Success) { throw "Cannot parse SVG root element: $svgPath" }
    $tag = $root.Value
    $vb = [regex]::Match($tag, 'viewBox\s*=\s*["'']([^"'']+)["'']', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($vb.Success) {
        $nums = @($vb.Groups[1].Value -split '[\s,]+' | ForEach-Object { [double]$_ })
        if ($nums.Count -ge 4 -and $nums[2] -gt 0 -and $nums[3] -gt 0) { return @($nums[2], $nums[3]) }
    }
    $w = [double]([regex]::Match($tag, '\bwidth\s*=\s*["'']([0-9.]+)["'']', [Text.RegularExpressions.RegexOptions]::IgnoreCase).Groups[1].Value)
    $h = [double]([regex]::Match($tag, '\bheight\s*=\s*["'']([0-9.]+)["'']', [Text.RegularExpressions.RegexOptions]::IgnoreCase).Groups[1].Value)
    if ($w -gt 0 -and $h -gt 0) { return @($w, $h) }
    throw "Cannot determine SVG canvas size from $svgPath (need viewBox or width/height)."
}

if ($AutoCanvasFromSvg) {
    $canvasSize = Read-SvgCanvasSize $resolvedInput
    $DocumentWidth = [double]$canvasSize[0]
    $DocumentHeight = [double]$canvasSize[1]
    $NewDocument = $true
    # 等大画板下内容应 1:1 铺满，禁用默认的 0.72/0.78 收缩占幅。
    $MaxWidthFraction = 1.0
    $MaxHeightFraction = 1.0
}

$inputDirectory = [IO.Path]::GetDirectoryName($resolvedInput)
$inputStem = [IO.Path]::GetFileNameWithoutExtension($resolvedInput)
if ([string]::IsNullOrWhiteSpace($OutputAi)) {
    $OutputAi = [IO.Path]::Combine($inputDirectory, "${inputStem}_nv.ai")
}
if ([string]::IsNullOrWhiteSpace($OutputPng)) {
    $OutputPng = [IO.Path]::Combine($inputDirectory, "${inputStem}_nv.png")
}

$OutputAi = [IO.Path]::GetFullPath($OutputAi)
$OutputPng = [IO.Path]::GetFullPath($OutputPng)
foreach ($outputPath in @($OutputAi, $OutputPng)) {
    $outputDirectory = [IO.Path]::GetDirectoryName($outputPath)
    if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
        New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
    }
}

$runtimePath = Join-Path $PSScriptRoot 'illustrator-direct-runtime.jsx'
if (-not (Test-Path -LiteralPath $runtimePath)) {
    throw "Runtime JSX is missing: $runtimePath"
}

$atomicBatch = $null
if (-not [string]::IsNullOrWhiteSpace($AtomicBatchJson)) {
    $atomicBatch = @($AtomicBatchJson | ConvertFrom-Json)
}

$configuration = [ordered]@{
    inputSvg = ($resolvedInput -replace '\\', '/')
    outputAi = ($OutputAi -replace '\\', '/')
    outputPng = ($OutputPng -replace '\\', '/')
    placement = $Placement
    maxWidthFraction = $MaxWidthFraction
    maxHeightFraction = $MaxHeightFraction
    delayMs = $DelayMs
    createNewDocument = [bool]$NewDocument
    documentWidth = $DocumentWidth
    documentHeight = $DocumentHeight
    groupName = $GroupName
    replaceExistingGroup = $ReplaceExistingGroup
    atomicIndex = $AtomicIndex
    saveOutputs = $SaveOutputs
    atomicBatch = $atomicBatch
}

$configJson = $configuration | ConvertTo-Json -Compress -Depth 8
$runtimeJson = (($runtimePath -replace '\\', '/') | ConvertTo-Json -Compress)
$bootstrap = "var NATURE_VECT_DIRECT_CONFIG = $configJson; $.evalFile(new File($runtimeJson));"

$illustrator = $null
try {
    $illustrator = New-Object -ComObject $IllustratorProgId
    if ([version]$illustrator.Version -lt [version]'23.0') {
        throw "Illustrator 2019 or newer is required; connected version is $($illustrator.Version)."
    }
    $result = [string]$illustrator.DoJavaScript($bootstrap)
    if (-not $result.StartsWith('OK|')) {
        throw "Illustrator runtime failed: $result"
    }
    $result
} finally {
    if ($null -ne $illustrator) {
        [Runtime.InteropServices.Marshal]::ReleaseComObject($illustrator) | Out-Null
    }
}
