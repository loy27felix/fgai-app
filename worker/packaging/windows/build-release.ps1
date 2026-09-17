param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$RunnerDir,
  [Parameter(Mandatory = $true)][string]$FfmpegDir,
  [string]$OutputDir = "dist\fg-worker-release",
  [string]$NasBucket = "creator-assets",
  [string]$NasPrefix = "worker-releases",
  [string]$ServerUrl = ""
)

$ErrorActionPreference = "Stop"
$workerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
$sourceRoot = Join-Path $workerRoot "src"
$out = [IO.Path]::GetFullPath($OutputDir)
$stage = Join-Path $out "runtime-windows-amd64"

if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
  throw "Maintainer build machine needs PyInstaller (end users do not install it)."
}
if (-not (Test-Path -LiteralPath $RunnerDir -PathType Container)) { throw "Runner directory does not exist: $RunnerDir" }
if (-not (Test-Path -LiteralPath $FfmpegDir -PathType Container)) { throw "FFmpeg directory does not exist: $FfmpegDir" }
foreach ($runner in @("basicvsrpp.exe", "realesrgan.exe", "propainter.exe")) {
  if (-not (Test-Path -LiteralPath (Join-Path $RunnerDir $runner) -PathType Leaf)) { throw "Required packaged Runner is missing: $runner" }
}

Remove-Item -LiteralPath $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Push-Location $workerRoot
$defaultServerFile = Join-Path $sourceRoot "fg_worker\default-server.txt"
Set-Content -LiteralPath $defaultServerFile -Value $ServerUrl -Encoding utf8
try {
  $pyinstallerArgs = @(
    "--noconfirm", "--clean", "--onefile", "--paths", $sourceRoot,
    "--add-data", "$defaultServerFile;fg_worker",
    "--collect-all", "keyring",
    "--hidden-import", "tkinter"
  )
  & pyinstaller @pyinstallerArgs --name FGStudioWorkerSetup $sourceRoot\fg_worker\__main__.py
  & pyinstaller @pyinstallerArgs --name fg-worker $sourceRoot\fg_worker\__main__.py
} finally {
  Remove-Item -LiteralPath $defaultServerFile -Force -ErrorAction SilentlyContinue
  Pop-Location
}

Copy-Item -LiteralPath (Join-Path $workerRoot "dist\FGStudioWorkerSetup.exe") -Destination (Join-Path $out "FGStudioWorkerSetup.exe")
Copy-Item -LiteralPath (Join-Path $workerRoot "dist\fg-worker.exe") -Destination (Join-Path $stage "fg-worker.exe")
New-Item -ItemType Directory -Path (Join-Path $stage "runners"), (Join-Path $stage "ffmpeg") -Force | Out-Null
Copy-Item -Path (Join-Path $RunnerDir "*") -Destination (Join-Path $stage "runners") -Recurse
Copy-Item -Path (Join-Path $FfmpegDir "*") -Destination (Join-Path $stage "ffmpeg") -Recurse
$runtimeZip = Join-Path $out "runtime-windows-amd64-$Version.zip"
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $runtimeZip -CompressionLevel Optimal

function Hash-Descriptor([string]$id, [string]$kind, [string]$path, [string]$fileName) {
  $info = Get-Item -LiteralPath $path
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  return [ordered]@{ id = $id; kind = $kind; bucket = $NasBucket; path = "$NasPrefix/$Version/$fileName"; fileName = $fileName; bytes = [int64]$info.Length; sha256 = $hash }
}

$installer = Hash-Descriptor "installer-windows-amd64-$Version" "installer" (Join-Path $out "FGStudioWorkerSetup.exe") "FGStudioWorkerSetup.exe"
$runtime = Hash-Descriptor "runtime-windows-amd64-$Version" "runtime" $runtimeZip (Split-Path $runtimeZip -Leaf)
$manifest = [ordered]@{
  schemaVersion = 1
  releases = [ordered]@{
    "windows-amd64" = [ordered]@{
      version = $Version
      requiredDiskBytes = [int64]($runtime.bytes + 2GB)
      artifacts = @($installer, $runtime)
      runnerCommands = [ordered]@{
        "basicvsrpp-quality" = "runners/basicvsrpp.exe"
        "realesrgan-sequence-fallback" = "runners/realesrgan.exe"
        "propainter-mask" = "runners/propainter.exe"
      }
      ffmpegDir = "ffmpeg"
      workerExecutable = "fg-worker.exe"
    }
  }
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out "manifest-windows-amd64-$Version.json") -Encoding utf8
Write-Host "Maintainer release directory generated: $out"
Write-Host "Upload both artifacts to their NAS paths, then configure the manifest JSON as FG_WORKER_RELEASE_MANIFEST_PATH."
