# Clean-slate backend start + probe.
Set-Location c:\hiraya\hiraya-backend

Write-Output '--- starting ONE clean backend on 8000 ---'
Start-Process -FilePath 'C:\xampp\php\php.exe' -ArgumentList 'artisan','serve','--host=127.0.0.1','--port=8000' -WindowStyle Hidden
Start-Sleep -Seconds 6

$client = New-Object System.Net.Sockets.TcpClient
$client.Connect('127.0.0.1', 8000)
$stream = $client.GetStream()
$stream.ReadTimeout = 30000
$req = "GET /up HTTP/1.1`r`nHost: 127.0.0.1:8000`r`nConnection: close`r`n`r`n"
$bytes = [System.Text.Encoding]::ASCII.GetBytes($req)
$stream.Write($bytes, 0, $bytes.Length); $stream.Flush()

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$buffer = New-Object byte[] 4096
try {
    $read = $stream.Read($buffer, 0, $buffer.Length)
    Write-Output ('/up  responded in ' + [math]::Round($sw.Elapsed.TotalSeconds,2) + 's  bytes=' + $read)
    Write-Output ([System.Text.Encoding]::ASCII.GetString($buffer, 0, [Math]::Min($read, 200)))
} catch {
    Write-Output ('/up  FAILED after ' + [math]::Round($sw.Elapsed.TotalSeconds,2) + 's : ' + $_.Exception.Message)
}
$client.Close()

# Now the real API endpoint.
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/products' -UseBasicParsing -TimeoutSec 40
    Write-Output ('/api/products  OK ' + $r.StatusCode + ' in ' + [math]::Round($sw.Elapsed.TotalSeconds,2) + 's')
} catch {
    Write-Output ('/api/products  FAIL after ' + [math]::Round($sw.Elapsed.TotalSeconds,2) + 's : ' + $_.Exception.Message)
}
