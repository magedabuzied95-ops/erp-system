param(
  [string[]]$Paths = @("src/storefront/Storefront.jsx", "src/modules/orders/pages/OrderDetails.jsx", "src/modules/pos/components/RecentOperationsDrawer.jsx")
)

$enc = [System.Text.Encoding]::GetEncoding(1256)
$utf8 = [System.Text.Encoding]::UTF8
$pattern = [regex]'[^\u0000-\u007F]{4,}'

function Repair-MojibakeText {
  param([string]$Text)

  $pattern.Replace($Text, {
    param($match)
    $original = $match.Value
    try {
      $converted = $utf8.GetString($enc.GetBytes($original))
      if ($converted -notmatch '�' -and $converted -match '[\u0600-\u06FF]') {
        return $converted
      }
    } catch {
      return $original
    }

    return $original
  })
}

foreach ($path in $Paths) {
  if (-not (Test-Path -LiteralPath $path)) {
    continue
  }

  $content = Get-Content -LiteralPath $path -Raw
  $fixed = Repair-MojibakeText -Text $content
  if ($fixed -ne $content) {
    Set-Content -LiteralPath $path -Value $fixed -Encoding utf8
  }
}
