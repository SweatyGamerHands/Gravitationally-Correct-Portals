[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$shortcutName = 'Portal Field Laboratory.lnk'
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) $shortcutName),
  (Join-Path ([Environment]::GetFolderPath('Programs')) $shortcutName)
)

$removed = @()
foreach ($shortcutPath in $shortcutPaths) {
  if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
    Remove-Item -LiteralPath $shortcutPath -Force
    $removed += $shortcutPath
  }
}

if ($removed.Count -eq 0) {
  Write-Output 'No Portal Field Laboratory shortcuts were installed.'
} else {
  Write-Output 'Portal Field Laboratory shortcuts removed:'
  $removed | ForEach-Object { Write-Output "  $_" }
}
