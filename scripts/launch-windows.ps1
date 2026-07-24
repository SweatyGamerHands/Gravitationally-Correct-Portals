[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [ValidateRange(1024, 65535)]
  [int]$Port = 41731,
  [ValidateRange(1000, 86400000)]
  [int]$IdleMilliseconds = 600000
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'
$distIndex = Join-Path $distRoot 'index.html'
$serverScript = Join-Path $PSScriptRoot 'serve-dist.mjs'
$appOrigin = "http://127.0.0.1:$Port"
$appUrl = "$appOrigin/?portalLabDesktop=1"

function Show-PortalLabError {
  param([string]$Message)

  try {
    Add-Type -AssemblyName PresentationFramework -ErrorAction Stop
    [System.Windows.MessageBox]::Show(
      $Message,
      'Portal Field Laboratory',
      [System.Windows.MessageBoxButton]::OK,
      [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
  } catch {
    Write-Error $Message
  }
}

function Test-PortalLabHealth {
  try {
    $response = Invoke-WebRequest `
      -Uri "$appOrigin/__portal_lab_health" `
      -UseBasicParsing `
      -TimeoutSec 1
    return $response.StatusCode -eq 200 -and $response.Headers['X-Portal-Lab-Server'] -eq '1'
  } catch {
    return $false
  }
}

function Test-TcpPortInUse {
  $client = New-Object System.Net.Sockets.TcpClient
  $waitHandle = $null
  try {
    $asyncResult = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $waitHandle = $asyncResult.AsyncWaitHandle
    if (-not $waitHandle.WaitOne(250)) {
      return $false
    }
    $client.EndConnect($asyncResult)
    return $true
  } catch {
    return $false
  } finally {
    if ($null -ne $waitHandle) {
      $waitHandle.Close()
    }
    $client.Close()
  }
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

try {
  $nodeCommand = Get-Command node.exe -ErrorAction Stop
  $npmCommand = Get-Command npm.cmd -ErrorAction Stop
} catch {
  Show-PortalLabError @'
Node.js 20.19 or newer is required.

Install the current Node.js LTS release from https://nodejs.org, then open Portal Field Laboratory again.
'@
  exit 1
}

$nodeVersionText = & $nodeCommand.Source -p 'process.versions.node'
$nodeVersionExitCode = $LASTEXITCODE
try {
  $nodeVersion = [version]$nodeVersionText.Trim()
} catch {
  Show-PortalLabError 'The installed Node.js version could not be identified. Install Node.js 20.19 or newer, then try again.'
  exit 1
}
if ($nodeVersionExitCode -ne 0 -or $nodeVersion -lt [version]'20.19.0') {
  Show-PortalLabError "Portal Field Laboratory requires Node.js 20.19 or newer.`n`nInstalled version: $nodeVersion"
  exit 1
}

$nodeModulesDirectory = Join-Path $projectRoot 'node_modules'
$dependencyStamp = Join-Path $nodeModulesDirectory '.package-lock.json'
$packageLock = Join-Path $projectRoot 'package-lock.json'
$dependencyManifest = if (Test-Path -LiteralPath $packageLock -PathType Leaf) {
  $packageLock
} else {
  Join-Path $projectRoot 'package.json'
}
$requiresInstall = (
  -not (Test-Path -LiteralPath $nodeModulesDirectory -PathType Container) -or
  -not (Test-Path -LiteralPath $dependencyStamp -PathType Leaf) -or
  (Get-Item -LiteralPath $dependencyManifest).LastWriteTimeUtc -gt (Get-Item -LiteralPath $dependencyStamp).LastWriteTimeUtc
)

$requiresBuild = -not (Test-Path -LiteralPath $distIndex -PathType Leaf)
if (-not $requiresBuild) {
  $buildTimestamp = (Get-Item -LiteralPath $distIndex).LastWriteTimeUtc
  $sourceFiles = @()
  $sourceDirectory = Join-Path $projectRoot 'src'
  $publicDirectory = Join-Path $projectRoot 'public'

  if (Test-Path -LiteralPath $sourceDirectory -PathType Container) {
    $sourceFiles += Get-ChildItem -LiteralPath $sourceDirectory -File -Recurse
  }
  if (Test-Path -LiteralPath $publicDirectory -PathType Container) {
    $sourceFiles += Get-ChildItem -LiteralPath $publicDirectory -File -Recurse
  }

  foreach ($relativePath in @(
    'index.html',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts'
  )) {
    $candidate = Join-Path $projectRoot $relativePath
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $sourceFiles += Get-Item -LiteralPath $candidate
    }
  }

  $requiresBuild = $null -ne ($sourceFiles | Where-Object {
    $_.LastWriteTimeUtc -gt $buildTimestamp
  } | Select-Object -First 1)
}
$requiresBuild = $requiresBuild -or $requiresInstall

if ($requiresBuild) {
  try {
    Push-Location $projectRoot
    if ($requiresInstall) {
      & $npmCommand.Source ci
      if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed with exit code $LASTEXITCODE."
      }
    }

    & $npmCommand.Source run build
    if ($LASTEXITCODE -ne 0) {
      throw "The application build failed with exit code $LASTEXITCODE."
    }
  } catch {
    Show-PortalLabError "Portal Field Laboratory could not be prepared.`n`n$($_.Exception.Message)"
    exit 1
  } finally {
    Pop-Location
  }
}

if (-not (Test-PortalLabHealth)) {
  if (Test-TcpPortInUse) {
    Show-PortalLabError "Local port $Port is already being used by another program. Close that program, then try again."
    exit 1
  }

  $serverArguments = @(
    "`"$serverScript`"",
    '--port',
    $Port.ToString(),
    '--root',
    "`"$distRoot`"",
    '--idle-ms',
    $IdleMilliseconds.ToString()
  )

  $serverProcess = Start-Process `
    -FilePath $nodeCommand.Source `
    -ArgumentList $serverArguments `
    -WindowStyle Hidden `
    -PassThru

  $serverReady = $false
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    Start-Sleep -Milliseconds 100
    if (Test-PortalLabHealth) {
      $serverReady = $true
      break
    }
    if ($serverProcess.HasExited) {
      break
    }
  }

  if (-not $serverReady) {
    if (-not $serverProcess.HasExited) {
      Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
    }
    Show-PortalLabError 'The local Portal Field Laboratory service could not start.'
    exit 1
  }
}

if ($NoBrowser) {
  Write-Output $appUrl
  exit 0
}

$programFiles = [Environment]::GetFolderPath('ProgramFiles')
$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$browserPath = Get-FirstExistingPath @(
  (Join-Path $programFilesX86 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $programFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $localAppData 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $programFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $programFilesX86 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $localAppData 'Google\Chrome\Application\chrome.exe')
)

try {
  if ($browserPath) {
    $browserProfile = Join-Path $localAppData 'Portal Field Laboratory\Browser Profile'
    New-Item -ItemType Directory -Path $browserProfile -Force | Out-Null
    $browserArguments = @(
      "--app=$appUrl",
      "--user-data-dir=`"$browserProfile`"",
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-first-run-ui',
      '--start-maximized'
    )
    Start-Process -FilePath $browserPath -ArgumentList $browserArguments | Out-Null
  } else {
    Start-Process $appUrl | Out-Null
  }
} catch {
  Show-PortalLabError "The laboratory is running, but its window could not be opened.`n`nOpen $appUrl in a browser."
  exit 1
}
