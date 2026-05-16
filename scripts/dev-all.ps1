$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$serverDir = Join-Path $rootDir "server"
$logDir = Join-Path $rootDir "runtime-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$runStamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"

$backendOut = Join-Path $logDir "dev-backend-$runStamp.out.log"
$backendErr = Join-Path $logDir "dev-backend-$runStamp.err.log"
$frontendOut = Join-Path $logDir "dev-frontend-$runStamp.out.log"
$frontendErr = Join-Path $logDir "dev-frontend-$runStamp.err.log"

$backendProc = Start-Process `
  -FilePath (Get-Command node.exe -ErrorAction Stop).Source `
  -ArgumentList @('server.js') `
  -WorkingDirectory $serverDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $backendOut `
  -RedirectStandardError $backendErr `
  -PassThru

$frontendProc = Start-Process `
  -FilePath (Get-Command node.exe -ErrorAction Stop).Source `
  -ArgumentList @('node_modules\vite\bin\vite.js') `
  -WorkingDirectory $rootDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $frontendOut `
  -RedirectStandardError $frontendErr `
  -PassThru

Write-Host "[dev-all] backend pid=$($backendProc.Id)"
Write-Host "[dev-all] frontend pid=$($frontendProc.Id)"
Write-Host "[dev-all] backend cwd=$serverDir"
Write-Host "[dev-all] frontend cwd=$rootDir"
Write-Host "[dev-all] waiting for backend/frontend processes"

function Read-NewLines {
  param(
    [string]$Path,
    [string]$Prefix,
    [ref]$IndexRef
  )

  if (-not (Test-Path $Path)) {
    return
  }

  $lines = @((Get-Content -Path $Path -ErrorAction SilentlyContinue))
  if ($lines.Count -le $IndexRef.Value) {
    return
  }

  for ($i = $IndexRef.Value; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($null -ne $line -and $line -ne "") {
      Write-Host "[$Prefix] $line"
    }
  }

  $IndexRef.Value = $lines.Count
}

function Write-ExitSummary {
  param(
    [string]$Name,
    [System.Diagnostics.Process]$Process,
    [string]$OutPath,
    [string]$ErrPath
  )

  $Process.Refresh()
  $exitCode = $null
  try {
    $Process.WaitForExit()
    $Process.Refresh()
    $exitCode = $Process.ExitCode
  } catch {
    $exitCode = "unknown"
  }

  if ($null -eq $exitCode -or $exitCode -eq "") {
    $exitCode = "unknown"
  }

  Write-Host "[$Name] process=$Name exited with code $exitCode"
  if (Test-Path $ErrPath) {
    $stderr = @((Get-Content -Path $ErrPath -Tail 20 -ErrorAction SilentlyContinue))
    if ($stderr.Count -gt 0) {
      Write-Host "[$Name] last stderr:"
      $stderr | ForEach-Object { Write-Host "[$Name] $_" }
    }
  }
  if (Test-Path $OutPath) {
    $stdout = @((Get-Content -Path $OutPath -Tail 20 -ErrorAction SilentlyContinue))
    if ($stdout.Count -gt 0) {
      Write-Host "[$Name] last stdout:"
      $stdout | ForEach-Object { Write-Host "[$Name] $_" }
    }
  }
}

$backendOutIndex = 0
$backendErrIndex = 0
$frontendOutIndex = 0
$frontendErrIndex = 0
$backendReported = $false
$frontendReported = $false

$backendHealthVerified = $false
$frontendHealthVerified = $false
$proxyHealthVerified = $false
$frontendRootVerified = $false
$deadline = (Get-Date).AddSeconds(40)

while ($true) {
  Read-NewLines -Path $backendOut -Prefix "backend" -IndexRef ([ref]$backendOutIndex)
  Read-NewLines -Path $backendErr -Prefix "backend" -IndexRef ([ref]$backendErrIndex)
  Read-NewLines -Path $frontendOut -Prefix "frontend" -IndexRef ([ref]$frontendOutIndex)
  Read-NewLines -Path $frontendErr -Prefix "frontend" -IndexRef ([ref]$frontendErrIndex)

  if (-not $backendHealthVerified) {
    try {
      $healthResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8000/api/health" -TimeoutSec 3
      if ($healthResponse.StatusCode -ge 200 -and $healthResponse.StatusCode -lt 500) {
        Write-Host "[backend] http://localhost:8000/api/health -> $($healthResponse.StatusCode)"
        $backendHealthVerified = $true
      }
    } catch {
    }
  }

  if (-not $frontendHealthVerified) {
    try {
      $frontendResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:5173/" -TimeoutSec 3
      if ($frontendResponse.StatusCode -ge 200 -and $frontendResponse.StatusCode -lt 500) {
        Write-Host "[frontend] http://localhost:5173/ -> $($frontendResponse.StatusCode)"
        $frontendHealthVerified = $true
      }
    } catch {
    }
  }

  if (-not $proxyHealthVerified) {
    try {
      $proxyHealthResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:5173/api/health" -TimeoutSec 3
      if ($proxyHealthResponse.StatusCode -ge 200 -and $proxyHealthResponse.StatusCode -lt 500) {
        Write-Host "[frontend] http://localhost:5173/api/health -> $($proxyHealthResponse.StatusCode)"
        $proxyHealthVerified = $true
      }
    } catch {
    }
  }

  if (-not $backendReported -and $backendProc.HasExited) {
    $backendReported = $true
    Write-ExitSummary -Name "backend" -Process $backendProc -OutPath $backendOut -ErrPath $backendErr
  }

  if (-not $frontendReported -and $frontendProc.HasExited) {
    $frontendReported = $true
    Write-ExitSummary -Name "frontend" -Process $frontendProc -OutPath $frontendOut -ErrPath $frontendErr
  }

  if ($backendHealthVerified -and $frontendHealthVerified -and $proxyHealthVerified -and $backendProc.HasExited -and $frontendProc.HasExited) {
    break
  }

  if ((Get-Date) -gt $deadline -and (-not $backendHealthVerified -or -not $frontendHealthVerified -or -not $proxyHealthVerified)) {
    Write-Host "[dev-all] startup verification incomplete"
    $deadline = [datetime]::MaxValue
  }

  Start-Sleep -Seconds 1
}
