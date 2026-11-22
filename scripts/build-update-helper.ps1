$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $PSScriptRoot '..\src\portable-update-helper.cs'
$output = Join-Path $PSScriptRoot '..\src\portable-update-helper.exe'
& $compiler /nologo /target:winexe /optimize+ /platform:anycpu /reference:System.Web.Extensions.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw 'Update helper compilation failed' }
if (-not (Test-Path -LiteralPath $output)) { throw 'Update helper binary missing' }
