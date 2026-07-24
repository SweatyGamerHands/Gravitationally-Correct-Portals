[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $PSScriptRoot 'launch-windows.ps1'
$powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$desktopDirectory = [Environment]::GetFolderPath('Desktop')
$startMenuDirectory = [Environment]::GetFolderPath('Programs')
$shortcutName = 'Portal Field Laboratory.lnk'

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
  throw "Launcher not found at $launcherPath"
}

function Get-FirstExistingPath {
  param([string[]]$Candidates)

  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }
  return $null
}

$programFiles = [Environment]::GetFolderPath('ProgramFiles')
$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$browserIcon = Get-FirstExistingPath @(
  (Join-Path $programFilesX86 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $programFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $localAppData 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $programFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $programFilesX86 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $localAppData 'Google\Chrome\Application\chrome.exe')
)
$iconLocation = if ($browserIcon) {
  "$browserIcon,0"
} else {
  "$env:SystemRoot\System32\shell32.dll,220"
}

$shell = New-Object -ComObject WScript.Shell
$installedShortcuts = @()
foreach ($directory in @($desktopDirectory, $startMenuDirectory)) {
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $shortcutPath = Join-Path $directory $shortcutName
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $powershellPath
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
  $shortcut.WorkingDirectory = $projectRoot
  $shortcut.Description = 'Open Portal Field Laboratory'
  $shortcut.IconLocation = $iconLocation
  $shortcut.Save()
  $installedShortcuts += $shortcutPath
}

Write-Output 'Portal Field Laboratory shortcuts installed:'
$installedShortcuts | ForEach-Object { Write-Output "  $_" }
