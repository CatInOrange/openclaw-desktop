param([string]$Archive = '', [string]$Version = '')
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
if (-not $Version) { $Version = (Get-Content (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version }
if (-not $Archive) { $Archive = Join-Path $project "dist\OpenClaw-Desktop-$Version-win-x64-directory.zip" }
$launcher = [IO.Path]::GetFullPath((Join-Path $project 'src\directory-launcher.exe'))
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Loading the assembly and invoking these two IO-only methods never calls Main,
# StartClient, or any GUI. Use the exact native parser shipped to the user.
$assembly = [Reflection.Assembly]::LoadFile($launcher)
$type = $assembly.GetType('DirectoryLauncher', $true)
$flags = [Reflection.BindingFlags]::Static -bor [Reflection.BindingFlags]::NonPublic
$extract = $type.GetMethod('Extract', $flags)
$validate = $type.GetMethod('ValidateDistribution', $flags)
if (-not $extract -or -not $validate) { throw 'Native archive verifier methods missing' }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('oc-final-directory-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stage) | Out-Null
try {
 $source = New-Object IO.FileStream([IO.Path]::GetFullPath($Archive), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
 try { $extract.Invoke($null, [object[]]@($source,$stage,[string]$Version)) | Out-Null } finally { $source.Dispose() }
 $validate.Invoke($null, [object[]]@($stage,[string]$Version)) | Out-Null
 $actual = (Get-FileHash -LiteralPath (Join-Path $stage 'OpenClaw.exe') -Algorithm SHA256).Hash
 $expected = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash
 if ($actual -ne $expected) { throw 'Distributed fixed launcher differs from tested native build' }
 Write-Output 'Final directory ZIP, all version-file hashes and fixed launcher verified by the shipped native parser (no GUI).'
} catch {
 if ($_.Exception.InnerException) { throw $_.Exception.InnerException }
 throw
} finally {
 [IO.Directory]::Delete($stage,$true)
}
