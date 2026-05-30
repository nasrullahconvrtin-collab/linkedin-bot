$ErrorActionPreference = "Stop"

$taskName = "LinkedFlow Agent Tray"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = (Get-Command py.exe).Source
$script = Join-Path $projectDir "agent_tray.py"

if (!(Test-Path $script)) {
  throw "Cannot find $script"
}

$action = New-ScheduledTaskAction -Execute $python -Argument "`"$script`"" -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Starts the LinkedFlow tray agent on Windows login." `
  -Force | Out-Null

Write-Host "Installed Windows startup task: $taskName"
Write-Host "Run now from Start Menu/Task Scheduler, or reboot/log out and back in."
