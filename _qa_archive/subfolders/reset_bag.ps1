$base = "http://127.0.0.1:8000/api"
$login = Invoke-RestMethod -Uri "$base/login" -Method Post -Body '{"email":"aya@hiraya.com","password":"password123"}' -ContentType "application/json" -TimeoutSec 60
$h = @{ Authorization = "Bearer $($login.token)"; Accept = "application/json" }

$cart = Invoke-RestMethod -Uri "$base/cart" -Headers $h -TimeoutSec 60
Write-Output '=== rows before reset ==='
foreach ($i in $cart.items) {
  Write-Output ('  row#{0} product={1} size={2} qty={3}' -f $i.id, $i.product_id, $i.selected_size, $i.quantity)
}

Write-Output ''
Write-Output '=== clearing the bag (test data accumulated by the heart bug) ==='
try {
  $r = Invoke-WebRequest -Uri "$base/cart" -Method Delete -Headers $h -TimeoutSec 60 -UseBasicParsing
  Write-Output ('  DELETE /cart -> HTTP ' + $r.StatusCode)
} catch {
  $code = 0; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  Write-Output ('  DELETE /cart -> HTTP ' + $code)
}

$after = Invoke-RestMethod -Uri "$base/cart" -Headers $h -TimeoutSec 60
Write-Output ('  rows now: ' + (@($after.items)).Count + '  count=' + $after.count)
