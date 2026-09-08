# run_nv_direct.ps1 -- nature-vect "direct replay" orchestrator (Windows + Illustrator COM).
# Direct engine: Illustrator itself imports the master SVG in a no-UI document, samples
# native PathItem/CompoundPathItem/TextFrame geometry, and redraws it into the current
# artboard. Text becomes live, editable TextFrame objects. Ported from cell-lct's
# scripts/run_cell_lct_direct.ps1 (same author); namespace NATURE_VECT_DIRECT_*.
# Note: visible default delay is 0 (matches the cached engine).
param(
    [Parameter(Mandatory = $true)]
    [string]$InputSvg,

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
