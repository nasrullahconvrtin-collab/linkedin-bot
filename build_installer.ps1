$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (!(Test-Path "dist\LinkedFlowAgent\LinkedFlowAgent.exe")) {
  throw "Build LinkedFlowAgent.exe first by running package_agent.ps1"
}

py installer_builder.py

if (Test-Path "installer_build") { Remove-Item "installer_build" -Recurse -Force }
if (Test-Path "installer_dist") { Remove-Item "installer_dist" -Recurse -Force }
if (Test-Path "LinkedFlow-Agent-Setup.spec") { Remove-Item "LinkedFlow-Agent-Setup.spec" -Force }

py -m PyInstaller `
  --noconsole `
  --onefile `
  --uac-admin `
  --name LinkedFlow-Agent-Setup `
  --distpath installer_dist `
  --workpath installer_build `
  --add-data "installer_payload\app_payload.zip;." `
  linkedflow_installer.py

Write-Host "Installer complete: $PSScriptRoot\installer_dist\LinkedFlow-Agent-Setup.exe"
