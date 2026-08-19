# On-demand stream lifecycle — proved with real processes.
#
# WHY THIS EXISTS
# ---------------
# The gateway sets `sourceOnDemand` and `runOnDemandCloseAfter` and the previous
# report called that a known gap, because CONFIGURING a lifecycle is not the
# same as having one. The earlier POC had to disable on-demand entirely: a 10 s
# close tore the source down underneath a running FFmpeg. The timeout was then
# raised to 30 s and re-enabled without anyone checking that 30 s was enough.
#
# So this counts actual OS processes at each step.
#
# NO RECORDER IS INVOLVED. A synthetic H.265 publisher stands in for the DVR,
# which makes the test repeatable, keeps it off the shop network, and needs no
# credential. What is being proved is the lifecycle machinery — start, reuse,
# grace, teardown, crash recovery — none of which depends on where the pixels
# came from.
#
# PROCESS ACCOUNTING
# ------------------
# Three kinds of ffmpeg exist during this test and they must not be confused:
#   fake recorder : publishes to  fakedvr        (argv has 'fakedvr' + '-f rtsp')
#   transcoder    : started BY MediaMTX on demand (argv has the path + '-f rtsp')
#   reader        : a stand-in viewer             (argv has '-f null')
# Every count below filters on those markers rather than counting ffmpeg.exe.

$ErrorActionPreference = "Continue"
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ff   = Join-Path $dir "ffmpeg\ffmpeg-9.0.1-essentials_build\bin\ffmpeg.exe"
$mm   = Join-Path $dir "mediamtx\mediamtx.exe"
$work = Join-Path $env:TEMP "mtx-lifecycle"
$PATHNAME = "s0000lifecycle"
$RAW = "${PATHNAME}_raw"

if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Path $work | Out-Null

$script:results = @()
function Check([string]$name, [bool]$ok, [string]$detail) {
  $script:results += [pscustomobject]@{ Scenario = $name; Pass = $ok; Detail = $detail }
  "{0} {1,-46} {2}" -f $(if($ok){"PASS"}else{"FAIL"}), $name, $detail | Write-Host
}

function TranscoderCount {
  @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape("/$PATHNAME") -and $_.CommandLine -match "-f rtsp" -and $_.CommandLine -notmatch "fakedvr" }).Count
}
function ReaderCount {
  @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match "-f null" }).Count
}
function PathReaders([string]$p) {
  try {
    $r = Invoke-RestMethod "http://127.0.0.1:9997/v3/paths/get/$p" -ErrorAction Stop
    return @($r.readers).Count
  } catch { return -1 }
}
function PathReady([string]$p) {
  try { (Invoke-RestMethod "http://127.0.0.1:9997/v3/paths/get/$p" -ErrorAction Stop).ready } catch { $false }
}

# ---- BOM-less config. PowerShell's -Encoding utf8 writes a BOM and MediaMTX
# ---- reports it as `unknown field "<BOM>logLevel"`.
$cfg = Join-Path $work "mediamtx.yml"
$yml = @"
logLevel: warn
api: yes
apiAddress: 127.0.0.1:9997
rtspAddress: 127.0.0.1:8554
rtmp: no
hls: no
webrtc: no
srt: no
paths: {}
"@
[System.IO.File]::WriteAllText($cfg, $yml, (New-Object System.Text.UTF8Encoding $false))

Write-Host "`n===== SETUP =====" -ForegroundColor Cyan
$mtx = Start-Process $mm -ArgumentList "`"$cfg`"" -WorkingDirectory $work -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $work "mtx.log") -RedirectStandardError (Join-Path $work "mtx.err")
Start-Sleep -Seconds 4

# The stand-in recorder: H.265, 960x1080, 25fps — the real device's shape.
#
# Streamed from a pre-encoded file with -c copy, NOT encoded live. The first
# version generated the pattern with libx265 in realtime, which needs more CPU
# than this two-core host has spare while a transcode is also running: the
# publisher fell behind, the source dropped, and the lifecycle assertions failed
# for a reason that had nothing to do with the lifecycle. A test rig that
# competes with the thing it is measuring produces confident nonsense.
$srcFile = Join-Path $dir "bench-hevc-2048.mp4"
if (-not (Test-Path $srcFile)) { throw "missing $srcFile - run bench-qsv.ps1 first" }

# The path must EXIST before anything may publish to it. With `paths: {}` and
# no catch-all, MediaMTX answers the RTSP ANNOUNCE with 400 Bad Request, which
# ffmpeg reports as "Could not write header (incorrect codec parameters ?)" —
# an error that points at the codec and has nothing to do with it. Two codecs
# and a bitstream filter were ruled out before the real cause showed up.
Invoke-RestMethod "http://127.0.0.1:9997/v3/config/paths/add/fakedvr" -Method Post `
  -ContentType "application/json" -Body '{}' | Out-Null

$fake = Start-Process $ff -ArgumentList @(
  "-hide_banner","-loglevel","error","-re","-stream_loop","-1","-i","`"$srcFile`"",
  "-c","copy","-an","-f","rtsp","-rtsp_transport","tcp","rtsp://127.0.0.1:8554/fakedvr"
) -NoNewWindow -PassThru -RedirectStandardError (Join-Path $work "fake.err")
Start-Sleep -Seconds 8
Check "stand-in recorder is publishing" ([bool](PathReady "fakedvr")) "path fakedvr ready"

# ---- the two-hop config the gateway would push, pushed the same way ----
$rawBody = @{ source = "rtsp://127.0.0.1:8554/fakedvr"; sourceProtocol = "tcp"
              sourceOnDemand = $true; sourceOnDemandCloseAfter = "30s" } | ConvertTo-Json -Compress
Invoke-RestMethod "http://127.0.0.1:9997/v3/config/paths/add/$RAW" -Method Post `
  -ContentType "application/json" -Body $rawBody | Out-Null

$cmd = "`"$ff`" -hide_banner -loglevel error -rtsp_transport tcp -i rtsp://127.0.0.1:8554/$RAW " +
       "-fps_mode passthrough -c:v h264_qsv -preset veryfast -profile:v main -b:v 2048k -g 50 " +
       "-bf 0 -async_depth 1 -forced_idr 1 -low_power 0 -bsf:v dump_extra=freq=keyframe -an " +
       "-f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/$PATHNAME"
$pathBody = @{ runOnDemand = $cmd; runOnDemandRestart = $true
               runOnDemandCloseAfter = "10s"; runOnDemandStartTimeout = "15s" } | ConvertTo-Json -Compress
Invoke-RestMethod "http://127.0.0.1:9997/v3/config/paths/add/$PATHNAME" -Method Post `
  -ContentType "application/json" -Body $pathBody | Out-Null
Start-Sleep -Seconds 3

function StartViewer([string]$tag) {
  Start-Process $ff -ArgumentList @(
    "-hide_banner","-loglevel","error","-rtsp_transport","tcp",
    "-i","rtsp://127.0.0.1:8554/$PATHNAME","-f","null","-"
  ) -NoNewWindow -PassThru -RedirectStandardError (Join-Path $work "viewer-$tag.err")
}

Write-Host "`n===== LIFECYCLE =====" -ForegroundColor Cyan

# S1 -------------------------------------------------------------------
Check "no viewers => no transcode process" ((TranscoderCount) -eq 0) "transcoders=$(TranscoderCount)"

# S2 -------------------------------------------------------------------
$sw = [Diagnostics.Stopwatch]::StartNew()
$v1 = StartViewer "1"
Start-Sleep -Seconds 8
$startupMs = $sw.ElapsedMilliseconds
$t2 = TranscoderCount
Check "first viewer starts exactly one transcode" ($t2 -eq 1) "transcoders=$t2 startup~$([int]($startupMs/1000))s"

# S3 -------------------------------------------------------------------
$v2 = StartViewer "2"
Start-Sleep -Seconds 7
$t3 = TranscoderCount; $r3 = PathReaders $PATHNAME
Check "second viewer REUSES, no second transcode" ($t3 -eq 1 -and $r3 -ge 2) "transcoders=$t3 readers=$r3"

# S4 -------------------------------------------------------------------
Stop-Process -Id $v1.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 6
$t4 = TranscoderCount; $r4 = PathReaders $PATHNAME
Check "one viewer leaves, stream survives for the other" ($t4 -eq 1 -and $r4 -ge 1) "transcoders=$t4 readers=$r4"

# S5 / S6 --------------------------------------------------------------
Stop-Process -Id $v2.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4                      # inside the 10 s grace
$t5 = TranscoderCount
Check "last viewer leaves => grace period holds it" ($t5 -eq 1) "transcoders=$t5 at t+4s of 10s grace"

$v3 = StartViewer "3"
Start-Sleep -Seconds 5
$t6 = TranscoderCount
Check "reconnect during grace reuses the session" ($t6 -eq 1) "transcoders=$t6"

# S7 -------------------------------------------------------------------
Stop-Process -Id $v3.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 20                     # past the 10 s grace
$t7 = TranscoderCount
Check "no reconnect => transcode terminates" ($t7 -eq 0) "transcoders=$t7 after grace+10s"

Write-Host "`n===== FAILURE MODES =====" -ForegroundColor Cyan

# S8: transcoder crash -------------------------------------------------
$v4 = StartViewer "4"; Start-Sleep -Seconds 8
$victim = Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" |
  Where-Object { $_.CommandLine -match [regex]::Escape("/$PATHNAME") -and $_.CommandLine -match "-f rtsp" -and $_.CommandLine -notmatch "fakedvr" } |
  Select-Object -First 1
if ($victim) { Stop-Process -Id $victim.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 12
$t8 = TranscoderCount
Check "transcoder crash is restarted while viewing" ($t8 -eq 1) "transcoders=$t8 (runOnDemandRestart)"

# S9: viewer killed abruptly (browser crash) ---------------------------
Stop-Process -Id $v4.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 22
$t9 = TranscoderCount
Check "abrupt viewer loss still tears down" ($t9 -eq 0) "transcoders=$t9"

# S10: source disconnect ----------------------------------------------
$v5 = StartViewer "5"; Start-Sleep -Seconds 8
Stop-Process -Id $fake.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 15
$t10 = TranscoderCount
Check "source disconnect leaves no wedged transcode" ($t10 -le 1) "transcoders=$t10 (source gone)"
Stop-Process -Id $v5.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 20

# S11: MediaMTX restart => no orphans ----------------------------------
$before = TranscoderCount
Stop-Process -Id $mtx.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 8
$t11 = TranscoderCount
Check "MediaMTX exit leaves no orphaned transcoder" ($t11 -eq 0) "before=$before after=$t11"

Write-Host "`n===== FINAL SWEEP =====" -ForegroundColor Cyan
$strayT = TranscoderCount
$strayR = ReaderCount
Check "zero orphaned transcoders at end" ($strayT -eq 0) "transcoders=$strayT"

Get-Process ffmpeg,mediamtx -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$passed = @($script:results | Where-Object { $_.Pass }).Count
$total  = $script:results.Count
Write-Host "`n=========================================="
Write-Host ("  {0}/{1} lifecycle scenarios passed" -f $passed, $total)
Write-Host "=========================================="
if ($passed -ne $total) {
  Write-Host "`nFAILURES:" -ForegroundColor Red
  $script:results | Where-Object { -not $_.Pass } | ForEach-Object { "  - $($_.Scenario): $($_.Detail)" }
}
