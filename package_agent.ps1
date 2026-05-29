$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
py -m pip install -r requirements.txt --quiet
py -m pip install pyinstaller --quiet
$browserCache = Join-Path $env:LOCALAPPDATA "ms-playwright"
$browserBackup = Join-Path $env:LOCALAPPDATA "ms-playwright-backup-linkedflow-test"
if (!(Test-Path $browserCache) -and (Test-Path $browserBackup)) {
  $browserCache = $browserBackup
}
if (!(Test-Path $browserCache)) {
  py -m playwright install chromium
}
if (!(Test-Path $browserCache)) {
  $browserCache = Join-Path $env:LOCALAPPDATA "ms-playwright"
}
$bundledRoot = Join-Path $PSScriptRoot "bundled_browsers"
$bundledCache = Join-Path $bundledRoot "ms-playwright"
if (!(Test-Path $browserCache)) {
  throw "Playwright browser cache not found at $browserCache"
}
if (Test-Path $bundledRoot) { Remove-Item $bundledRoot -Recurse -Force }
New-Item -ItemType Directory -Path $bundledRoot | Out-Null
New-Item -ItemType Directory -Path $bundledCache | Out-Null
$browserFolders = @("chromium-*", "chromium_headless_shell-*", "ffmpeg-*")
foreach ($pattern in $browserFolders) {
  Get-ChildItem -LiteralPath $browserCache -Directory -Filter $pattern | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $bundledCache $_.Name) -Recurse -Force
  }
}
$links = Join-Path $browserCache ".links"
if (Test-Path $links) {
  Copy-Item $links (Join-Path $bundledCache ".links") -Recurse -Force
}
if (-not (Get-ChildItem -LiteralPath $bundledCache -Directory -Filter "chromium-*" -ErrorAction SilentlyContinue)) {
  throw "Chromium browser folder was not copied into $bundledCache"
}

if (Test-Path "build") { Remove-Item "build" -Recurse -Force }
if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
if (Test-Path "LinkedFlowAgent.spec") { Remove-Item "LinkedFlowAgent.spec" -Force }
py -m PyInstaller `
  --noconsole `
  --onedir `
  --name LinkedFlowAgent `
  --collect-all playwright `
  --hidden-import pystray._win32 `
  agent_app.py

Copy-Item "bundled_browsers" "dist\LinkedFlowAgent\bundled_browsers" -Recurse -Force

Write-Host "Build complete: $PSScriptRoot\dist\LinkedFlowAgent\LinkedFlowAgent.exe"
Write-Host "Bundled Chromium cache: $PSScriptRoot\bundled_browsers\ms-playwright"
