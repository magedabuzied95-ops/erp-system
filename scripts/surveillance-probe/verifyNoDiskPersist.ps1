# Does MediaMTX write API-added paths back to its config file?
#
# WHY THIS DECIDES THE SECRET DESIGN
# ----------------------------------
# The whole runtime-secret plan rests on one assumption: that pushing a
# credentialed source URL through the control API keeps it in MediaMTX's MEMORY
# and never on disk. If MediaMTX serialises its running config back to the yml,
# then the API approach is no better than the POC's static file -- it just puts
# the credential on disk a second later and with less warning.
#
# Assumptions like this are exactly what should be measured rather than
# believed, so this plants a recognisable fake credential through the API and
# then greps the entire working directory for it.

$ErrorActionPreference = "Stop"
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$mm   = Join-Path $dir "mediamtx\mediamtx.exe"
$work = Join-Path $env:TEMP "mtx-persist-check"
$canary = "CANARY-b7f31e9d-DO-NOT-SHIP"

if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Path $work | Out-Null

# A minimal config with NO paths and NO credentials -- the shape the media host
# is supposed to run in permanently.
@"
logLevel: warn
api: yes
apiAddress: 127.0.0.1:9997
rtspAddress: 127.0.0.1:8554
rtmp: no
hls: no
webrtc: no
srt: no
paths: {}
"@ | ForEach-Object { [System.IO.File]::WriteAllText((Join-Path $work "mediamtx.yml"), $_, (New-Object System.Text.UTF8Encoding $false)) }

$cfg = Join-Path $work "mediamtx.yml"
$before = Get-FileHash $cfg -Algorithm SHA256
"config before : $($before.Hash.Substring(0,16))"

$p = Start-Process -FilePath $mm -ArgumentList "`"$cfg`"" -WorkingDirectory $work `
      -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $work "out.log") `
      -RedirectStandardError (Join-Path $work "err.log")
Start-Sleep -Seconds 4

try {
  # Push a path whose source carries the canary in the password position.
  $body = @{
    source = "rtsp://probeuser:$canary@192.0.2.77:554/cam/realmonitor?channel=1"
    sourceOnDemand = $true
  } | ConvertTo-Json -Compress

  $r = Invoke-WebRequest -Uri "http://127.0.0.1:9997/v3/config/paths/add/canarytest" `
        -Method Post -ContentType "application/json" -Body $body -UseBasicParsing
  "api add       : HTTP $($r.StatusCode)"

  Start-Sleep -Seconds 3

  # Does the API report it back? (proves it really took effect in memory)
  $list = Invoke-WebRequest -Uri "http://127.0.0.1:9997/v3/config/paths/list" -UseBasicParsing
  "path in memory: $(if ($list.Content -match 'canarytest') { 'YES' } else { 'no' })"
  "canary in API : $(if ($list.Content -match [regex]::Escape($canary)) { 'YES (expected - it is the running config)' } else { 'no' })"
}
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

$after = Get-FileHash $cfg -Algorithm SHA256
"config after  : $($after.Hash.Substring(0,16))"
"config changed: $(if ($before.Hash -ne $after.Hash) { 'YES -- CREDENTIAL WOULD PERSIST' } else { 'no' })"

""
"=== canary anywhere on disk under the working dir? ==="
$hits = Get-ChildItem $work -Recurse -File | ForEach-Object {
  $t = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
  if ($t -and $t.Contains($canary)) { $_.FullName }
}
if ($hits) { $hits | ForEach-Object { "  LEAKED IN: $_" } } else { "  none - credential never touched disk" }

""
"=== canary in the mediamtx logs? ==="
$logHits = @("out.log","err.log") | ForEach-Object {
  $f = Join-Path $work $_
  if (Test-Path $f) { $t = Get-Content $f -Raw -ErrorAction SilentlyContinue
    if ($t -and $t.Contains($canary)) { $_ } }
}
if ($logHits) { $logHits | ForEach-Object { "  LEAKED IN LOG: $_" } } else { "  none" }
