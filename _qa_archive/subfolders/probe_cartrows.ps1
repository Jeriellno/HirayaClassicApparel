$base = "http://127.0.0.1:8000/api"
$login = Invoke-RestMethod -Uri "$base/login" -Method Post -Body '{"email":"aya@hiraya.com","password":"password123"}' -ContentType "application/json" -TimeoutSec 60
$h = @{ Authorization = "Bearer $($login.token)"; Accept = "application/json" }

Write-Output "=== current cart rows ==="
$cart = Invoke-RestMethod -Uri "$base/cart" -Headers $h -TimeoutSec 60
foreach ($i in $cart.items) {
  Write-Output ('  row#' + $i.id + ' product=' + $i.product_id + ' size=' + $i.selected_size + ' color=' + $i.selected_color + ' qty=' + $i.quantity)
}

Write-Output ""
Write-Output "=== product 15 sizes shape (what the heart reads) ==="
$p = Invoke-RestMethod -Uri "$base/products/15" -TimeoutSec 60
Write-Output ('  sizes  type: ' + $p.sizes.GetType().Name)
Write-Output ('  sizes  value: ' + ($p.sizes | ConvertTo-Json -Compress))
Write-Output ('  colors type: ' + $p.colors.GetType().Name)
Write-Output ('  colors value: ' + ($p.colors | ConvertTo-Json -Compress))
Write-Output ('  sizes[0] -> ' + ($p.sizes[0] | Out-String).Trim() + '   (PowerShell index on PSObject)')
