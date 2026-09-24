$urls = @(
  "http://127.0.0.1:8000/api/cart",
  "http://127.0.0.1:8000/api/wishlist",
  "http://127.0.0.1:8000/api/user/measurements",
  "http://127.0.0.1:8000/api/outfits/recommended?limit=6",
  "http://127.0.0.1:8000/api/products"
)

$sw = [System.Diagnostics.Stopwatch]::StartNew()

$jobs = @()
foreach ($u in $urls) {
  $jobs += Start-Job -ScriptBlock {
    param($url)
    $s = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      $r = Invoke-WebRequest -Uri $url -TimeoutSec 90 -UseBasicParsing
      "$url -> HTTP $($r.StatusCode) in $($s.ElapsedMilliseconds)ms"
    } catch {
      "$url -> ERR in $($s.ElapsedMilliseconds)ms : $($_.Exception.Message)"
    }
  } -ArgumentList $u
}

$jobs | Wait-Job -Timeout 120 | Out-Null
$jobs | Receive-Job
$jobs | Remove-Job -Force

"TOTAL WALL: $($sw.ElapsedMilliseconds)ms"
