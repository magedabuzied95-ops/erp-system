# Transcode-cost benchmark: does this laptop have to spend CPU on every camera?
#
# WHY THIS DECIDES THE ARCHITECTURE
# ---------------------------------
# The shop laptop is an i7-7500U: TWO physical cores. The live POC measured
# libx264 at ~0.58 of a core for ONE camera, which puts 16 cameras at ~9.3
# cores. That is not a tuning problem, it is a wall.
#
# The only way through it is to stop using the CPU. HD Graphics 620 has Quick
# Sync: a fixed-function block that can DECODE H.265 and ENCODE H.264 without
# the general-purpose cores. If it works here, cost per camera collapses.
#
# WHAT IS MEASURED
# ----------------
# CPU-seconds consumed per second of video, not wall time. Wall time is
# meaningless for this question: a transcode that runs at 4x realtime while
# pinning both cores still only supports one camera. CPU-seconds per video
# second is the number that divides into the core budget.
#
# NOTE ON QUOTING: this scratchpad lives under "C:\Users\Tiger Store\...".
# Start-Process does not quote the elements of -ArgumentList, so an unquoted
# path is delivered to ffmpeg as "C:\Users\Tiger" and every variant fails
# identically with "Permission denied" -- which reads like a QSV failure and
# is not one. Arguments are quoted explicitly below.

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ff  = Join-Path $dir "ffmpeg\ffmpeg-9.0.1-essentials_build\bin\ffmpeg.exe"
$src = Join-Path $dir "bench-hevc-2048.mp4"
$DUR = 60

function Run-Ffmpeg([string]$label, [string[]]$ffArgs) {
  $out = Join-Path $env:TEMP "bench-$label.log"
  # Quote any argument containing whitespace. \s in a PowerShell -match is the
  # regex class, so this catches spaces in the source path specifically.
  $quoted = @($ffArgs | ForEach-Object {
    if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
  })

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  # TotalProcessorTime is the only reliable CPU-time source on Windows;
  # ffmpeg's own "speed=" is wall-clock and hides how many cores it burned.
  $p = Start-Process -FilePath $ff -ArgumentList $quoted -NoNewWindow -PassThru `
        -RedirectStandardError $out -RedirectStandardOutput "$out.o"
  $p.WaitForExit()
  $sw.Stop()

  $cpu  = $p.TotalProcessorTime.TotalSeconds
  $code = $p.ExitCode
  [pscustomobject]@{
    Variant      = $label
    ExitCode     = $code
    CpuSec       = [math]::Round($cpu, 1)
    WallSec      = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    CpuPerVidSec = [math]::Round($cpu / $DUR, 3)
    LogTail      = ((Get-Content $out -Tail 2 -ErrorAction SilentlyContinue) -join " | ")
  }
}

# ---- source: HEVC 960x1080 25fps 2048k, matching Channel 1 exactly ----
if (-not (Test-Path $src)) {
  Write-Host "generating $DUR s HEVC source (960x1080 @ 2048k)..."
  # testsrc2 carries real detail and motion, so the encoder cannot cheat on it
  # the way it would on a flat or static pattern.
  & $ff -hide_banner -loglevel error -y -f lavfi `
        -i "testsrc2=size=960x1080:rate=25:duration=$DUR" `
        -c:v libx265 -b:v 2048k -x265-params log-level=none -preset ultrafast $src
  if ($LASTEXITCODE -ne 0) { throw "source generation failed" }
}
Write-Host ("source ready: {0:N0} bytes`n" -f (Get-Item $src).Length)

$results = @()

# ---- A: what production runs today (pure CPU) ----
$results += Run-Ffmpeg "cpu-x264" @(
  "-hide_banner","-loglevel","error","-i",$src,
  "-c:v","libx264","-preset","veryfast","-crf","18","-tune","zerolatency",
  "-fps_mode","passthrough","-an","-f","null","-")

# ---- B: full hardware path, decode AND encode on the iGPU ----
# -hwaccel_output_format qsv keeps frames in GPU memory the whole way; without
# it every frame is copied out to system RAM and back, which is most of the cost.
$results += Run-Ffmpeg "qsv-full" @(
  "-hide_banner","-loglevel","error",
  "-hwaccel","qsv","-hwaccel_output_format","qsv","-c:v","hevc_qsv","-i",$src,
  "-c:v","h264_qsv","-preset","veryfast","-b:v","2500k",
  "-fps_mode","passthrough","-an","-f","null","-")

# ---- C: hardware encode only, software decode (fallback if B fails) ----
$results += Run-Ffmpeg "qsv-encode-only" @(
  "-hide_banner","-loglevel","error","-i",$src,
  "-c:v","h264_qsv","-preset","veryfast","-b:v","2500k",
  "-fps_mode","passthrough","-an","-f","null","-")

# ---- D: d3d11va decode + x264 encode (decode offload only) ----
$results += Run-Ffmpeg "d3d11va-x264" @(
  "-hide_banner","-loglevel","error","-hwaccel","d3d11va","-i",$src,
  "-c:v","libx264","-preset","veryfast","-crf","18","-tune","zerolatency",
  "-fps_mode","passthrough","-an","-f","null","-")

Write-Host "`n=== RESULTS (60 s of 960x1080 25fps HEVC) ==="
$results | Format-Table Variant,ExitCode,CpuSec,WallSec,CpuPerVidSec -AutoSize | Out-String | Write-Host

Write-Host "=== CAMERAS SUPPORTED (2 physical cores, 70% budget = 1.4 cores) ==="
foreach ($r in $results) {
  if ($r.ExitCode -eq 0 -and $r.CpuPerVidSec -gt 0) {
    "  {0,-16} {1,5:N3} cores/cam  ->  {2,5:N1} cameras" -f $r.Variant, $r.CpuPerVidSec, (1.4 / $r.CpuPerVidSec) | Write-Host
  } else {
    "  {0,-16} FAILED exit={1} :: {2}" -f $r.Variant, $r.ExitCode, $r.LogTail | Write-Host
  }
}
