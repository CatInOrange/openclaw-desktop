param([Parameter(Mandatory=$true)][string]$PayloadPath)
$ErrorActionPreference = 'Stop'
$payload = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8 | ConvertFrom-Json
$replaced = $false
$clientExited = $false
$backup = $payload.target + '.previous.exe'
$incoming = $payload.target + '.update-new'
function Write-Result([string]$phase,[string]$message) {
 @{phase=$phase;message=$message;version=$payload.version;backup=$backup} | ConvertTo-Json | Set-Content -LiteralPath $payload.result -Encoding UTF8
}
function Start-Client {
 $start = New-Object System.Diagnostics.ProcessStartInfo
 $start.FileName = $payload.target
 $start.WorkingDirectory = [IO.Path]::GetDirectoryName($payload.target)
 $start.UseShellExecute = $false
 $start.CreateNoWindow = $true
 # Do not let the new portable launcher inherit the old extraction metadata.
 foreach ($key in @('PORTABLE_EXECUTABLE_FILE','PORTABLE_EXECUTABLE_DIR','PORTABLE_EXECUTABLE_APP_FILENAME','ELECTRON_RUN_AS_NODE')) { $start.EnvironmentVariables.Remove($key) }
 [Diagnostics.Process]::Start($start) | Out-Null
}
try {
 if ((Get-FileHash -LiteralPath $payload.source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $payload.hash) { throw 'Downloaded update checksum mismatch' }
 # A readiness receipt lets the client stay open if PowerShell cannot start.
 'ready' | Set-Content -LiteralPath $payload.ready -Encoding ASCII
 $parent = Get-Process -Id $payload.pid -ErrorAction SilentlyContinue
 if ($parent -and -not $parent.WaitForExit(60000)) { throw 'Client did not exit; update cancelled' }
 $clientExited = $true
 Copy-Item -LiteralPath $payload.source -Destination $incoming -Force
 if ((Get-FileHash -LiteralPath $incoming -Algorithm SHA256).Hash.ToLowerInvariant() -ne $payload.hash) { throw 'Staged update checksum mismatch' }
 # The portable NSIS launcher may hold the EXE after Electron exits. Retry
 # atomic replacement without deleting the live file or its previous backup.
 $deadline = [DateTime]::UtcNow.AddSeconds(60)
 do {
  try { [IO.File]::Replace($incoming, $payload.target, $backup, $true); $replaced=$true; break }
  catch { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 500 }
 } while ($true)
 Write-Result 'installed' 'Update installed; previous EXE retained beside the client.'
 Start-Client
} catch {
 $failure = $_.Exception.Message
 if ($replaced) {
  try {
   [IO.File]::Replace($backup, $payload.target, $payload.target + '.failed-update.exe', $true)
   $replaced = $false
  } catch { $failure += '; rollback failed: ' + $_.Exception.Message }
 }
 Write-Result 'failed' $failure
 if ($clientExited -and -not $replaced) {
  try { Start-Client } catch {}
 }
} finally {
 Remove-Item -LiteralPath $incoming -Force -ErrorAction SilentlyContinue
}
