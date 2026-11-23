# lokal-testen.ps1 - Mini-Webserver zum Testen der App auf dem PC.
# Starten: Rechtsklick -> "Mit PowerShell ausfuehren"
#   oder im Terminal:  powershell -ExecutionPolicy Bypass -File .\lokal-testen.ps1
# Danach im Browser oeffnen: http://localhost:8080
# Beenden: Fenster schliessen oder Strg+C.
# (Diese Datei wird fuer die App selbst nicht gebraucht.)

param([int]$Port = 8080)

$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.json' = 'application/manifest+json; charset=utf-8'
  '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Schuldenbuch laeuft auf http://localhost:$Port  (Beenden mit Strg+C)"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
    if ($path.EndsWith('/')) { $path += 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/')))
    $response = $context.Response
    try {
      if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $response.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
        $response.Headers.Add('Cache-Control', 'no-cache')
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $response.StatusCode = 404
      }
    } catch {
      Write-Host "Fehler: $_"
    } finally {
      $response.Close()
    }
  }
} finally {
  $listener.Stop()
}
