# Concurrency scale test: 1 -> 4 -> 9 -> 16 simultaneous QSV transcodes.
#
# WHY THE CPU NUMBER IS NOT THE ANSWER
# ------------------------------------
# One QSV transcode costs 0.049 CPU cores, which divides into a 1.4-core budget
# 28 times. That number is meaningless on its own. Quick Sync is ONE
# fixed-function block: the second stream does not get a second encoder, it gets
# a share of the same one. The binding constraint is the block's throughput, and
# the only honest way to find it is to run N at once and watch for the point
# where they stop keeping up with realtime.
#
# THE PASS CONDITION
# ------------------
# Each job transcodes 60 s of video. A job "keeps up" if it finishes 60 s of
# video in under 60 s of wall time -- that is what live streaming demands. The
# ceiling is the largest N where EVERY job still keeps up, with margin.

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ff  = Join-Path $dir "ffmpeg\ffmpeg-9.0.1-essentials_build\bin\ffmpeg.exe"
$src = Join-Path $dir "bench-hevc-2048.mp4"
$VIDEO_SECONDS = 60

foreach ($n in @(1, 4, 9, 16)) {
  $procs = @()
  $sw = [System.Diagnostics.Stopwatch]::StartNew()

  for ($i = 0; $i -lt $n; $i++) {
    $log = Join-Path $env:TEMP "scale-$n-$i.log"
    $a = @("-hide_banner","-loglevel","error",
           "-hwaccel","qsv","-hwaccel_output_format","qsv","-c:v","hevc_qsv",
           "-i","`"$src`"",
           "-c:v","h264_qsv","-preset","veryfast","-b:v","2500k",
           "-fps_mode","passthrough","-an","-f","null","-")
    $procs += Start-Process -FilePath $ff -ArgumentList $a -NoNewWindow -PassThru -RedirectStandardError $log
  }

  foreach ($p in $procs) { $p.WaitForExit() }
  $sw.Stop()

  $wall = $sw.Elapsed.TotalSeconds
  $cpu  = ($procs | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
  # Every job processed $VIDEO_SECONDS of video. Total video handled is n*60;
  # realtime factor is how much video-time the host cleared per wall second.
  $realtime = ($n * $VIDEO_SECONDS) / $wall
  $errors = 0
  for ($i = 0; $i -lt $n; $i++) {
    $log = Join-Path $env:TEMP "scale-$n-$i.log"
    if ((Get-Item $log -ErrorAction SilentlyContinue).Length -gt 0) { $errors++ }
  }

  $verdict = if ($errors -gt 0) { "ERRORS ($errors)" }
             elseif ($wall -lt $VIDEO_SECONDS * 0.8) { "KEEPS UP (margin)" }
             elseif ($wall -lt $VIDEO_SECONDS) { "KEEPS UP (tight)" }
             else { "CANNOT KEEP UP" }

  "{0,2} streams | wall {1,6:N1}s | cpu {2,6:N1}s ({3,5:N2} cores) | {4,5:N1}x realtime | {5}" -f `
    $n, $wall, $cpu, ($cpu/$wall), $realtime, $verdict | Write-Host
}
