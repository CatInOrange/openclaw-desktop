param([Parameter(Mandatory=$true)][string]$PayloadPath)
$ErrorActionPreference = 'Stop'
$payload = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8 | ConvertFrom-Json
$replaced = $false
$clientExited = $false
$committed = $false
$backup = $payload.target + '.previous.exe'
$incoming = $payload.target + '.update-new'
function File-Hash([string]$FilePath) {
 $algorithm = [Security.Cryptography.SHA256]::Create()
 $stream = [IO.File]::OpenRead($FilePath)
 try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
 finally { $stream.Dispose(); $algorithm.Dispose() }
}
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
 # Acknowledge bootstrap before hashing the large EXE. The client already
 # verified its download; the helper verifies it again only after handoff.
 $payload.token | Set-Content -LiteralPath $payload.ready -Encoding ASCII
 $commitDeadline = [DateTime]::UtcNow.AddSeconds(40)
 $committed = $false
 do {
  if (Test-Path -LiteralPath $payload.cancel) { throw 'Update handoff cancelled' }
  if (Test-Path -LiteralPath $payload.commit) {
   if ((Get-Content -LiteralPath $payload.commit -Raw).Trim() -eq $payload.token) { $committed=$true; break }
  }
  Start-Sleep -Milliseconds 100
 } while ([DateTime]::UtcNow -lt $commitDeadline)
 if (-not $committed) { throw 'No client commit received; no files replaced' }
 $parent = Get-Process -Id $payload.pid -ErrorAction SilentlyContinue
 if ($parent -and -not $parent.WaitForExit(60000)) { throw 'Client did not exit; update cancelled' }
 $clientExited = $true
 if ((File-Hash $payload.source) -ne $payload.hash) { throw 'Downloaded update checksum mismatch' }
 Copy-Item -LiteralPath $payload.source -Destination $incoming -Force
 if ((File-Hash $incoming) -ne $payload.hash) { throw 'Staged update checksum mismatch' }
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
 Write-Output ('Updater: ' + $failure)
 if ($committed) { Write-Result 'failed' $failure }
 if ($clientExited -and -not $replaced) {
  try { Start-Client } catch {}
 }
} finally {
 Remove-Item -LiteralPath $incoming -Force -ErrorAction SilentlyContinue
 if ($clientExited) {
  # The large download is no longer needed once replacement/rollback finishes.
  Remove-Item -LiteralPath $payload.source -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $payload.ready -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $PayloadPath -Force -ErrorAction SilentlyContinue
 }
}
