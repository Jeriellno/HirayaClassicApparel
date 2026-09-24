# Isolate WHERE the request hangs: framework boot vs DB vs route.
Set-Location c:\hiraya\hiraya-backend

$targets = @(
    'http://127.0.0.1:8000/up',
    'http://127.0.0.1:8000/api/products'
)

foreach ($url in $targets) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 40
        Write-Output ('OK   ' + $r.StatusCode + '  ' + [math]::Round($sw.Elapsed.TotalSeconds,2) + 's  ' + $url)
    } catch {
        Write-Output ('FAIL ' + [math]::Round($sw.Elapsed.TotalSeconds,2) + 's  ' + $url + '  ' + $_.Exception.Message)
    }
}
