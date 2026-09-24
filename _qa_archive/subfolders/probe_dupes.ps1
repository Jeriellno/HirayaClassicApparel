$base = "http://127.0.0.1:8000/api"
$login = Invoke-RestMethod -Uri "$base/login" -Method Post -Body '{"email":"aya@hiraya.com","password":"password123"}' -ContentType "application/json" -TimeoutSec 60
$h = @{ Authorization = "Bearer $($login.token)"; Accept = "application/json" }

$cart = Invoke-RestMethod -Uri "$base/cart" -Headers $h -TimeoutSec 60

Write-Output ('count field : ' + $cart.count)
Write-Output ('total field : ' + $cart.total)
Write-Output ('rows        : ' + (@($cart.items)).Count)
Write-Output ''

Write-Output '=== every cart row ==='
foreach ($i in $cart.items) {
  $pname = if ($i.product) { $i.product.name } else { '(NULL product)' }
  $pcat  = if ($i.product) { $i.product.category } else { '-' }
  Write-Output ('  row#{0} product={1} name={2} cat={3} size={4} color={5} qty={6}' -f $i.id, $i.product_id, $pname, $pcat, $i.selected_size, $i.selected_color, $i.quantity)
}

Write-Output ''
Write-Output '=== duplicate analysis (same product_id) ==='
$groups = $cart.items | Group-Object { $_.product_id }
foreach ($g in $groups) {
  if ($g.Count -gt 1) {
    Write-Output ('  product {0}: {1} ROWS' -f $g.Name, $g.Count)
    foreach ($r in $g.Group) {
      Write-Output ('     size={0} color={1} qty={2}' -f $r.selected_size, $r.selected_color, $r.quantity)
    }
  } else {
    Write-Output ('  product {0}: 1 row (qty {1})' -f $g.Name, $g.Group[0].quantity)
  }
}
