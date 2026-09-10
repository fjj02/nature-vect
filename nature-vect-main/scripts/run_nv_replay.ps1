# run_nv_replay.ps1 —— nature-vect cached 绘制引擎编排器（Windows + Illustrator COM）
# 移植自本地 cell-lct 的 run_cell_lct.ps1（同作者），已改命名空间与脚本引用。
# 职责：①调 prep-replay-cache.py 一次性解析 Master SVG 出缓存
#       ②（可选 -AutoCanvasFromSvg）读 viewBox 自动新建与图等大的 RGB 画板（1px=1pt）
#       ③（可选 -AllowLaunch）Illustrator 未运行时允许经 COM 自启
#       ④单 COM 连接按批次调用 illustrator-replay-runtime.jsx（draw）逐批原生画图
#       ⑤周期存 .ai 检查点 + playback.json 断点续跑 + 最后 QA + 一次 PNG 导出。
# 前提：Windows、python3(+fontTools)、Illustrator 2019+（-AutoCanvasFromSvg 时可自启）、
#       agent 有本机 GUI/COM 控制能力。
param(
    [Parameter(Mandatory = $true)]
    [string]$InputSvg,
    [Parameter(Mandatory = $true)]
    [string]$WorkDir,
    [switch]$AutoCanvasFromSvg,
    [switch]$AllowLaunch,
    [string]$OutputAi,
    [string]$OutputPng,
    [ValidateRange(1, 50)]
    [int]$MinBatchSize = 20,
    [ValidateRange(1, 50)]
    [int]$MaxBatchSize = 50,
    [ValidateRange(20, 100000)]
    [int]$ComplexPointThreshold = 320,
    [ValidateRange(100, 100000)]
    [int]$MaxBatchPoints = 2200,
    [ValidateRange(0, 1000)]
    [int]$DelayMs = 0,
    [string]$TargetLayerName = '',
    [ValidateSet('center', 'top-center', 'left-center', 'bottom-center', 'bottom-right', 'top-right', 'bottom-left', 'top-left')]
    [string]$Placement = 'center',
    [ValidateRange(0.01, 1.0)]
    [double]$MaxWidthFraction = 0.72,
    [ValidateRange(0.01, 1.0)]
    [double]$MaxHeightFraction = 0.78,
    [ValidateRange(5, 3600)]
    [int]$CheckpointSeconds = 30,
    [ValidateRange(1, 50)]
    [int]$InSessionRetryLimit = 12,
    [switch]$DryRun,
    [switch]$QuietExistingGroups
)

$ErrorActionPreference = 'Stop'
if ($MinBatchSize -gt $MaxBatchSize) { throw 'MinBatchSize must not exceed MaxBatchSize.' }

$inputPath = (Resolve-Path -LiteralPath $InputSvg).Path
$workPath = [IO.Path]::GetFullPath($WorkDir)
New-Item -ItemType Directory -Force -Path $workPath | Out-Null
$stem = [IO.Path]::GetFileNameWithoutExtension($inputPath)
if ([string]::IsNullOrWhiteSpace($OutputAi)) {
    $OutputAi = Join-Path ([IO.Path]::GetDirectoryName($inputPath)) "${stem}.ai"
}
if ([string]::IsNullOrWhiteSpace($OutputPng)) {
    $OutputPng = Join-Path ([IO.Path]::GetDirectoryName($inputPath)) "${stem}.png"
}
$OutputAi = [IO.Path]::GetFullPath($OutputAi)
$OutputPng = [IO.Path]::GetFullPath($OutputPng)
foreach ($outputPath in @($OutputAi, $OutputPng)) {
    $directory = [IO.Path]::GetDirectoryName($outputPath)
    if (-not [string]::IsNullOrWhiteSpace($directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
}

$existingCachePath = Join-Path $workPath 'geometry-cache.json'
if (Test-Path -LiteralPath $existingCachePath -PathType Leaf) {
    $existingCacheHeader = Get-Content -LiteralPath $existingCachePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $jobSeed = [string]$existingCacheHeader.job_id
} else {
    # The sequential user-facing stem is globally unique. The work-directory
    # leaf is often the shared name "cached-playback" and must never identify
    # an Illustrator root group across separate drawing jobs.
    $jobSeed = $stem
}
$jobId = ($jobSeed -replace '[^A-Za-z0-9_-]', '_').Trim('_')
if ([string]::IsNullOrWhiteSpace($jobId)) { $jobId = 'job' }
if ($jobId.Length -gt 48) { $jobId = $jobId.Substring(0, 48) }

$prepareScript = Join-Path $PSScriptRoot 'prep-replay-cache.py'
$runtimePath = Join-Path $PSScriptRoot 'illustrator-replay-runtime.jsx'
foreach ($required in @($prepareScript, $runtimePath)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing required file: $required" }
}

$prepareArguments = @(
    '-3', '-X', 'utf8', $prepareScript,
    '--input', $inputPath,
    '--output-dir', $workPath,
    '--job-id', $jobId,
    '--min-batch-size', $MinBatchSize,
    '--max-batch-size', $MaxBatchSize,
    '--complex-point-threshold', $ComplexPointThreshold,
    '--max-batch-points', $MaxBatchPoints
)
$prepareOutput = & py @prepareArguments
if ($LASTEXITCODE -ne 0) { throw "Geometry cache preparation failed: $prepareOutput" }

$cachePath = Join-Path $workPath 'geometry-cache.json'
$statePath = Join-Path $workPath 'playback.json'
$cache = Get-Content -LiteralPath $cachePath -Raw -Encoding UTF8 | ConvertFrom-Json
$state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($DryRun) {
    Write-Output $prepareOutput
    Write-Output "DRY_RUN|cache=$cachePath|state=$statePath|atoms=$($cache.total_atoms)|batches=$($state.batches.Count)|illustrator_untouched=true"
    exit 0
}

function Save-State([object]$value) {
    $value.updated_at = [DateTime]::UtcNow.ToString('o')
    $temporary = "$statePath.tmp"
    $value | ConvertTo-Json -Depth 12 -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $statePath -Force
}

function Assert-IllustratorAlreadyOpen {
    $visible = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.MainWindowHandle -ne 0 -and ($_.ProcessName -match 'Illustrator' -or $_.MainWindowTitle -match 'Illustrator')
    } | Select-Object -First 1
    if ($null -eq $visible) {
        throw 'AI_NOT_RUNNING|Illustrator is not open. Re-run with -AllowLaunch (agent auto-launches it) or open Illustrator yourself.'
    }
}

# AutoCanvasFromSvg: create a brand-new RGB document sized 1:1 to the master
# SVG viewBox (1 px = 1 pt) and return its document name as the draw target.
# Must be called after COM is connected; allowed to start AI via COM only when
# -AllowLaunch is set (otherwise Assert-IllustratorAlreadyOpen already ran).
function New-EqualCanvasDocument([object]$illustrator, [object]$viewBox) {
    $width = [double]$viewBox[2]
    $height = [double]$viewBox[3]
    if ($width -le 0 -or $height -le 0) {
        throw "AutoCanvasFromSvg: cannot use viewBox dimensions from cache (got $width x $height)."
    }
    if ($width -gt 16348 -or $height -gt 16348) {
        throw "AutoCanvasFromSvg: viewBox is larger than Illustrator's 16348pt document limit ($width x $height)."
    }
    $script = "(function(){ var w = $width, h = $height; var d = app.documents.add(DocumentColorSpace.RGB, w, h); return 'OK|' + d.name; }());"
    $result = [string]$illustrator.DoJavaScript($script)
    if (-not $result.StartsWith('OK|')) {
        throw "AutoCanvasFromSvg: new document creation failed: $result"
    }
    return $result.Substring(3)
}

function ConvertTo-JsJson([object]$value) {
    return ConvertTo-Json -InputObject $value -Compress -Depth 20
}

function Invoke-CachedRuntime([object]$illustrator, [object]$configuration) {
    $configJson = ConvertTo-JsJson $configuration
    $runtimeJson = (($runtimePath -replace '\\', '/') | ConvertTo-Json -Compress)
    $bootstrap = "var NATURE_VECT_REPLAY_CONFIG = $configJson; `$`.evalFile(new File($runtimeJson));"
    return [string]$illustrator.DoJavaScript($bootstrap)
}

function Read-ResultValue([string]$result, [string]$key) {
    foreach ($part in ($result -split '\|')) {
        if ($part.StartsWith("$key=")) { return $part.Substring($key.Length + 1) }
    }
    return $null
}

function Get-ExistingBatchGroups([object]$illustrator, [string]$documentName) {
    $configuration = [ordered]@{
        documentName = $documentName
        rootGroupName = [string]$state.root_group_name
        groupNames = @($state.batches | ForEach-Object { [string]$_.group_name })
    }
    $payload = ConvertTo-JsJson $configuration
    $script = @"
(function(){
  var c=$payload;
  function namedGroup(container,name){
    for(var i=0;i<container.groupItems.length;i+=1){
      try{var item=container.groupItems[i];if(item&&item.name===name){return item;}}catch(ignore){}
    }
    return null;
  }
  var doc=null;
  for(var d=0;d<app.documents.length;d+=1){if(app.documents[d].name===c.documentName){doc=app.documents[d];break;}}
  if(doc===null){return 'ERROR|TARGET_DOCUMENT_MISSING';}
  var root=namedGroup(doc,c.rootGroupName);
  if(root===null){return '';}
  var found=[];
  for(var i=0;i<c.groupNames.length;i+=1){
    if(namedGroup(root,c.groupNames[i])!==null){found.push(c.groupNames[i]);}
  }
  return found.join('|NVVSEP|');
}());
"@
    $result = [string]$illustrator.DoJavaScript($script)
    if ($result.StartsWith('ERROR|')) { throw $result }
    if ([string]::IsNullOrWhiteSpace($result)) { return @() }
    return @($result -split '\|LCTSEP\|' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Save-AiCheckpoint([object]$illustrator, [string]$documentName) {
    $configuration = [ordered]@{
        operation = 'save'
        targetDocumentName = $documentName
        outputAi = ($OutputAi -replace '\\', '/')
    }
    $result = Invoke-CachedRuntime $illustrator $configuration
    if (-not $result.StartsWith('OK|')) { throw "AI checkpoint failed: $result" }
    $updatedName = Read-ResultValue $result 'documentName'
    return $(if ([string]::IsNullOrWhiteSpace($updatedName)) { $documentName } else { $updatedName })
}

function Export-FinalPng([object]$illustrator, [string]$documentName) {
    $configuration = [ordered]@{
        operation = 'export'
        targetDocumentName = $documentName
        outputPng = ($OutputPng -replace '\\', '/')
    }
    $result = Invoke-CachedRuntime $illustrator $configuration
    if (-not $result.StartsWith('OK|')) { throw "Final PNG export failed: $result" }
}

function Normalize-RootStackAndRemoveOrphans([object]$illustrator, [string]$documentName) {
    $configuration = [ordered]@{
        documentName = $documentName
        rootGroupName = [string]$state.root_group_name
        targetLayerName = $TargetLayerName
        batchGroupNames = @($state.batches | ForEach-Object { [string]$_.group_name })
    }
    $payload = ConvertTo-JsJson $configuration
    $script = @"
(function(){
  var c=$payload;
  function namedGroup(container,name){
    for(var i=0;i<container.groupItems.length;i+=1){
      try{var item=container.groupItems[i];if(item&&item.name===name){return item;}}catch(ignore){}
    }
    return null;
  }
  var doc=null;
  for(var d=0;d<app.documents.length;d+=1){if(app.documents[d].name===c.documentName){doc=app.documents[d];break;}}
  if(doc===null){return 'ERROR|TARGET_DOCUMENT_MISSING';}
  var root=namedGroup(doc,c.rootGroupName);
  if(root===null){return 'ERROR|ROOT_GROUP_MISSING';}
  var layer=null;
  if(c.targetLayerName){
    try{layer=doc.layers.getByName(c.targetLayerName);}catch(ignoreLayer){}
  }
  if(layer===null&&root.parent&&root.parent.typename==='Layer'){layer=root.parent;}
  if(layer===null){return 'ERROR|TARGET_LAYER_MISSING';}

  // Later source batches must remain above earlier batches. Rebuilding this
  // order also repairs any batch moved during a retry or a visual QA check.
  for(var b=0;b<c.batchGroupNames.length;b+=1){
    var batch=namedGroup(root,c.batchGroupNames[b]);
    if(batch!==null&&batch.parent===root){batch.zOrder(ZOrderMethod.BRINGTOFRONT);}
  }

  // Existing artwork is immutable. Never remove, hide, rename, or replace
  // any page item outside this job's root group.
  app.redraw();
  return 'OK|removed=0|existing_artwork_preserved=true';
}());
"@
    $result = [string]$illustrator.DoJavaScript($script)
    if (-not $result.StartsWith('OK|')) { throw "Final stack normalization failed: $result" }
}

function Assert-CompleteArtwork([object]$illustrator, [string]$documentName) {
    $batchExpectations = @()
    foreach ($batchState in $state.batches) {
        $paintNames = @()
        foreach ($atomIndex in $batchState.atom_indices) {
            $atom = $cache.atoms[[int]$atomIndex]
            if (@($atom.paintParts).Count -le 1) {
                $paintNames += [string]$atom.objectName
            } else {
                for ($paintIndex = 0; $paintIndex -lt @($atom.paintParts).Count; $paintIndex++) {
                    $paintNames += "$([string]$atom.objectName)_P$paintIndex"
                }
            }
        }
        $batchExpectations += [ordered]@{
            groupName = [string]$batchState.group_name
            paintNames = $paintNames
        }
    }
    $configuration = [ordered]@{
        documentName = $documentName
        rootGroupName = [string]$state.root_group_name
        batches = $batchExpectations
    }
    $payload = ConvertTo-JsJson $configuration
    $script = @"
(function(){
  var c=$payload;
  function namedGroup(container,name){
    for(var i=0;i<container.groupItems.length;i+=1){
      try{var item=container.groupItems[i];if(item&&item.name===name){return item;}}catch(ignore){}
    }
    return null;
  }
  function namedArtwork(container,name){
    var group=namedGroup(container,name);if(group!==null){return group;}
    var collections=[container.pathItems,container.compoundPathItems,container.textFrames];
    for(var q=0;q<collections.length;q+=1){
      for(var i=0;i<collections[q].length;i+=1){
        try{var item=collections[q][i];if(item&&item.name===name){return item;}}catch(ignore){}
      }
    }
    return null;
  }
  var doc=null;
  for(var d=0;d<app.documents.length;d+=1){if(app.documents[d].name===c.documentName){doc=app.documents[d];break;}}
  if(doc===null){return 'ERROR|TARGET_DOCUMENT_MISSING';}
  var root=namedGroup(doc,c.rootGroupName);
  if(root===null){return 'ERROR|ROOT_GROUP_MISSING';}
  var missing=0;
  for(var b=0;b<c.batches.length;b+=1){
    var batch=namedGroup(root,c.batches[b].groupName);
    if(batch===null){missing+=c.batches[b].paintNames.length;continue;}
    for(var a=0;a<c.batches[b].paintNames.length;a+=1){
      if(namedArtwork(batch,c.batches[b].paintNames[a])===null){missing+=1;}
    }
  }
  return 'OK|missing='+missing+'|placed='+root.placedItems.length+'|raster='+root.rasterItems.length;
}());
"@
    $result = [string]$illustrator.DoJavaScript($script)
    if (-not $result.StartsWith('OK|missing=0|placed=0|raster=0')) {
        throw "QA_FAILED|$result"
    }
}

# -AutoCanvasFromSvg：脚本自动建板（等价"等大画布"）；默认（无该开关）要求 AI 已开并画入活动文档。
# -AllowLaunch：仅与 -AutoCanvasFromSvg 搭配时允许经 COM 自启 AI（需用户已同意 agent 自动开 AI）。
if ($AutoCanvasFromSvg) {
    if (-not $AllowLaunch) { Assert-IllustratorAlreadyOpen }
} else {
    Assert-IllustratorAlreadyOpen
}
$illustrator = $null
$batchPayloadPath = Join-Path $workPath 'current-batch.json'
try {
    # 仅当 -AllowLaunch 时，COM 的 New-Object 才会被当作 Illustrator 启动器使用。
    # 保持这个 COM 代理贯穿整个绘制会话。
    $illustrator = New-Object -ComObject 'Illustrator.Application.CC.2019'
    if ([version]$illustrator.Version -lt [version]'23.0') {
        throw "Illustrator 2019 or newer is required; connected version is $($illustrator.Version)."
    }

    if ($AutoCanvasFromSvg) {
        # 新建与 Master SVG viewBox 等大的 RGB 文档（1px=1pt），画在其上 → 内容 1:1 落位。
        $targetDocumentName = New-EqualCanvasDocument $illustrator @($cache.view_box)
        # 等大画板下内容应 1:1 铺满画板，禁用默认的 0.72/0.78 收缩占幅。
        $MaxWidthFraction = 1.0
        $MaxHeightFraction = 1.0
    } else {
        if ($illustrator.Documents.Count -lt 1) {
            throw 'AI_DOCUMENT_REQUIRED|Open the target Illustrator document yourself before drawing.'
        }
        $targetDocumentName = [string]$illustrator.ActiveDocument.Name
    }
    $existingGroups = @(Get-ExistingBatchGroups $illustrator $targetDocumentName)
    $lastCheckpoint = [DateTime]::UtcNow
    $hasCheckpoint = Test-Path -LiteralPath $OutputAi
    $continued = $false

    foreach ($batchState in $state.batches) {
        $groupExists = $existingGroups -contains [string]$batchState.group_name
        if ([bool]$batchState.completed -and $groupExists) {
            $continued = $true
            if (-not $QuietExistingGroups) {
                Write-Output "SKIP|batch=$($batchState.index)|group=$($batchState.group_name)|reason=completed_group_is_immutable"
            }
            continue
        }
        if ([bool]$batchState.completed -and -not $groupExists) {
            $batchState.completed = $false
            $batchState.completed_at = $null
            $batchState.last_error = 'Recorded complete but the immutable batch group is missing.'
            Save-State $state
        }

        $atoms = @()
        foreach ($atomIndex in $batchState.atom_indices) {
            $atoms += $cache.atoms[[int]$atomIndex]
        }
        $payload = [ordered]@{ viewBox = $cache.view_box; atoms = $atoms }
        $utf8NoBom = New-Object Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($batchPayloadPath, (ConvertTo-JsJson $payload), $utf8NoBom)

        $configuration = [ordered]@{
            operation = 'draw'
            batchJsonPath = ($batchPayloadPath -replace '\\', '/')
            targetDocumentName = $targetDocumentName
            rootGroupName = [string]$state.root_group_name
            batchGroupName = [string]$batchState.group_name
            placement = $Placement
            maxWidthFraction = $MaxWidthFraction
            maxHeightFraction = $MaxHeightFraction
            delayMs = $DelayMs
            targetLayerName = $TargetLayerName
        }
        $result = $null
        for ($sessionAttempt = 1; $sessionAttempt -le $InSessionRetryLimit; $sessionAttempt++) {
            $batchState.attempts = [int]$batchState.attempts + 1
            $batchState.last_error = $null
            Save-State $state
            $result = Invoke-CachedRuntime $illustrator $configuration
            if ($result.StartsWith('OK|')) { break }

            $batchState.last_error = $result
            Save-State $state
            $unrecoverable = $result -match 'TARGET_DOCUMENT_MISSING|AI_DOCUMENT_REQUIRED|Unsupported operation'
            if ($unrecoverable -or $sessionAttempt -ge $InSessionRetryLimit) { break }
            Start-Sleep -Milliseconds 80
        }
        if (-not $result.StartsWith('OK|')) {
            $completed = @($state.batches | Where-Object { $_.completed }).Count
            Write-Output "RESUME_REQUIRED|failed_batch=$($batchState.index)|completed=$completed/$($state.batches.Count)|state=$statePath|existing_artwork_preserved=true"
            exit 2
        }

        $batchState.completed = $true
        $batchState.completed_at = [DateTime]::UtcNow.ToString('o')
        $batchState.last_error = $null
        Save-State $state
        $existingGroups += [string]$batchState.group_name
        Write-Output "DONE|batch=$($batchState.index)|group=$($batchState.group_name)|$result"

        $checkpointDue = -not $hasCheckpoint -or ([DateTime]::UtcNow - $lastCheckpoint).TotalSeconds -ge $CheckpointSeconds
        if ($checkpointDue) {
            $targetDocumentName = Save-AiCheckpoint $illustrator $targetDocumentName
            $lastCheckpoint = [DateTime]::UtcNow
            $hasCheckpoint = $true
        }
    }

    $completedCount = @($state.batches | Where-Object { $_.completed }).Count
    if ($completedCount -ne $state.batches.Count) { throw "QA_FAILED|completed=$completedCount/$($state.batches.Count)" }
    Normalize-RootStackAndRemoveOrphans $illustrator $targetDocumentName
    Assert-CompleteArtwork $illustrator $targetDocumentName
    $targetDocumentName = Save-AiCheckpoint $illustrator $targetDocumentName
    Export-FinalPng $illustrator $targetDocumentName
    if (-not (Test-Path -LiteralPath $OutputAi) -or -not (Test-Path -LiteralPath $OutputPng)) {
        throw 'QA_FAILED|The expected AI or final PNG file is missing.'
    }
    $mode = if ($continued) { 'continued' } else { 'fresh' }
    $canvas = if ($AutoCanvasFromSvg) { "canvas_from_svg=$($cache.view_box[2])x$($cache.view_box[3])" } else { 'used_active_document' }
    Write-Output "NATURE_VECT_REPLAY_COMPLETE|cache=$cachePath|ai=$OutputAi|png=$OutputPng|batches=$completedCount/$($state.batches.Count)|mode=$mode|$canvas|auto_canvas=$AutoCanvasFromSvg"
} finally {
    if (Test-Path -LiteralPath $batchPayloadPath) {
        Remove-Item -LiteralPath $batchPayloadPath -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $illustrator) {
        [Runtime.InteropServices.Marshal]::ReleaseComObject($illustrator) | Out-Null
    }
}
