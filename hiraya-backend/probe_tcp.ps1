# Raw TCP probe: does the request even reach the built-in server?
$ErrorActionPreference = 'Continue'

$client = New-Object System.Net.Sockets.TcpClient
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $client.Connect('127.0.0.1', 8000)
    Write-Output ('TCP connect: OK in ' + [math]::Round($sw.Elapsed.TotalSeconds,2) + 's')

    $stream = $client.GetStream()
    $stream.ReadTimeout = 15000
    $stream.WriteTimeout = 15000

    $req = "GET /up HTTP/1.1`r`nHost: 127.0.0.1:8000`r`nConnection: close`r`n`r`n"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($req)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()

    $sw2 = [System.Diagnostics.Stopwatch]::StartNew()
    $buffer = New-Object byte[] 4096
    $read = $stream.Read($buffer, 0, $buffer.Length)
    Write-Output ('First byte after ' + [math]::Round($sw2.Elapsed.TotalSeconds,2) + 's, bytes=' + $read)
    if ($read -gt 0) {
        Write-Output ([System.Text.Encoding]::ASCII.GetString($buffer, 0, [Math]::Min($read, 300)))
    }
} catch {
    Write-Output ('ERROR: ' + $_.Exception.Message)
} finally {
    $client.Close()
}
