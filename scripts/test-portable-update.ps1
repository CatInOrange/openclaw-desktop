$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ("openclaw updater's [test] " + [Guid]::NewGuid().ToString('N'))
New-Item -Path $root -ItemType Directory | Out-Null
try {
 foreach ($scenario in @('success','hash-failure','launch-failure')) {
  $dir = Join-Path $root $scenario
  New-Item -Path $dir -ItemType Directory | Out-Null
  $target = Join-Path $dir 'client.exe'
  $source = Join-Path $dir 'download.exe'
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\where.exe') -Destination $target
  if ($scenario -eq 'launch-failure') { [IO.File]::WriteAllText($source, 'not an executable') }
  else { Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\whoami.exe') -Destination $source }
  $original = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  $expected = $hash
  if ($scenario -eq 'hash-failure') { $hash = '0' * 64 }
  $result = Join-Path $dir 'result.json'
  $payload = Join-Path $dir 'payload.json'
  $commit = Join-Path $dir 'commit'
  'test-token' | Set-Content -LiteralPath $commit -Encoding ASCII
  @{commit=$commit;cancel=(Join-Path $dir 'cancel');token='test-token';target=$target;source=$source;hash=$hash;result=$result;ready=(Join-Path $dir 'ready');version='test';pid=2147483647} | ConvertTo-Json | Set-Content -LiteralPath $payload -Encoding UTF8
  & (Join-Path $PSScriptRoot '..\src\portable-update.ps1') -PayloadPath $payload
  $outcome = Get-Content -LiteralPath $result -Raw | ConvertFrom-Json
  $after = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($scenario -eq 'success') {
   if ($outcome.phase -ne 'installed' -or $after -ne $expected) { throw 'Replacement did not install the verified file' }
   if ((Get-FileHash -LiteralPath ($target + '.previous.exe') -Algorithm SHA256).Hash -ne $original) { throw 'Backup was not preserved' }
  } else {
   if ($outcome.phase -ne 'failed' -or $after -ne $original.ToLowerInvariant()) { throw "$scenario did not preserve/restore the old client" }
  }
 }
 Write-Output 'Portable update: replacement, checksum rejection and launch-failure rollback verified (non-GUI).'
} finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
