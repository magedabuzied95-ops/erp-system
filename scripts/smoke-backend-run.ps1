$ErrorActionPreference = "Stop"
$env:SKIP_STARTUP_SYNCS = "true"
$env:EVOLUTION_API_URL = ""
$env:EVOLUTION_API_KEY = ""
$env:EVOLUTION_INSTANCE_NAME = ""
$env:WEBHOOK_PUBLIC_URL = ""

$root = "C:\Users\Tiger Store\Desktop\ERP system"
$out = Join-Path $root ".codex-smoke-backend.out.log"
$err = Join-Path $root ".codex-smoke-backend.err.log"

Start-Process -FilePath "node.exe" -ArgumentList "server.js" -WorkingDirectory (Join-Path $root "server") -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden
