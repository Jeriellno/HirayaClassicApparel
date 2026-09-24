# Measure backend responsiveness after the driver fix.
Set-Location c:\hiraya\hiraya-backend

Write-Output '--- starting backend ---'
Start-Process -FilePath 'C:\xampp\php\php.exe' -ArgumentList 'artisan','serve','--host=127.0.0.1','--port=8000' -WindowStyle Hidden
Start-Sleep -Seconds 5

$endpoints = @(
    'http://127.0.0.1:8000/api/products',
    'http://127.0.0.1:8000/api/products',
    'http://127.0.0.1:8000/api/outfits/recommended'
)

foreach ($url in $endpoints) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
        Write-Output ('OK   ' + $r.StatusCode + '  ' + [math]::Round($sw.Elapsed.TotalSeconds,2) + 's  ' + $url)
    } catch {
        Write-Output ('FAIL ' + [math]::Round($sw.Elapsed.TotalSeconds,2) + 's  ' + $url + '  ' + $_.Exception.Message)
    }
}
