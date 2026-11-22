param([string]$Archive = '', [string]$Version = '')
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
if (-not $Version) { $Version = (Get-Content (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version }
if (-not $Archive) { $Archive = Join-Path $project "dist\OpenClaw-Desktop-$Version-win-x64-directory.zip" }
$launcher = [IO.Path]::GetFullPath((Join-Path $project 'src\directory-launcher.exe'))
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Keep Stream and reflection arguments in CLR code. Windows PowerShell wraps
# New-Object results in PSObject when they are passed through object[] arrays.
# Loading this assembly and invoking its two IO-only methods never calls Main,
# StartClient, or any GUI. This is the exact parser shipped to the user.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Reflection;
public static class DirectoryArchiveVerifier {
 public static void Verify(string launcher,string archive,string stage,string version) {
  var type=Assembly.LoadFile(launcher).GetType("DirectoryLauncher",true);
  var flags=BindingFlags.Static|BindingFlags.NonPublic;
  var extract=type.GetMethod("Extract",flags);
  var validate=type.GetMethod("ValidateDistribution",flags);
  if(extract==null||validate==null)throw new IOException("Native archive verifier methods missing");
  using(var source=new FileStream(archive,FileMode.Open,FileAccess.Read,FileShare.Read))
   extract.Invoke(null,new object[]{source,stage,version});
  validate.Invoke(null,new object[]{stage,version});
 }
}
'@
$stage = Join-Path ([IO.Path]::GetTempPath()) ('oc-final-directory-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stage) | Out-Null
try {
 [DirectoryArchiveVerifier]::Verify($launcher,[IO.Path]::GetFullPath($Archive),$stage,[string]$Version)
 $actual = (Get-FileHash -LiteralPath (Join-Path $stage 'OpenClaw.exe') -Algorithm SHA256).Hash
 $expected = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash
 if ($actual -ne $expected) { throw 'Distributed fixed launcher differs from tested native build' }
 Write-Output 'Final directory ZIP, all version-file hashes and fixed launcher verified by the shipped native parser (no GUI).'
} catch {
 $failure=$_.Exception
 while ($failure.InnerException) { $failure=$failure.InnerException }
 throw $failure
} finally {
 [IO.Directory]::Delete($stage,$true)
}
