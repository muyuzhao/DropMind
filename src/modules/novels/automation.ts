import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getNovelCodexProjectInfo } from "./codex-project";
import type { NovelWorkspaceData } from "./types";

export const AUTOMATION_NODE_DEFINITIONS = [
  { id: "volumes", label: "分卷大纲", kind: "volumes", startChapter: null, endChapter: null },
  { id: "settings", label: "核心设定", kind: "settings", startChapter: null, endChapter: null },
  ...[1, 11, 21, 31, 41, 51].map((start) => ({ id: `units-${start}`, label: `剧情单元 ${start}–${start + 9}`, kind: "units", startChapter: start, endChapter: start + 9 })),
  ...[1, 11, 21, 31, 41, 51].map((start) => ({ id: `outlines-${start}`, label: `分章大纲 ${start}–${start + 9}`, kind: "outlines", startChapter: start, endChapter: start + 9 })),
] as const;

export type AutomationNodeKind = "volumes" | "settings" | "units" | "outlines";
export type AutomationNodeStatus = "pending" | "running" | "completed" | "failed" | "paused" | "stale";
export type AutomationOverallStatus = "pending" | "running" | "paused" | "completed" | "failed" | "terminated" | "stale";

export type AutomationSnapshot = {
  referenceTitle: string;
  referenceSummary: string;
  selectedTopic: string;
  firstVolumeOutline: string;
  stepContent: Record<string, string>;
  templates: Record<string, string>;
  storyUnits: Record<string, string>;
};

export type AutomationNode = {
  id: string;
  label: string;
  kind: AutomationNodeKind;
  startChapter: number | null;
  endChapter: number | null;
  status: AutomationNodeStatus;
  attempts: number;
  maxAttempts: number;
  inputPath: string;
  inputHash: string;
  outputPath: string;
  logPath: string;
  imported: boolean;
  importedHash: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastDurationSeconds: number | null;
  failureReason: string | null;
};

export type AutomationManifest = {
  version: 1;
  runId: string;
  novelId: string;
  novelName: string;
  status: AutomationOverallStatus;
  currentNode: string | null;
  createdAt: string;
  updatedAt: string;
  inputHash: string;
  inputSummary: { selectedTopicCharacters: number; templates: string[]; referenceIncluded: boolean };
  snapshot: AutomationSnapshot;
  nodes: AutomationNode[];
  continuityPath: string;
  runner: { command: string; cliInvocation: string; proofStatus: "ready" | "unavailable"; scriptVersion?: number };
  failureReason: string | null;
};

export type AutomationControl = {
  action: "run" | "pause" | "terminate";
  mode: "all" | "retry-node";
  targetNodeId: string | null;
  requestedAt: string;
};

type AutomationOptions = { rootDir?: string; now?: () => Date; novelName?: string };
type AutomationImporter = {
  importAutomationNode(input: { novelId: string; kind: AutomationNodeKind; startChapter: number | null; content: string; firstVolumeOutline?: string }): void;
};

function iso(options: AutomationOptions = {}) {
  return (options.now?.() ?? new Date()).toISOString();
}

function durationSeconds(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return null;
  const milliseconds = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(milliseconds) ? Math.max(0, Math.round(milliseconds / 1000)) : null;
}

export const AUTOMATION_RUNNER_VERSION = 18;

function slash(value: string) {
  return value.replaceAll("\\", "/");
}

function hash(value: unknown) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function atomicWrite(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, content, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      const backupPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.bak`);
      let previousMoved = false;
      let replacementInstalled = false;
      try {
        if (fs.existsSync(filePath)) {
          fs.renameSync(filePath, backupPath);
          previousMoved = true;
        }
        fs.renameSync(temporaryPath, filePath);
        replacementInstalled = true;
        if (previousMoved) {
          try { fs.rmSync(backupPath, { force: true }); } catch { /* 新文件已经就位，残留备份可稍后清理 */ }
        }
        break;
      } catch (error) {
        if (!replacementInstalled && previousMoved && !fs.existsSync(filePath) && fs.existsSync(backupPath)) {
          try { fs.renameSync(backupPath, filePath); }
          catch (restoreError) { throw new Error(`文件替换失败且无法恢复原文件：${filePath}`, { cause: restoreError }); }
        }
        const code = error instanceof Error && "code" in error ? String(error.code) : "";
        if (!(["EPERM", "EBUSY", "EACCES"].includes(code)) || attempt >= 20) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      } finally {
        if (replacementInstalled && fs.existsSync(backupPath)) {
          try { fs.rmSync(backupPath, { force: true }); } catch { /* 不回滚已经成功的替换 */ }
        }
      }
    }
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function writeJson(filePath: string, value: unknown) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
}

function stepContent(workspace: NovelWorkspaceData, key: string) {
  return String(workspace.steps.find((row) => row.key === key)?.content ?? "");
}

function snapshotFor(workspace: NovelWorkspaceData): AutomationSnapshot {
  return {
    referenceTitle: String(workspace.novel.referenceTitle ?? ""),
    referenceSummary: String(workspace.novel.referenceSummary ?? ""),
    selectedTopic: String(workspace.novel.selectedTopic ?? ""),
    firstVolumeOutline: String(workspace.novel.firstVolumeOutline ?? ""),
    stepContent: {
      volumes: stepContent(workspace, "volumes"),
      settings: stepContent(workspace, "settings"),
    },
    templates: Object.fromEntries(workspace.templates.filter((row) => ["volumes", "settings", "units", "outlines"].includes(String(row.key))).map((row) => [String(row.key), String(row.template ?? "")])),
    storyUnits: Object.fromEntries(workspace.storyUnits.map((row) => [String(row.startChapter), String(row.content ?? "")])),
  };
}

function updateManifestInputSummary(manifest: AutomationManifest) {
  manifest.inputHash = hash(manifest.snapshot);
  manifest.inputSummary = {
    selectedTopicCharacters: manifest.snapshot.selectedTopic.trim().length,
    templates: Object.keys(manifest.snapshot.templates).sort(),
    referenceIncluded: Boolean(manifest.snapshot.referenceTitle || manifest.snapshot.referenceSummary),
  };
}

function writeNodeInputs(runDir: string, manifest: AutomationManifest, versionPaths = false) {
  const revision = randomUUID().slice(0, 8);
  manifest.nodes.forEach((node, index) => {
    if (versionPaths) {
      const extension = path.extname(node.inputPath);
      const base = node.inputPath.slice(0, -extension.length).replace(/\.[0-9a-f]{8}$/i, "");
      node.inputPath = slash(`${base}.${revision}${extension}`);
    }
    const prompt = buildNodePrompt(AUTOMATION_NODE_DEFINITIONS[index], index, manifest.snapshot);
    atomicWrite(path.join(runDir, node.inputPath), prompt);
    node.inputHash = hash(prompt);
  });
  writeJson(path.join(runDir, "inputs", "context.json"), manifest.snapshot);
}

function nodeOutputName(index: number, node: (typeof AUTOMATION_NODE_DEFINITIONS)[number]) {
  return `${String(index + 1).padStart(2, "0")}-${node.id}.md`;
}

function contextInstructions(node: (typeof AUTOMATION_NODE_DEFINITIONS)[number]) {
  const range = node.startChapter === null ? "" : `第${node.startChapter}-${node.endChapter}章`;
  if (node.kind === "volumes") return `生成完整的五卷分卷大纲。必须清楚包含“第1卷”到“第5卷”五个卷标题，并让第一卷覆盖第1-60章。`;
  if (node.kind === "settings") return "根据选题与刚生成的分卷大纲生成可直接用于后续写作的完整核心设定。";
  if (node.kind === "units") return `只生成${range}剧情单元，明确写出“${range}”，覆盖两个约五章的小单元，并衔接此前内容。`;
  return `只生成${range}分章大纲。必须依次使用“## 第${node.startChapter}章”到“## 第${node.endChapter}章”作为十个章节标题，每章包含本章核心、场景、剧情详解和结尾钩子。`;
}

function dependencyPaths(node: (typeof AUTOMATION_NODE_DEFINITIONS)[number]) {
  const paths: string[] = [];
  if (node.kind !== "volumes") paths.push("outputs/01-volumes.md");
  if (node.kind === "units" || node.kind === "outlines") paths.push("outputs/02-settings.md");
  if (node.kind === "units" || node.kind === "outlines") paths.push("outputs/continuity.md");
  if (node.kind === "units" && node.startChapter !== null && node.startChapter > 1) {
    const previousStart = node.startChapter - 10;
    const previousOutputNumber = 3 + Math.floor((previousStart - 1) / 10);
    paths.push(`outputs/${String(previousOutputNumber).padStart(2, "0")}-units-${previousStart}.md`);
  }
  if (node.kind === "outlines" && node.startChapter !== null) {
    const unitIndex = 3 + Math.floor((node.startChapter - 1) / 10);
    paths.push(`outputs/${String(unitIndex).padStart(2, "0")}-units-${node.startChapter}.md`);
    if (node.startChapter > 1) {
      const previousStart = node.startChapter - 10;
      const previousOutputNumber = 9 + Math.floor((previousStart - 1) / 10);
      paths.push(`outputs/${String(previousOutputNumber).padStart(2, "0")}-outlines-${previousStart}.md`);
    }
  }
  return paths;
}

function buildNodePrompt(node: (typeof AUTOMATION_NODE_DEFINITIONS)[number], index: number, snapshot: AutomationSnapshot) {
  const dependencyList = dependencyPaths(node);
  const dependencies = dependencyList.length > 0
    ? `## 只读上游文件\n\n请只读加载以下文件；连续性文件不存在时可以跳过：\n\n${dependencyList.map((item) => `- ${item}`).join("\n")}\n`
    : "";
  const topic = snapshot.selectedTopic.trim();
  const reference = snapshot.referenceTitle.trim() || snapshot.referenceSummary.trim()
    ? `## 参考作品\n\n书名：${snapshot.referenceTitle.trim() || "未提供"}\n\n简介：\n${snapshot.referenceSummary.trim() || "未提供"}\n\n仅参考题材卖点与节奏，不复用人物或情节。\n\n`
    : "";
  const currentRequirement = String(snapshot.templates[node.kind] ?? "").trim() || "按本次任务要求生成。";
  return `# DropMind 自动生成节点 ${index + 1}/14：${node.label}\n\n你是本地小说创作流水线中的单一生成节点。当前步骤只执行自己的创作模板；不读取、不考虑后续步骤的模板。\n\n${topic ? `## 已确认选题\n\n${topic}\n\n` : ""}${reference}## 当前步骤创作模板\n\n${currentRequirement}\n\n${dependencies}## 内容事实权威顺序\n\n1. 已确认选题。\n2. 分卷大纲输出。\n3. 核心设定输出。\n4. 更早批次的剧情单元和分章大纲。\n5. continuity.md 连续性记录。\n\n只需要继承当前步骤之前已经生成的上游内容，不需要预判后续步骤。如果较低级资料与较高级资料冲突，必须采用较高级事实，并在当前输出中自然统一称谓、身份和关系。不得停止生成，不得输出“无法生成”“请先明确”或要求用户澄清；将纠正结果记录到连续性摘要。\n\n## 本次任务\n\n${contextInstructions(node)}\n\n- 保持人物、目标、秘密、伏笔、时间线和冲突连续。\n- 除上述只读上游文件外，不读取其他资料；不修改文件，不操作数据库。\n- 最终回复先给出可直接导入 DropMind 的正文，不写过程说明。\n- 正文之后必须另起一行输出精确标记：<!-- DROPMIND_CONTINUITY -->\n- 标记后用 Markdown 更新连续性摘要，至少包含：人物当前位置和关系、当前人物目标、已公开秘密、未回收伏笔、时间线进度、当前冲突状态、必须避免的矛盾。\n`;
}

function runnerScript() {
  return `param()
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom
$PSDefaultParameterValues["*:Encoding"] = "UTF8"
$ErrorActionPreference = "Stop"
$RunDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ManifestPath = Join-Path $RunDir "manifest.json"
$ControlPath = Join-Path $RunDir "control.json"

function Read-JsonFile([string]$Path) {
  return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Save-JsonAtomic([string]$Path, $Value) {
  $Temporary = Join-Path (Split-Path -Parent $Path) ("." + (Split-Path -Leaf $Path) + "." + $PID + ".tmp")
  if ($Value.PSObject.Properties.Name -contains "updatedAt") { $Value.updatedAt = [DateTime]::UtcNow.ToString("o") }
  $Json = $Value | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText($Temporary, $Json + "\`n", $Utf8NoBom)
  if (Test-Path -LiteralPath $Path) {
    $Backup = $Path + ".replace-backup." + $PID
    [IO.File]::Replace($Temporary, $Path, $Backup)
    Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue
  } else { [IO.File]::Move($Temporary, $Path) }
}

function Save-TextAtomic([string]$Path, [string]$Content) {
  $Directory = Split-Path -Parent $Path
  [IO.Directory]::CreateDirectory($Directory) | Out-Null
  $Temporary = Join-Path $Directory ("." + (Split-Path -Leaf $Path) + "." + $PID + ".tmp")
  [IO.File]::WriteAllText($Temporary, $Content, [Text.UTF8Encoding]::new($false))
  if (Test-Path -LiteralPath $Path) {
    $Backup = $Path + ".replace-backup." + $PID
    [IO.File]::Replace($Temporary, $Path, $Backup)
    Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue
  } else { [IO.File]::Move($Temporary, $Path) }
}

function Assert-GeneratedOutput($Node, [string]$Content) {
  $Trimmed = $Content.Trim()
  if (-not $Trimmed) { throw ($Node.label + "输出为空") }
  $OpeningLength = [Math]::Min(1200, $Trimmed.Length)
  $DiagnosticOpening = $Trimmed.Substring(0, $OpeningLength)
  if ($DiagnosticOpening -match "(?:无法|不能)(?:继续)?生成|上游资料[^\\r\\n]{0,80}冲突|请先(?:明确|确认|统一)") {
    throw ($Node.label + "返回了冲突诊断而不是可导入内容")
  }
  if ($Node.kind -eq "volumes") {
    for ($Volume = 1; $Volume -le 5; $Volume++) {
      if ($Trimmed -notmatch ("第\\s*" + $Volume + "\\s*卷")) { throw ("分卷大纲缺少第" + $Volume + "卷") }
    }
  }
  if ($Node.kind -eq "units" -and $null -ne $Node.startChapter) {
    $RangePattern = "第\\s*" + $Node.startChapter + "\\s*[-–—至到]\\s*" + $Node.endChapter + "\\s*章"
    if ($Trimmed -notmatch $RangePattern) { throw ($Node.label + "未标明正确章节范围") }
  }
  if ($Node.kind -eq "outlines" -and $null -ne $Node.startChapter) {
    for ($Chapter = [int]$Node.startChapter; $Chapter -le [int]$Node.endChapter; $Chapter++) {
      $ChapterPattern = "(?m)(?:^|\\n)#{1,3}\\s*第\\s*" + $Chapter + "\\s*章(?:\\s|$)"
      if ($Trimmed -notmatch $ChapterPattern) { throw ($Node.label + "缺少章节标题：## 第" + $Chapter + "章") }
    }
  }
}

function Stop-ForControl($Manifest) {
  $Control = Read-JsonFile $ControlPath
  if ($Control.action -eq "terminate") {
    $Manifest.status = "terminated"
    $Manifest.currentNode = $null
    $Manifest.failureReason = "用户终止；已完成输出已保留"
    Save-JsonAtomic $ManifestPath $Manifest
    return $true
  }
  if ($Control.action -eq "pause") {
    $Manifest.status = "paused"
    $Manifest.currentNode = $null
    $PausedNode = $Manifest.nodes | Where-Object { $_.status -eq "pending" -or $_.status -eq "stale" } | Select-Object -First 1
    if ($PausedNode) { $PausedNode.status = "paused" }
    Save-JsonAtomic $ManifestPath $Manifest
    return $true
  }
  return $false
}

$Manifest = Read-JsonFile $ManifestPath
$Control = Read-JsonFile $ControlPath
if ($Control.action -ne "run") {
  Write-Host "任务未处于运行状态。请先在 DropMind 中点击继续或重试。"
  exit 2
}

$ConfiguredCodex = [Environment]::GetEnvironmentVariable("CODEX_CLI_PATH")
$NpmCodex = if ($env:APPDATA) { Join-Path (Join-Path $env:APPDATA "npm") "codex.cmd" } else { $null }
$NpmModules = if ($env:APPDATA) { Join-Path (Join-Path (Join-Path $env:APPDATA "npm") "node_modules") "@openai" } else { $null }
$CodexPackageModules = if ($NpmModules) { Join-Path (Join-Path $NpmModules "codex") "node_modules" } else { $null }
$NpmNativeCodex = if ($CodexPackageModules -and (Test-Path -LiteralPath $CodexPackageModules)) {
  Get-ChildItem -LiteralPath $CodexPackageModules -Recurse -File -Filter "codex.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
} else { $null }
if ($ConfiguredCodex) { $CodexPath = $ConfiguredCodex }
elseif ($NpmNativeCodex) { $CodexPath = $NpmNativeCodex.FullName }
elseif ($NpmCodex -and (Test-Path -LiteralPath $NpmCodex)) { $CodexPath = $NpmCodex }
else {
  $CodexCommand = Get-Command codex -ErrorAction SilentlyContinue
  if (-not $CodexCommand) {
    $Manifest.status = "failed"
    $Manifest.failureReason = "找不到 Codex CLI。请安装或将 CODEX_CLI_PATH 指向 codex.exe。"
    Save-JsonAtomic $ManifestPath $Manifest
    Write-Error $Manifest.failureReason
    exit 3
  }
  $CodexPath = $CodexCommand.Source
}

$Manifest.status = "running"
$Manifest.failureReason = $null
$Manifest.runner.proofStatus = "ready"
Save-JsonAtomic $ManifestPath $Manifest

foreach ($Node in $Manifest.nodes) {
  $Control = Read-JsonFile $ControlPath
  if ($Control.mode -eq "retry-node" -and $Node.id -ne $Control.targetNodeId) { continue }
  if ($Node.status -eq "completed") { continue }
  if (Stop-ForControl $Manifest) { exit 0 }

  while ($Node.attempts -lt $Node.maxAttempts -and $Node.status -ne "completed") {
    $Node.status = "running"
    $Node.imported = $false
    $Node.attempts = [int]$Node.attempts + 1
    $Node.startedAt = [DateTime]::UtcNow.ToString("o")
    $Node.lastDurationSeconds = $null
    $Node.failureReason = $null
    $Manifest.failureReason = $null
    $Manifest.status = "running"
    $Manifest.currentNode = $Node.id
    Save-JsonAtomic $ManifestPath $Manifest

    $PromptPath = Join-Path $RunDir ($Node.inputPath -replace '/', [IO.Path]::DirectorySeparatorChar)
    $OutputPath = Join-Path $RunDir ($Node.outputPath -replace '/', [IO.Path]::DirectorySeparatorChar)
    $LogPath = Join-Path $RunDir ($Node.logPath -replace '/', [IO.Path]::DirectorySeparatorChar)
    $OutputTemporary = $OutputPath + ".codex." + $PID + ".tmp"
    $StdoutTemporary = $LogPath + ".stdout." + $PID + ".tmp"
    $StderrTemporary = $LogPath + ".stderr." + $PID + ".tmp"
    $CommandOutput = ""
    $Stopwatch = $null
    try {
      # Keep native stdout/stderr outside PowerShell's error stream. Windows
      # PowerShell 5.1 can otherwise promote Codex's normal stderr banner to a
      # terminating NativeCommandError before the manifest and log are updated.
      $CommandLine = '""' + $CodexPath + '" exec -C "' + $RunDir + '" --sandbox read-only --skip-git-repo-check -c model_reasoning_effort=medium --json --output-last-message "' + $OutputTemporary + '" - < "' + $PromptPath + '" > "' + $StdoutTemporary + '" 2> "' + $StderrTemporary + '""'
      Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] 开始调用 Codex：" + $Node.label + "（尝试 " + $Node.attempts + "/" + $Node.maxAttempts + "）")
      Write-Host "Codex 正在工作，请勿关闭此窗口；每 15 秒会显示一次运行状态。"
      $ProcessInfo = New-Object System.Diagnostics.ProcessStartInfo
      $ProcessInfo.FileName = $env:ComSpec
      $ProcessInfo.Arguments = "/d /s /c " + $CommandLine
      $ProcessInfo.UseShellExecute = $false
      $ProcessInfo.CreateNoWindow = $true
      $CodexProcess = [System.Diagnostics.Process]::Start($ProcessInfo)
      $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
      $DisplayedStdoutLines = 0
      $DisplayedStderrLines = 0
      $NextHeartbeatAt = 15
      while (-not $CodexProcess.WaitForExit(500)) {
        [string[]]$StdoutLines = if (Test-Path -LiteralPath $StdoutTemporary) { Get-Content -LiteralPath $StdoutTemporary -Encoding UTF8 -ErrorAction SilentlyContinue } else { @() }
        if ($StdoutLines.Count -lt $DisplayedStdoutLines) { $DisplayedStdoutLines = 0 }
        for ($LineIndex = $DisplayedStdoutLines; $LineIndex -lt $StdoutLines.Count; $LineIndex++) {
          Write-Host ("[Codex] " + $StdoutLines[$LineIndex]) -ForegroundColor Cyan
        }
        $DisplayedStdoutLines = $StdoutLines.Count
        [string[]]$StderrLines = if (Test-Path -LiteralPath $StderrTemporary) { Get-Content -LiteralPath $StderrTemporary -Encoding UTF8 -ErrorAction SilentlyContinue } else { @() }
        if ($StderrLines.Count -lt $DisplayedStderrLines) { $DisplayedStderrLines = 0 }
        for ($LineIndex = $DisplayedStderrLines; $LineIndex -lt $StderrLines.Count; $LineIndex++) {
          Write-Host ("[Codex stderr] " + $StderrLines[$LineIndex]) -ForegroundColor DarkYellow
        }
        $DisplayedStderrLines = $StderrLines.Count
        $ElapsedSeconds = [Math]::Floor($Stopwatch.Elapsed.TotalSeconds)
        if ($ElapsedSeconds -ge $NextHeartbeatAt) {
          Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] 仍在生成 [" + [string]$Node.label + "] · 已运行 " + $ElapsedSeconds + " 秒 · 已显示 " + $DisplayedStdoutLines + " 个 CLI 事件")
          $NextHeartbeatAt += 15
        }
      }
      $CodexProcess.WaitForExit()
      [string[]]$StdoutLines = if (Test-Path -LiteralPath $StdoutTemporary) { Get-Content -LiteralPath $StdoutTemporary -Encoding UTF8 -ErrorAction SilentlyContinue } else { @() }
      for ($LineIndex = $DisplayedStdoutLines; $LineIndex -lt $StdoutLines.Count; $LineIndex++) { Write-Host ("[Codex] " + $StdoutLines[$LineIndex]) -ForegroundColor Cyan }
      [string[]]$StderrLines = if (Test-Path -LiteralPath $StderrTemporary) { Get-Content -LiteralPath $StderrTemporary -Encoding UTF8 -ErrorAction SilentlyContinue } else { @() }
      for ($LineIndex = $DisplayedStderrLines; $LineIndex -lt $StderrLines.Count; $LineIndex++) { Write-Host ("[Codex stderr] " + $StderrLines[$LineIndex]) -ForegroundColor DarkYellow }
      $Stopwatch.Stop()
      $Node.lastDurationSeconds = [Math]::Max(0, [Math]::Round($Stopwatch.Elapsed.TotalSeconds))
      $ExitCode = $CodexProcess.ExitCode
      Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] Codex 已返回，正在校验输出（退出状态 " + $ExitCode + "）")
      $Stdout = ""
      $Stderr = ""
      if (Test-Path -LiteralPath $StdoutTemporary) { $Stdout = [string](Get-Content -LiteralPath $StdoutTemporary -Raw -Encoding UTF8) }
      if (Test-Path -LiteralPath $StderrTemporary) { $Stderr = [string](Get-Content -LiteralPath $StderrTemporary -Raw -Encoding UTF8) }
      $CommandOutput = ((([string]$Stdout).TrimEnd(), ([string]$Stderr).TrimEnd()) | Where-Object { $_ }) -join "\`n"
      Save-TextAtomic $LogPath ($CommandOutput + "\`n退出状态：" + $ExitCode + "\`n")
      if ($ExitCode -ne 0) { throw "Codex CLI 退出状态为 $ExitCode" }
      if (-not (Test-Path -LiteralPath $OutputTemporary)) { throw "Codex CLI 未生成最终回复文件" }
      $Raw = Get-Content -LiteralPath $OutputTemporary -Raw -Encoding UTF8
      $Marker = "<!-- DROPMIND_CONTINUITY -->"
      $IsStructuredChapter = ([string]$Manifest.kind -eq "chapters" -and [int]$Manifest.version -ge 3)
      $ChapterEvent = ""
      $ContinuityUpdate = ""
      if ($IsStructuredChapter) {
        $EventMarker = "<!-- DROPMIND_CHAPTER_EVENT -->"
        $EventParts = $Raw -split [regex]::Escape($EventMarker), 2
        if ($EventParts.Count -lt 2) { throw "正文输出缺少章节连续性事件标记" }
        $StateParts = $EventParts[1] -split [regex]::Escape($Marker), 2
        if ($StateParts.Count -lt 2) { throw "正文输出缺少连续性状态标记" }
        $Primary = $EventParts[0].Trim()
        $ChapterEvent = $StateParts[0].Trim()
        $ContinuityUpdate = $StateParts[1].Trim()
        if (-not $ChapterEvent) { throw "章节连续性事件为空" }
        if (-not ($ContinuityUpdate.StartsWith('# 正文连续性状态'))) { throw '连续性状态必须以 Markdown 一级标题开头' }
        if ($ContinuityUpdate.Length -gt 5000) { throw "连续性状态超过5000字符" }
        $ChapterMarker = "<!-- DROPMIND_STATE_THROUGH: " + [string]$Node.chapterNumber + " -->"
        if (-not ($ContinuityUpdate.Contains($ChapterMarker))) { throw "连续性状态未标明当前章节" }
        $RequiredSections = @("当前时空", "活跃人物状态与知情差", "未解决线索", "硬事实", "下一章交接")
        $ActualSections = @([regex]::Matches($ContinuityUpdate, '(?m)^##[ \t]+([^\r\n]+?)[ \t]*$') | ForEach-Object { $_.Groups[1].Value.Trim() })
        if (($ActualSections.Count -ne $RequiredSections.Count) -or (($ActualSections -join "|") -ne ($RequiredSections -join "|"))) {
          throw "连续性状态必须依次且仅包含五个规定栏目"
        }
        $HandoffMatch = [regex]::Match($ContinuityUpdate, '(?ms)^##[ \t]+下一章交接[ \t]*\r?\n(.*)$')
        $HandoffCount = if ($HandoffMatch.Success) { @([regex]::Matches($HandoffMatch.Groups[1].Value, '(?m)^[ \t]*[-*+][ \t]+')).Count } else { 0 }
        if ($HandoffCount -gt 6) { throw "连续性状态的下一章交接不得超过6条" }
      } else {
        $Parts = $Raw -split [regex]::Escape($Marker), 2
        $Primary = $Parts[0].Trim()
      }
      Assert-GeneratedOutput $Node $Primary
      Save-TextAtomic $OutputPath ($Primary + "\`n")

      $ContinuityPath = Join-Path $RunDir ($Manifest.continuityPath -replace '/', [IO.Path]::DirectorySeparatorChar)
      if ($IsStructuredChapter) {
        $ChapterFileName = "第" + ([int]$Node.chapterNumber).ToString("000") + "章.md"
        $EventDirectory = if ($Manifest.continuityEventsDir) { [string]$Manifest.continuityEventsDir } else { "outputs/continuity-events" }
        $StateDirectory = if ($Manifest.continuityStatesDir) { [string]$Manifest.continuityStatesDir } else { "outputs/continuity-states" }
        Save-TextAtomic (Join-Path $RunDir (($EventDirectory + "/" + $ChapterFileName) -replace '/', [IO.Path]::DirectorySeparatorChar)) ($ChapterEvent + "\`n")
        Save-TextAtomic (Join-Path $RunDir (($StateDirectory + "/" + $ChapterFileName) -replace '/', [IO.Path]::DirectorySeparatorChar)) ($ContinuityUpdate + "\`n")
        Save-TextAtomic $ContinuityPath ($ContinuityUpdate + "\`n")
      } else {
        $PreviousContinuity = if (Test-Path -LiteralPath $ContinuityPath) { Get-Content -LiteralPath $ContinuityPath -Raw -Encoding UTF8 } else { "# 连续性记录\`n" }
        $ContinuityUpdate = if ($Parts.Count -gt 1 -and $Parts[1].Trim()) { $Parts[1].Trim() } else { "（本节点未返回结构化连续性摘要，请在后续节点结合主输出核对。）" }
        Save-TextAtomic $ContinuityPath ($PreviousContinuity.TrimEnd() + "\`n\`n## " + $Node.label + "\`n\`n" + $ContinuityUpdate + "\`n")
      }
      Remove-Item -LiteralPath $OutputTemporary, $StdoutTemporary, $StderrTemporary -Force -ErrorAction SilentlyContinue

      $Node.status = "completed"
      $Node.completedAt = [DateTime]::UtcNow.ToString("o")
      $Node.failureReason = $null
      $Manifest.failureReason = $null
      Save-JsonAtomic $ManifestPath $Manifest
      Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] 已完成：" + $Node.label) -ForegroundColor Green
    } catch {
      $CaughtError = $_
      if ($null -ne $Stopwatch) {
        if ($Stopwatch.IsRunning) { $Stopwatch.Stop() }
        $Node.lastDurationSeconds = [Math]::Max(0, [Math]::Round($Stopwatch.Elapsed.TotalSeconds))
      } elseif ($Node.startedAt) {
        $Node.lastDurationSeconds = [Math]::Max(0, [Math]::Round(([DateTime]::UtcNow - [DateTime]::Parse($Node.startedAt)).TotalSeconds))
      }
      if (-not $CommandOutput) {
        $Stdout = ""
        $Stderr = ""
        if (Test-Path -LiteralPath $StdoutTemporary) { $Stdout = [string](Get-Content -LiteralPath $StdoutTemporary -Raw -Encoding UTF8) }
        if (Test-Path -LiteralPath $StderrTemporary) { $Stderr = [string](Get-Content -LiteralPath $StderrTemporary -Raw -Encoding UTF8) }
        $CommandOutput = ((([string]$Stdout).TrimEnd(), ([string]$Stderr).TrimEnd()) | Where-Object { $_ }) -join "\`n"
      }
      $Diagnostic = ($CommandOutput.Trim() + "\`n异常：" + $CaughtError.Exception.Message).Trim()
      try { Save-TextAtomic $LogPath ($Diagnostic + "\`n") } catch { }
      Remove-Item -LiteralPath $OutputTemporary, $StdoutTemporary, $StderrTemporary -Force -ErrorAction SilentlyContinue
      $Node.status = "failed"
      $Node.failureReason = $CaughtError.Exception.Message
      $Manifest.failureReason = $Node.failureReason
      Save-JsonAtomic $ManifestPath $Manifest
      Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] 生成失败：" + $Node.label + " · " + $CaughtError.Exception.Message) -ForegroundColor Red
      if ($Node.attempts -lt $Node.maxAttempts) { continue }
    }
  }

  if ($Node.status -ne "completed") {
    $Manifest.status = "failed"
    $Manifest.currentNode = $Node.id
    Save-JsonAtomic $ManifestPath $Manifest
    exit 1
  }

  $Control = Read-JsonFile $ControlPath
  if ($Control.mode -eq "retry-node") {
    $Control.action = "pause"
    $Control.mode = "all"
    $Control.targetNodeId = $null
    Save-JsonAtomic $ControlPath $Control
    $Manifest.status = "paused"
    $Manifest.currentNode = $null
    Save-JsonAtomic $ManifestPath $Manifest
    exit 0
  }
  if (Stop-ForControl $Manifest) { exit 0 }
}

$Remaining = @($Manifest.nodes | Where-Object { $_.status -ne "completed" })
$Manifest.status = if ($Remaining.Count -eq 0) { "completed" } else { "paused" }
$Manifest.currentNode = $null
$Manifest.failureReason = $null
Save-JsonAtomic $ManifestPath $Manifest
Write-Host "DropMind 自动生成流水线执行完成。请返回工作台导入结果。"
`;
}

function cmdScript() {
  return "@echo off\r\nsetlocal\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"%~dp0run-pipeline.ps1\"\r\nset EXIT_CODE=%ERRORLEVEL%\r\necho.\r\necho Exit code: %EXIT_CODE%\r\npause\r\nexit /b %EXIT_CODE%\r\n";
}

export function automationRunnerDefinition(runDir: string) {
  return {
    command: `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "${path.join(runDir, "run-pipeline.ps1")}"`,
    cliInvocation: "codex exec -C <run-dir> --sandbox read-only --skip-git-repo-check -c model_reasoning_effort=medium --json --output-last-message <temp-output> -",
    proofStatus: "unavailable" as const,
    scriptVersion: AUTOMATION_RUNNER_VERSION,
  };
}

export function writeAutomationRunnerFiles(runDir: string) {
  atomicWrite(path.join(runDir, "run-pipeline.ps1"), `\uFEFF${runnerScript()}`);
  atomicWrite(path.join(runDir, "run-pipeline.cmd"), cmdScript());
}

function runId(now: Date) {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomUUID().slice(0, 8)}`;
}

function formalContent(row: { content?: unknown; isDraft?: unknown } | undefined) {
  return row && !Boolean(row.isDraft) ? String(row.content ?? "").trim() : "";
}

function existingAutomationNodeContent(workspace: NovelWorkspaceData, node: AutomationNode) {
  if (node.kind === "volumes" || node.kind === "settings") {
    return formalContent(workspace.steps.find((row) => row.key === node.kind));
  }
  if (node.startChapter === null) return "";
  if (node.kind === "units") return formalContent(workspace.storyUnits.find((row) => Number(row.startChapter) === node.startChapter));
  const rows = workspace.chapterOutlines.filter((row) => Number(row.chapterNumber) >= node.startChapter! && Number(row.chapterNumber) <= node.endChapter!);
  if (rows.length !== 10 || rows.some((row) => !formalContent(row))) return "";
  return formalContent(rows.find((row) => Number(row.chapterNumber) === node.startChapter));
}

export function seedAutomationRunFromWorkspace(runDir: string, manifest: AutomationManifest, workspace: NovelWorkspaceData, options: AutomationOptions = {}) {
  if (String(workspace.novel.id) !== manifest.novelId) throw new Error("任务与当前小说不匹配");
  const clean = ["pending", "paused"].includes(manifest.status)
    && manifest.nodes.every((node) => node.attempts === 0 && !node.imported && (node.status === "pending" || node.status === "paused"));
  if (!clean) return 0;

  manifest.snapshot = snapshotFor(workspace);
  updateManifestInputSummary(manifest);
  writeNodeInputs(runDir, manifest);
  let seededCount = 0;
  for (const node of manifest.nodes) {
    const content = existingAutomationNodeContent(workspace, node);
    if (!content) break;
    atomicWrite(path.join(runDir, node.outputPath), `${content}\n`);
    node.status = "completed";
    node.imported = true;
    node.importedHash = hash(content);
    node.completedAt = manifest.createdAt;
    node.lastDurationSeconds = 0;
    node.failureReason = null;
    seededCount += 1;
  }
  const seededLabels = manifest.nodes.slice(0, seededCount).map((node) => `- ${node.label}`).join("\n");
  atomicWrite(path.join(runDir, manifest.continuityPath), seededCount
    ? `# 连续性记录\n\n## 从工作台正式内容接续\n\n以下节点沿用已确认内容；下游节点应读取对应 outputs 文件核对原文：\n\n${seededLabels}\n`
    : "# 连续性记录\n");
  manifest.status = seededCount === manifest.nodes.length ? "completed" : manifest.status;
  manifest.currentNode = null;
  manifest.failureReason = null;
  saveManifest(runDir, manifest, options);
  return seededCount;
}

export function createAutomationRun(workspace: NovelWorkspaceData, options: AutomationOptions = {}) {
  const selectedTopic = String(workspace.novel.selectedTopic ?? "").trim();
  if (!selectedTopic) throw new Error("请先完成并保存第一步最终选题");
  const now = options.now?.() ?? new Date();
  const id = runId(now);
  const project = getNovelCodexProjectInfo(workspace, { rootDir: options.rootDir });
  const runDir = path.join(project.projectDir, "自动生成", id);
  const snapshot = snapshotFor(workspace);
  const prompts = AUTOMATION_NODE_DEFINITIONS.map((node, index) => buildNodePrompt(node, index, snapshot));
  const createdAt = now.toISOString();
  const nodes: AutomationNode[] = AUTOMATION_NODE_DEFINITIONS.map((node, index) => {
    const outputName = nodeOutputName(index, node);
    const inputPath = slash(path.join("inputs", `${String(index + 1).padStart(2, "0")}-${node.id}.md`));
    return {
      ...node,
      kind: node.kind as AutomationNodeKind,
      status: "pending",
      attempts: 0,
      maxAttempts: 2,
      inputPath,
      inputHash: hash(prompts[index]),
      outputPath: slash(path.join("outputs", outputName)),
      logPath: slash(path.join("logs", outputName.replace(/\.md$/, ".log"))),
      imported: false,
      importedHash: null,
      startedAt: null,
      completedAt: null,
      lastDurationSeconds: null,
      failureReason: null,
    };
  });
  const manifest: AutomationManifest = {
    version: 1,
    runId: id,
    novelId: String(workspace.novel.id),
    novelName: String(workspace.novel.name),
    status: "pending",
    currentNode: null,
    createdAt,
    updatedAt: createdAt,
    inputHash: hash(snapshot),
    inputSummary: { selectedTopicCharacters: selectedTopic.length, templates: Object.keys(snapshot.templates).sort(), referenceIncluded: Boolean(snapshot.referenceTitle || snapshot.referenceSummary) },
    snapshot,
    nodes,
    continuityPath: "outputs/continuity.md",
    runner: automationRunnerDefinition(runDir),
    failureReason: null,
  };
  const control: AutomationControl = { action: "run", mode: "all", targetNodeId: null, requestedAt: createdAt };

  fs.mkdirSync(path.join(runDir, "inputs"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "outputs"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  writeJson(path.join(runDir, "inputs", "context.json"), snapshot);
  nodes.forEach((node, index) => atomicWrite(path.join(runDir, node.inputPath), prompts[index]));
  atomicWrite(path.join(runDir, "outputs", "continuity.md"), "# 连续性记录\n");
  // Windows PowerShell 5.1 needs a BOM to parse non-ASCII script literals reliably.
  writeAutomationRunnerFiles(runDir);
  writeJson(path.join(runDir, "control.json"), control);
  writeJson(path.join(runDir, "manifest.json"), manifest);
  const seededCount = seedAutomationRunFromWorkspace(runDir, manifest, workspace, options);
  return { runDir, manifest, control, seededCount };
}

export function refreshAutomationRunnerFiles(runDir: string, manifest: AutomationManifest, options: AutomationOptions = {}) {
  if (manifest.status === "running") return false;
  let changed = false;
  const runnerCommand = automationRunnerDefinition(runDir).command;
  if (manifest.runner.command !== runnerCommand) {
    manifest.runner.command = runnerCommand;
    changed = true;
  }
  if (options.novelName !== undefined && manifest.novelName !== options.novelName) {
    manifest.novelName = options.novelName;
    changed = true;
  }
  for (const node of manifest.nodes) {
    if (Object.prototype.hasOwnProperty.call(node, "lastDurationSeconds")) continue;
    node.lastDurationSeconds = durationSeconds(node.startedAt, node.completedAt ?? manifest.updatedAt);
    changed = true;
  }
  const interruptedNodes = manifest.nodes.filter((node) => node.status === "running");
  if (interruptedNodes.length > 0) {
    for (const node of interruptedNodes) {
      node.status = "failed";
      node.failureReason ||= "上次运行异常中断，请单独重试。";
      node.lastDurationSeconds = durationSeconds(node.startedAt, iso(options));
    }
    manifest.status = "failed";
    manifest.currentNode = interruptedNodes[0].id;
    manifest.failureReason ||= `${interruptedNodes[0].label}上次运行异常中断，请单独重试。`;
    changed = true;
  }
  manifest.nodes.forEach((node, index) => {
    const prompt = buildNodePrompt(AUTOMATION_NODE_DEFINITIONS[index], index, manifest.snapshot);
    const promptHash = hash(prompt);
    const promptPath = path.join(runDir, node.inputPath);
    const diskHash = fs.existsSync(promptPath) ? hash(fs.readFileSync(promptPath, "utf8")) : "";
    if (node.inputHash !== promptHash || diskHash !== promptHash) {
      atomicWrite(promptPath, prompt);
      node.inputHash = promptHash;
      changed = true;
    }
  });
  if (manifest.runner.scriptVersion !== AUTOMATION_RUNNER_VERSION) {
    writeAutomationRunnerFiles(runDir);
    manifest.runner.scriptVersion = AUTOMATION_RUNNER_VERSION;
    manifest.runner.cliInvocation = "codex exec -C <run-dir> --sandbox read-only --skip-git-repo-check -c model_reasoning_effort=medium --json --output-last-message <temp-output> -";
    changed = true;
  }
  if (changed) saveManifest(runDir, manifest, options);
  return changed;
}

export function listAutomationRuns(workspace: NovelWorkspaceData, options: AutomationOptions = {}) {
  const project = getNovelCodexProjectInfo(workspace, { rootDir: options.rootDir });
  const automationDir = path.join(project.projectDir, "自动生成");
  if (!fs.existsSync(automationDir)) return [];
  return fs.readdirSync(automationDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(automationDir, entry.name, "manifest.json")))
    .map((entry) => {
      const runDir = path.join(automationDir, entry.name);
      return { runDir, manifest: readJson<AutomationManifest>(path.join(runDir, "manifest.json")) };
    })
    .filter((item) => item.manifest.novelId === String(workspace.novel.id))
    .sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt));
}

export function getLatestAutomationRun(workspace: NovelWorkspaceData, options: AutomationOptions = {}) {
  return listAutomationRuns(workspace, options)[0] ?? null;
}

function saveManifest(runDir: string, manifest: AutomationManifest, options: AutomationOptions = {}) {
  manifest.updatedAt = iso(options);
  writeJson(path.join(runDir, "manifest.json"), manifest);
}

function firstChangedSource(manifest: AutomationManifest, workspace: NovelWorkspaceData) {
  const current = snapshotFor(workspace);
  const original = manifest.snapshot;
  if (current.referenceTitle !== original.referenceTitle || current.referenceSummary !== original.referenceSummary || current.selectedTopic !== original.selectedTopic || current.templates.volumes !== original.templates.volumes) return 0;
  if (current.stepContent.volumes !== original.stepContent.volumes || current.firstVolumeOutline !== original.firstVolumeOutline || current.templates.settings !== original.templates.settings) return 1;
  if (current.stepContent.settings !== original.stepContent.settings || current.templates.units !== original.templates.units) return 2;
  if (current.templates.outlines !== original.templates.outlines) return 8;
  for (const start of [1, 11, 21, 31, 41, 51]) {
    if ((current.storyUnits[String(start)] ?? "") !== (original.storyUnits[String(start)] ?? "")) return 8 + Math.floor((start - 1) / 10);
  }
  return null;
}

function markStaleFrom(manifest: AutomationManifest, index: number) {
  for (let current = index; current < manifest.nodes.length; current += 1) {
    const node = manifest.nodes[current];
    if (node.status === "completed" || node.status === "paused") node.status = "stale";
  }
  if (manifest.status === "completed") manifest.status = "stale";
}

export function reconcileAutomationStaleness(runDir: string, manifest: AutomationManifest, workspace: NovelWorkspaceData, options: AutomationOptions = {}) {
  const changedIndex = firstChangedSource(manifest, workspace);
  if (changedIndex !== null) {
    markStaleFrom(manifest, changedIndex);
    manifest.failureReason = `检测到上游正式内容变化，请从“${manifest.nodes[changedIndex].label}”重新生成`;
    saveManifest(runDir, manifest, options);
  }
  return changedIndex;
}

function extractFirstVolume(content: string) {
  const match = content.match(/(?:^|\n)(#{0,3}\s*)?第\s*1\s*卷[\s\S]*?(?=(?:\n#{0,3}\s*)?第\s*2\s*卷|$)/i);
  return match?.[0].trim() || content.trim();
}

export function validateAutomationOutput(node: AutomationNode, content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error(`${node.label}输出为空`);
  const diagnosticOpening = trimmed.slice(0, 1200);
  if (/(?:无法|不能)(?:继续)?生成|上游资料[^\n]{0,80}冲突|请先(?:明确|确认|统一)/.test(diagnosticOpening)) throw new Error(`${node.label}返回了冲突诊断而不是可导入内容`);
  if (node.kind === "volumes") {
    for (let volume = 1; volume <= 5; volume += 1) if (!new RegExp(`第\\s*${volume}\\s*卷`).test(trimmed)) throw new Error(`分卷大纲缺少第${volume}卷`);
  }
  if (node.kind === "units" && node.startChapter !== null && !new RegExp(`第\\s*${node.startChapter}\\s*[-–—至到]\\s*${node.endChapter}\\s*章`).test(trimmed)) throw new Error(`${node.label}未标明正确章节范围`);
  if (node.kind === "outlines" && node.startChapter !== null) {
    for (let chapter = node.startChapter; chapter <= (node.endChapter ?? node.startChapter); chapter += 1) {
      if (!new RegExp(`(?:^|\\n)#{1,3}\\s*第\\s*${chapter}\\s*章(?:\\s|$)`, "m").test(trimmed)) throw new Error(`${node.label}缺少“## 第${chapter}章”标题`);
    }
  }
  return trimmed;
}

function updateSnapshotAfterImport(manifest: AutomationManifest, node: AutomationNode, content: string) {
  if (node.kind === "volumes") {
    manifest.snapshot.stepContent.volumes = content;
    manifest.snapshot.firstVolumeOutline = extractFirstVolume(content);
  } else if (node.kind === "settings") manifest.snapshot.stepContent.settings = content;
  else if (node.kind === "units" && node.startChapter !== null) manifest.snapshot.storyUnits[String(node.startChapter)] = content;
  manifest.inputHash = hash(manifest.snapshot);
}

export function importCompletedAutomationNodes(runDir: string, manifest: AutomationManifest, workspace: NovelWorkspaceData, importer: AutomationImporter, options: AutomationOptions = {}) {
  reconcileAutomationStaleness(runDir, manifest, workspace, options);
  let importedCount = 0;
  for (const node of manifest.nodes) {
    if (node.status !== "completed" || node.imported) continue;
    const outputFile = path.join(runDir, node.outputPath);
    if (!fs.existsSync(outputFile)) {
      node.status = "failed";
      node.failureReason = "输出文件不存在";
      manifest.status = "failed";
      manifest.failureReason = `${node.label}输出文件不存在`;
      saveManifest(runDir, manifest, options);
      break;
    }
    try {
      const content = validateAutomationOutput(node, fs.readFileSync(outputFile, "utf8"));
      const contentHash = hash(content);
      importer.importAutomationNode({ novelId: manifest.novelId, kind: node.kind, startChapter: node.startChapter, content, firstVolumeOutline: node.kind === "volumes" ? extractFirstVolume(content) : undefined });
      node.imported = true;
      node.importedHash = contentHash;
      updateSnapshotAfterImport(manifest, node, content);
      saveManifest(runDir, manifest, options);
      importedCount += 1;
    } catch (error) {
      node.status = "failed";
      node.failureReason = error instanceof Error ? error.message : "导入失败";
      manifest.status = "failed";
      manifest.failureReason = `${node.label}导入失败：${node.failureReason}`;
      saveManifest(runDir, manifest, options);
      break;
    }
  }
  return importedCount;
}

export function requestAutomationControl(runDir: string, action: AutomationControl["action"], options: AutomationOptions & { mode?: AutomationControl["mode"]; targetNodeId?: string | null } = {}) {
  const manifest = readJson<AutomationManifest>(path.join(runDir, "manifest.json"));
  const control: AutomationControl = { action, mode: options.mode ?? "all", targetNodeId: options.targetNodeId ?? null, requestedAt: iso(options) };
  let manifestChanged = false;
  if (action === "run" && control.mode === "retry-node") {
    const node = manifest.nodes.find((item) => item.id === control.targetNodeId);
    if (!node) throw new Error("重试节点不存在");
    node.status = "pending";
    node.maxAttempts = Math.max(node.maxAttempts, node.attempts + 1);
    node.failureReason = null;
    manifest.status = "pending";
    manifest.failureReason = null;
    manifestChanged = true;
  } else if (action === "run" && manifest.status !== "running") {
    manifest.status = "pending";
    manifest.failureReason = null;
    manifestChanged = true;
  }
  writeJson(path.join(runDir, "control.json"), control);
  if (manifestChanged) saveManifest(runDir, manifest, options);
  return { manifest, control };
}

export function recoverInterruptedAutomationRun(runDir: string, options: AutomationOptions = {}) {
  const manifest = readJson<AutomationManifest>(path.join(runDir, "manifest.json"));
  if (manifest.status !== "running") throw new Error("任务当前不处于生成中，无需恢复中断状态");
  const node = manifest.nodes.find((item) => item.status === "running");
  if (!node) throw new Error("没有找到被中断的生成节点");
  node.status = "failed";
  node.failureReason = "本地 Codex 进程已被手动中断，请单独重试。";
  node.lastDurationSeconds = durationSeconds(node.startedAt, iso(options));
  manifest.status = "failed";
  manifest.currentNode = node.id;
  manifest.failureReason = `${node.label}已被手动中断，请单独重试。`;
  writeJson(path.join(runDir, "control.json"), { action: "pause", mode: "all", targetNodeId: null, requestedAt: iso(options) } satisfies AutomationControl);
  saveManifest(runDir, manifest, options);
  refreshAutomationRunnerFiles(runDir, manifest, options);
  return manifest;
}

function truncateContinuityFrom(runDir: string, manifest: AutomationManifest, index: number) {
  const continuityPath = path.join(runDir, manifest.continuityPath);
  if (!fs.existsSync(continuityPath)) return;
  const content = fs.readFileSync(continuityPath, "utf8");
  const stalePositions = manifest.nodes.slice(index)
    .map((node) => content.indexOf(`\n## ${node.label}\n`))
    .filter((position) => position >= 0);
  if (stalePositions.length === 0) {
    if (index === 0) atomicWrite(continuityPath, "# 连续性记录\n");
    return;
  }
  atomicWrite(continuityPath, `${content.slice(0, Math.min(...stalePositions)).trimEnd()}\n`);
}

export function restartAutomationFromNode(runDir: string, nodeId: string, workspace: NovelWorkspaceData, options: AutomationOptions = {}) {
  const manifest = readJson<AutomationManifest>(path.join(runDir, "manifest.json"));
  if (manifest.status === "running") throw new Error("当前节点仍在运行，请先请求暂停并等待节点结束");
  const index = manifest.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) throw new Error("重新生成节点不存在");
  if (String(workspace.novel.id) !== manifest.novelId) throw new Error("任务与当前小说不匹配");
  manifest.snapshot = snapshotFor(workspace);
  updateManifestInputSummary(manifest);
  writeNodeInputs(runDir, manifest, true);
  manifest.nodes.forEach((node, nodeIndex) => {
    if (nodeIndex < index) return;
    node.status = nodeIndex === index ? "pending" : "stale";
    node.imported = false;
    node.importedHash = null;
    node.failureReason = null;
    if (nodeIndex === index) node.maxAttempts = Math.max(node.maxAttempts, node.attempts + 2);
  });
  manifest.status = "pending";
  manifest.currentNode = null;
  manifest.failureReason = null;
  truncateContinuityFrom(runDir, manifest, index);
  const control: AutomationControl = { action: "run", mode: "all", targetNodeId: null, requestedAt: iso(options) };
  writeJson(path.join(runDir, "control.json"), control);
  saveManifest(runDir, manifest, options);
  return { manifest, control };
}

export function readAutomationArtifact(runDir: string, nodeId: string, artifact: "output" | "log") {
  const manifest = readJson<AutomationManifest>(path.join(runDir, "manifest.json"));
  const node = manifest.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("节点不存在");
  const relativePath = artifact === "output" ? node.outputPath : node.logPath;
  const filePath = path.resolve(runDir, relativePath);
  if (!filePath.startsWith(`${path.resolve(runDir)}${path.sep}`)) throw new Error("任务文件路径无效");
  if (!fs.existsSync(filePath)) throw new Error(artifact === "output" ? "输出尚未生成" : "日志尚未生成");
  return { filePath, content: fs.readFileSync(filePath, "utf8") };
}

export function readAutomationManifest(runDir: string) {
  return readJson<AutomationManifest>(path.join(runDir, "manifest.json"));
}
