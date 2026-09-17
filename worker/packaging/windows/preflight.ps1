param(
  [string]$WorkerHome = ""
)

$ErrorActionPreference = "Stop"

function Get-FirstCommandToken([string]$Command) {
  if ([string]::IsNullOrWhiteSpace($Command)) { return "" }
  $trimmed = $Command.Trim()
  if ($trimmed.StartsWith('"')) {
    $end = $trimmed.IndexOf('"', 1)
    if ($end -gt 1) { return $trimmed.Substring(1, $end - 1) }
  }
  return ($trimmed -split '\s+', 2)[0]
}

$nvidia = $null
$nvidiaCommand = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($nvidiaCommand) {
  try {
    $line = (& $nvidiaCommand.Source --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>$null | Select-Object -First 1)
    if ($line) {
      $parts = $line -split ',', 3 | ForEach-Object { $_.Trim() }
      if ($parts.Count -ge 3) {
        $nvidia = [ordered]@{ name = $parts[0]; vramMiB = [int]$parts[1]; driver = $parts[2] }
      }
    }
  } catch { $nvidia = $null }
}

$ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue

$configPath = if ($WorkerHome) { Join-Path $WorkerHome "config.json" } else {
  $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME "AppData\Local" }
  Join-Path $base "FG Studio\Worker\config.json"
}
$config = $null
if (Test-Path -LiteralPath $configPath) {
  try { $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json } catch { $config = $null }
}

# Prefer the FFmpeg shipped in the versioned Worker release.  PATH is only a
# pre-install fallback, so a clean end-user machine is still reported ready
# after the bundled runtime is installed.
$ffmpegExecutable = if ($ffmpegCommand) { $ffmpegCommand.Source } else { $null }
if ($config -and $config.ffmpegDir) {
  $ffmpegRoot = ([string]$config.ffmpegDir).Replace('{installRoot}', [string]$config.installRoot)
  if (-not [System.IO.Path]::IsPathRooted($ffmpegRoot)) { $ffmpegRoot = Join-Path ([string]$config.installRoot) $ffmpegRoot }
  $bundledFfmpeg = Join-Path $ffmpegRoot 'ffmpeg.exe'
  if (Test-Path -LiteralPath $bundledFfmpeg -PathType Leaf) { $ffmpegExecutable = $bundledFfmpeg }
}
$ffmpegVersion = $null
if ($ffmpegExecutable) {
  try { $ffmpegVersion = (& $ffmpegExecutable -version 2>$null | Select-Object -First 1) } catch { $ffmpegVersion = $null }
}

$runnerResults = @()
if ($config -and $config.runnerCommands) {
  foreach ($property in $config.runnerCommands.psobject.Properties) {
    $token = Get-FirstCommandToken ([string]$property.Value)
    $expanded = $token.Replace('{installRoot}', [string]$config.installRoot)
    $exists = $false
    if ($expanded) { $exists = Test-Path -LiteralPath $expanded -PathType Leaf }
    $runnerResults += [ordered]@{ profile = $property.Name; executable = $expanded; installed = $exists }
  }
}

$driveName = (Get-Location).Path.Substring(0, 1)
$disk = try { [System.IO.DriveInfo]::new($driveName) } catch { $null }
$ready = [bool]($nvidia -and $ffmpegVersion -and ($runnerResults.Count -gt 0) -and (@($runnerResults | Where-Object { -not $_.installed }).Count -eq 0))
$result = [ordered]@{
  ready = $ready
  nvidia = $nvidia
  ffmpeg = [ordered]@{ executable = $ffmpegExecutable; version = $ffmpegVersion }
  runners = $runnerResults
  freeDiskBytes = if ($disk) { [int64]$disk.AvailableFreeSpace } else { $null }
  configPath = $configPath
}
$result | ConvertTo-Json -Depth 6
if (-not $ready) { exit 1 }
