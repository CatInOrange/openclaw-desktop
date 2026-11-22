$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $PSScriptRoot '..\src\directory-launcher.cs'
$icon = Join-Path $PSScriptRoot '..\assets\icon.ico'
$output = Join-Path $PSScriptRoot '..\src\directory-launcher.exe'
& $compiler /nologo /target:winexe /optimize+ /platform:anycpu "/win32icon:$icon" /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw 'Directory launcher compilation failed' }
if (-not (Test-Path -LiteralPath $output)) { throw 'Directory launcher binary missing' }
