param([string]$ElectronRuntime = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$project = Split-Path $PSScriptRoot -Parent
$launcher = Join-Path $project 'src\directory-launcher.exe'
if (-not (Test-Path $launcher)) { & (Join-Path $PSScriptRoot 'build-directory-launcher.ps1') }
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("OpenClaw directory 测试 [native]'s " + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$probeSource = Join-Path $testRoot 'Probe.cs'
$probe = Join-Path $testRoot 'Probe.exe'
@'
using System;
using System.IO;
using System.Threading;
using System.Diagnostics;
using System.Web.Script.Serialization;
using System.Collections.Generic;
class Probe {
 public static int Main() {
  string dir=AppDomain.CurrentDomain.BaseDirectory;
  string root=Environment.GetEnvironmentVariable("OPENCLAW_INSTALL_ROOT");
  string token=Environment.GetEnvironmentVariable("OPENCLAW_LAUNCH_TOKEN");
  string mode=File.ReadAllText(Path.Combine(dir,"behavior.txt")).Trim();
  var row=new Dictionary<string,object>{{"pid",Process.GetCurrentProcess().Id},{"version",new DirectoryInfo(dir).Name},{"root",root},{"token",token},{"runAsNode",Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE")},{"portable",Environment.GetEnvironmentVariable("PORTABLE_EXECUTABLE_FILE")}};
  File.AppendAllText(Path.Combine(root,"starts.jsonl"),new JavaScriptSerializer().Serialize(row)+Environment.NewLine);
  if(mode=="fail")return 23;
  if(mode=="noack"){Thread.Sleep(20000);return 0;}
  if(mode=="parent") {while(!File.Exists(Path.Combine(root,"release-parent")))Thread.Sleep(50);return 0;}
  if(token!=null){Directory.CreateDirectory(Path.Combine(root,".update"));File.WriteAllText(Path.Combine(root,".update","health-"+token+".json"),token);}
  return 0;
 }
}
'@ | Set-Content -LiteralPath $probeSource -Encoding UTF8
& $compiler /nologo /target:exe /optimize+ /reference:System.Web.Extensions.dll "/out:$probe" $probeSource
if ($LASTEXITCODE -ne 0) { throw 'Native probe compilation failed' }
function Assert($value, [string]$message) { if (-not $value) { throw $message } }
function Write-Json([string]$file, $value) { [IO.File]::WriteAllText($file, ($value | ConvertTo-Json -Depth 20 -Compress), (New-Object Text.UTF8Encoding($false))) }
function Read-Json([string]$file) { return [IO.File]::ReadAllText($file) | ConvertFrom-Json }
function Start-Hidden([string]$file, [string[]]$arguments) {
 $info = New-Object Diagnostics.ProcessStartInfo
 $info.FileName = $file
 $info.UseShellExecute = $false
 $info.CreateNoWindow = $true
 $info.WorkingDirectory = $testRoot
 # All test args are paths, and none contains a double quote or trailing slash.
 $info.Arguments = (($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
 return [Diagnostics.Process]::Start($info)
}
function Wait-File([string]$file, [int]$milliseconds = 15000) {
 $until = [DateTime]::UtcNow.AddMilliseconds($milliseconds)
 while ([DateTime]::UtcNow -lt $until) { if ([IO.File]::Exists($file) -and ([IO.FileInfo]$file).Length -gt 0) { return }; Start-Sleep -Milliseconds 50 }
 throw "Timed out waiting for $([IO.Path]::GetFileName($file))"
}
function Starts([string]$root) { $file = Join-Path $root 'starts.jsonl'; if (Test-Path -LiteralPath $file) { return @([IO.File]::ReadAllLines($file) | ForEach-Object { $_ | ConvertFrom-Json }) }; return @() }
function Stop-Probes([string]$root) {
 foreach ($row in (Starts $root)) { try { $p = [Diagnostics.Process]::GetProcessById([int]$row.pid); if (-not $p.HasExited) { $location=$p.MainModule.FileName; $allowed=[IO.Path]::GetFullPath((Join-Path $root 'versions')) + [IO.Path]::DirectorySeparatorChar; if ($location.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { $p.Kill(); $p.WaitForExit(3000) | Out-Null } }; $p.Dispose() } catch {} }
}
function New-Version([string]$directory, [string]$version, [string]$behavior = 'ok', [bool]$badExe = $false) {
 $dir = Join-Path $directory "versions\$version"
 [IO.Directory]::CreateDirectory($dir) | Out-Null
 if ($badExe) { [IO.File]::WriteAllText((Join-Path $dir 'OpenClaw Desktop.exe'), 'not PE') } else { [IO.File]::Copy($probe, (Join-Path $dir 'OpenClaw Desktop.exe')) }
 [IO.File]::WriteAllText((Join-Path $dir 'behavior.txt'), $behavior)
 $files = @(Get-ChildItem -LiteralPath $dir -File | ForEach-Object { @{ path = $_.Name; size = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
 Write-Json (Join-Path $dir 'update-manifest.json') @{schema = 1; version = $version; files = $files}
}
function New-Case([string]$name, [string]$newBehavior = 'ok', [bool]$badExe = $false) {
 $case = Join-Path $testRoot $name
 $root = Join-Path $case 'app'
 [IO.Directory]::CreateDirectory($root) | Out-Null
 [IO.File]::Copy($launcher, (Join-Path $root 'OpenClaw.exe'))
 New-Version $root '0.4.6'
 Write-Json (Join-Path $root 'current.json') @{schema = 1; version = '0.4.6'}
 $distribution = Join-Path $case 'distribution'
 [IO.Directory]::CreateDirectory($distribution) | Out-Null
 [IO.File]::Copy($launcher, (Join-Path $distribution 'OpenClaw.exe'))
 New-Version $distribution '0.4.7' $newBehavior $badExe
 Write-Json (Join-Path $distribution 'current.json') @{schema = 1; version = '0.4.7'}
 $helper = Join-Path $case 'helper.exe'; [IO.File]::Copy($launcher, $helper)
 return @{case = $case; root = $root; distribution = $distribution; helper = $helper}
}
function Payload($case, [string]$hash = '', [int]$parentPid = 2147483647) {
 $source = Join-Path $case.case 'download.zip'
 $archive = [IO.Compression.ZipFile]::Open($source, [IO.Compression.ZipArchiveMode]::Create)
 try {
  foreach ($item in (Get-ChildItem -LiteralPath $case.distribution -File -Recurse)) {
   $relative = $item.FullName.Substring($case.distribution.Length + 1).Replace('\','/')
   [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $item.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
 } finally { $archive.Dispose() }
 if (-not $hash) { $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() }
 $token = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')).Substring(0,48)
 $payload = @{root = $case.root; source = $source; hash = $hash; version = '0.4.7'; fromVersion = '0.4.6'; result = (Join-Path $case.case 'result.json'); ready = (Join-Path $case.case 'ready'); commit = (Join-Path $case.case 'commit'); cancel = (Join-Path $case.case 'cancel'); token = $token; pid = $parentPid; healthTimeoutMs = 5000}
 $payloadFile = Join-Path $case.case 'payload.json'; Write-Json $payloadFile $payload
 return @{data = $payload; file = $payloadFile}
}
function Handoff($case, $payload, [bool]$commit = $true) {
 $p = Start-Hidden $case.helper @('--apply', $payload.file)
 Wait-File $payload.data.ready
 Assert (([IO.File]::ReadAllText($payload.data.ready)) -eq $payload.data.token) 'Readiness token mismatch'
 if ($commit) { [IO.File]::WriteAllText($payload.data.commit, $payload.data.token) }
 return $p
}
function Wait-Helper($p, [int]$milliseconds = 20000) { Assert ($p.WaitForExit($milliseconds)) 'Directory helper did not settle'; return $p.ExitCode }
try {
 $case = New-Case 'normal-launch'
 $env:OPENCLAW_INSTALL_ROOT = $case.root
 $env:ELECTRON_RUN_AS_NODE = '1'; $env:PORTABLE_EXECUTABLE_FILE = 'must-not-inherit'
 $normal = Start-Hidden (Join-Path $case.root 'OpenClaw.exe') @()
 Assert ($normal.WaitForExit(10000)) 'Launcher did not return'
 Wait-File (Join-Path $case.root 'starts.jsonl')
 $row = (Starts $case.root)[0]
 Assert ($row.root -eq $case.root) 'Install root was not propagated'
 Assert (-not $row.runAsNode -and -not $row.portable) 'Launcher leaked portable or Electron Node-mode flags'
 Remove-Item Env:ELECTRON_RUN_AS_NODE,Env:PORTABLE_EXECUTABLE_FILE
 Write-Output 'PASS: fixed launcher starts current version and clears inherited bootstrap flags'

 foreach ($scenario in @('success', 'hash-failure', 'manifest-tamper', 'traversal', 'duplicate-path', 'startup-failure', 'health-timeout', 'cancel', 'stale-from-version', 'pointer-write-failure', 'locked-source', 'actual-parent-exit', 'no-commit')) {
  $behavior = if ($scenario -eq 'health-timeout') { 'noack' } else { 'ok' }
  $case = New-Case $scenario $behavior ($scenario -eq 'startup-failure')
  $env:OPENCLAW_INSTALL_ROOT = $case.root
  if ($scenario -eq 'manifest-tamper') { [IO.File]::AppendAllText((Join-Path $case.distribution 'versions\0.4.7\behavior.txt'), ' altered') }
  $parent = $null
  if ($scenario -eq 'actual-parent-exit') {
   [IO.File]::WriteAllText((Join-Path $case.root 'versions\0.4.6\behavior.txt'), 'parent')
   $parent = Start-Hidden (Join-Path $case.root 'versions\0.4.6\OpenClaw Desktop.exe') @()
   Wait-File (Join-Path $case.root 'starts.jsonl')
  }
  $payload = if ($parent) { Payload $case '' $parent.Id } elseif ($scenario -eq 'hash-failure') { Payload $case ('0' * 64) } else { Payload $case }
  if ($scenario -eq 'health-timeout') { $payload.data.healthTimeoutMs = 1000; Write-Json $payload.file $payload.data }
  if ($scenario -eq 'stale-from-version') { $payload.data.fromVersion = '0.4.5'; Write-Json $payload.file $payload.data }
  if ($scenario -in @('traversal','duplicate-path')) {
   $zip = [IO.Compression.ZipFile]::Open($payload.data.source, [IO.Compression.ZipArchiveMode]::Update)
   try {
    $entry = if ($scenario -eq 'traversal') { $zip.CreateEntry('../escaped.txt') } else { $zip.CreateEntry('versions/0.4.7/BEHAVIOR.txt') }
    $stream = $entry.Open(); try { $bytes = [Text.Encoding]::UTF8.GetBytes('bad'); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
   } finally { $zip.Dispose() }
   $payload.data.hash = (Get-FileHash -LiteralPath $payload.data.source -Algorithm SHA256).Hash.ToLowerInvariant(); Write-Json $payload.file $payload.data
  }
  $heldFile=$null
  if ($scenario -eq 'pointer-write-failure') { $heldFile=[IO.FileStream]::new((Join-Path $case.root 'current.json'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read) }
  if ($scenario -eq 'locked-source') { $heldFile=[IO.FileStream]::new($payload.data.source,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite) }
  $withoutCommit = $scenario -in @('cancel','no-commit')
  $p = Handoff $case $payload (-not $withoutCommit)
  if ($scenario -eq 'cancel') { [IO.File]::WriteAllText($payload.data.cancel, 'cancel') }
  if ($scenario -eq 'actual-parent-exit') {
   Start-Sleep -Milliseconds 300
   Assert ((Read-Json (Join-Path $case.root 'current.json')).version -eq '0.4.6') 'Pointer changed while parent was alive'
   [IO.File]::WriteAllText((Join-Path $case.root 'release-parent'), 'exit')
  }
  $exit = Wait-Helper $p $(if ($scenario -eq 'no-commit') { 45000 } else { 20000 })
  if ($heldFile) { $heldFile.Dispose() }
  $pointer = Read-Json (Join-Path $case.root 'current.json')
  if ($scenario -in @('success','actual-parent-exit')) {
   Assert ($exit -eq 0) 'Successful update helper failed'
   Assert ($pointer.version -eq '0.4.7' -and $pointer.previous -eq '0.4.6') 'Successful pointer switch missing backup'
   Assert ((Read-Json $payload.data.result).phase -eq 'installed') 'Successful update did not write installed result'
   Assert (Test-Path -LiteralPath (Join-Path $case.root 'versions\0.4.6\OpenClaw Desktop.exe')) 'Previous version was removed'
  } else {
   Assert ($exit -ne 0) 'Invalid update unexpectedly succeeded'
   Assert ($pointer.version -eq '0.4.6') "Old pointer was not retained/restored for $scenario"
   if ($scenario -in @('cancel','no-commit')) { Assert ((Starts $case.root).Count -eq 0) 'Uncommitted helper started a client' } else { Assert ((Read-Json $payload.data.result).phase -eq 'failed') 'Failed update result missing' }
   Assert (-not (Test-Path -LiteralPath (Join-Path $case.case 'escaped.txt'))) 'ZIP escaped staging directory'
  }
  if ($scenario -in @('startup-failure','health-timeout','pointer-write-failure')) {
   Assert (-not (Test-Path -LiteralPath (Join-Path $case.root 'versions\0.4.7'))) 'Failed version blocked a same-version retry'
   Assert (@(Get-ChildItem -LiteralPath (Join-Path $case.root '.update') -Directory | Where-Object {$_.Name -like 'failed-0.4.7-*'}).Count -eq 1) 'Failed version was not quarantined'
  }
  if ($scenario -eq 'startup-failure') {
   # Repair the fixture, then retry the exact same release version in the same root.
   [IO.Directory]::Delete((Join-Path $case.distribution 'versions\0.4.7'),$true)
   New-Version $case.distribution '0.4.7' 'ok'
   $retry=Payload $case; $retryProcess=Handoff $case $retry
   Assert ((Wait-Helper $retryProcess) -eq 0) 'Same-version retry failed after automatic rollback'
   Assert ((Read-Json (Join-Path $case.root 'current.json')).version -eq '0.4.7') 'Retry did not activate repaired version'
   $retryProcess.Dispose()
  }
  if ($parent) { Assert ($parent.WaitForExit(3000)) 'Actual caller did not exit'; $parent.Dispose() }
  Stop-Probes $case.root
  $p.Dispose()
  Write-Output "PASS: directory update $scenario"
 }
 # A colliding staging directory belongs to someone else and must never be deleted.
 $case=New-Case 'existing-stage'
 $payload=Payload $case
 $existingStage=Join-Path $case.root ('.update\stage-' + $payload.data.token)
 [IO.Directory]::CreateDirectory($existingStage) | Out-Null
 $sentinel=Join-Path $existingStage 'sentinel.txt'; [IO.File]::WriteAllText($sentinel,'keep')
 $p=Start-Hidden $case.helper @('--apply',$payload.file)
 Assert ((Wait-Helper $p) -ne 0) 'Colliding stage unexpectedly accepted'
 Assert (([IO.File]::ReadAllText($sentinel)) -eq 'keep') 'Helper deleted a staging directory it did not create'
 Assert ((Read-Json (Join-Path $case.root 'current.json')).version -eq '0.4.6') 'Colliding stage changed current pointer'
 $p.Dispose()
 Write-Output 'PASS: pre-existing stage is never cleaned by this helper'

 # Invalid health configuration is rejected before receipt or any version changes.
 $case=New-Case 'invalid-health-timeout'
 $payload=Payload $case; $payload.data.healthTimeoutMs=999; Write-Json $payload.file $payload.data
 $p=Start-Hidden $case.helper @('--apply',$payload.file)
 Assert ((Wait-Helper $p) -ne 0) 'Invalid health timeout unexpectedly accepted'
 Assert (-not (Test-Path -LiteralPath $payload.data.ready)) 'Bad health timeout was rejected too late'
 Assert ((Read-Json (Join-Path $case.root 'current.json')).version -eq '0.4.6') 'Invalid health timeout changed pointer'
 $p.Dispose()
 Write-Output 'PASS: invalid health timeout fails before readiness'

 # Exercise the production JavaScript receipt/commit bridge with a real exiting parent.
 $caller = Join-Path $testRoot 'caller.cjs'
 @'
const fs=require('node:fs');
const {launchDirectoryReplacement}=require(process.argv[2]);
const config=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
(async()=>{await launchDirectoryReplacement({...config,pid:process.pid});})().catch(error=>{console.error(error.message);process.exitCode=1;});
'@ | Set-Content -LiteralPath $caller -Encoding UTF8
 $runtimes = @(@{name='node'; exe=(Get-Command node).Source})
 if ($ElectronRuntime) { $runtimes += @{name='electron-node-mode'; exe=[IO.Path]::GetFullPath($ElectronRuntime)} }
 foreach ($runtime in $runtimes) {
  $case = New-Case ('js-handoff-' + $runtime.name)
  $payload = Payload $case
  $stage = Join-Path $case.case 'js-stage'; [IO.Directory]::CreateDirectory($stage) | Out-Null
  $config = @{install=@{root=$case.root; version='0.4.6'; launcher=(Join-Path $case.root 'OpenClaw.exe')}; file=$payload.data.source; hash=$payload.data.hash; directory=$stage; result=$payload.data.result; version='0.4.7'}
  $configFile = Join-Path $case.case 'caller-config.json'; Write-Json $configFile $config
  if ($runtime.name -eq 'electron-node-mode') { $env:ELECTRON_RUN_AS_NODE='1' }
  $modulePath = if ($runtime.name -eq 'electron-node-mode') { Join-Path (Split-Path $runtime.exe -Parent) 'resources\app.asar\src\directory-update.cjs' } else { Join-Path $project 'src\directory-update.cjs' }
  try { $callerProcess = Start-Hidden $runtime.exe @($caller,$modulePath,$configFile) } finally { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
  Assert ($callerProcess.WaitForExit(20000)) 'Production JS caller did not exit after handoff'
  Assert ($callerProcess.ExitCode -eq 0) 'Production JS readiness/commit failed'
  Wait-File $config.result 20000
  Assert ((Read-Json $config.result).phase -eq 'installed') 'Native helper failed after actual JS caller exit'
  Assert ((Read-Json (Join-Path $case.root 'current.json')).version -eq '0.4.7') 'Production JS handoff did not advance pointer'
  $callerProcess.Dispose(); Stop-Probes $case.root
  Write-Output "PASS: production JS -> native helper -> actual $($runtime.name) caller exit"
 }
 Write-Output 'All native directory launcher/update tests passed (no Electron GUI).'
} finally {
 if ($heldFile) { $heldFile.Dispose() }
 Remove-Item Env:OPENCLAW_INSTALL_ROOT -ErrorAction SilentlyContinue
 foreach ($dir in (Get-ChildItem -LiteralPath $testRoot -Directory -ErrorAction SilentlyContinue)) { Stop-Probes (Join-Path $dir.FullName 'app') }
 try { [IO.Directory]::Delete($testRoot,$true) } catch { Write-Warning "Disposable test cleanup incomplete: $testRoot" }
}
