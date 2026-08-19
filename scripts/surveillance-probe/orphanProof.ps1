# Does killing MediaMTX orphan a running transcoder?
#
# The full lifecycle run "passed" this with before=0 after=0 — there was no
# transcoder alive when MediaMTX was killed, so it asserted nothing. A green
# test that exercises nothing is worse than a missing one, because it stops
# anybody looking again.
#
# This starts a viewer, CONFIRMS a transcoder is actually running, and only
# then kills the media server.

$ErrorActionPreference = "Continue"
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ff   = Join-Path $dir "ffmpeg\ffmpeg-9.0.1-essentials_build\bin\ffmpeg.exe"
$mm   = Join-Path $dir "mediamtx\mediamtx.exe"
$work = Join-Path $env:TEMP "mtx-orphan"
$P    = "s0000orphan"

Get-Process ffmpeg,mediamtx -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Path $work | Out-Null

function Transcoders {
  @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape("/$P") -and
                   $_.CommandLine -match "-f rtsp" -and $_.CommandLine -notmatch "fakedvr" })
}

$yml = "logLevel: warn`napi: yes`napiAddress: 127.0.0.1:9997`nrtspAddress: 127.0.0.1:8554`nrtmp: no`nhls: no`nwebrtc: no`nsrt: no`npaths: {}`n"
$cfg = Join-Path $work "mediamtx.yml"
[System.IO.File]::WriteAllText($cfg, $yml, (New-Object System.Text.UTF8Encoding $false))

$mtx = Start-Process $mm -ArgumentList "`"$cfg`"" -WorkingDirectory $work -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $work "mtx.log") -RedirectStandardError (Join-Path $work "mtx.err")
Start-Sleep -Seconds 4

Invoke-RestMethod "http://127.0.0.1:9997/v3/config/paths/add/fakedvr" -Method Post -ContentType "application/json" -Body '{}' | Out-Null
$src = Join-Path $dir "bench-hevc-2048.mp4"
$fake = Start-Process $ff -ArgumentList @(
  "-hide_banner","-loglevel","error","-re","-stream_loop","-1","-i","`"$src`"",
  "-c","copy","-an","-f","rtsp","-rtsp_transport","tcp","rtsp://127.0.0.1:8554/fakedvr"
) -NoNewWindow -PassThru -RedirectStandardError (Join-Path $work "fake.err")
Start-Sleep -Seconds 8

$rawBody = @{ source = "rtsp://127.0.0.1:8554/fakedvr"; sourceOnDemand = $true; sourceOnDemandCloseAfter = "30s" } | ConvertTo-Json -Compress
Invoke-RestMethod "http://127.0.0.1:9997/v3/config/paths/add/${P}_raw" -Method Post -ContentType "application/json" -Body $rawBody | Out-Null

$cmd = "`"$ff`" -hide_banner -loglevel error -rtsp_transport tcp -i rtsp://127.0.0.1:8554/${P}_raw " +
       "-fps_mode passthrough -c:v h264_qsv -preset veryfast -profile:v main -b:v 2048k -g 50 " +
       "-bf 0 -async_depth 1 -forced_idr 1 -low_power 0 -bsf:v dump_extra=freq=keyframe -an " +
       "-f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/$P"
$pathBody = @{ runOnDemand = $cmd; runOnDemandRestart = $true; runOnDemandCloseAfter = "10s"; runOnDemandStartTimeout = "15s" } | ConvertTo-Json -Compress
Invoke-RestMethod "http://127.0.0.1:9997/v3/config/paths/add/$P" -Method Post -ContentType "application/json" -Body $pathBody | Out-Null
Start-Sleep -Seconds 3

$viewer = Start-Process $ff -ArgumentList @(
  "-hide_banner","-loglevel","error","-rtsp_transport","tcp","-i","rtsp://127.0.0.1:8554/$P","-f","null","-"
) -NoNewWindow -PassThru -RedirectStandardError (Join-Path $work "viewer.err")
Start-Sleep -Seconds 10

$running = Transcoders
"transcoders BEFORE kill : $($running.Count)"
if ($running.Count -eq 0) { "PRECONDITION FAILED - nothing to orphan, test is meaningless"; exit 1 }
$pids = $running.ProcessId
"transcoder pids         : $($pids -join ',')"

# Kill the media server out from under a LIVE transcode.
Stop-Process -Id $mtx.Id -Force -ErrorAction SilentlyContinue
"killed mediamtx"

foreach ($wait in 5,10,20,30) {
  Start-Sleep -Seconds 5
  $still = @($pids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
  "  t+{0,2}s : {1} of the original transcoders still alive" -f $wait, $still.Count
  if ($still.Count -eq 0) { break }
}

$leftover = @($pids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
""
if ($leftover.Count -eq 0) {
  "RESULT: PASS - no orphaned transcoder after MediaMTX exit"
} else {
  "RESULT: FAIL - $($leftover.Count) ORPHANED ffmpeg process(es) survived: $($leftover.Id -join ',')"
  "        these would hold an RTSP session against the recorder indefinitely"
}

Get-Process ffmpeg,mediamtx -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
