$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$root = Join-Path ([IO.Path]::GetTempPath()) ('oc-directory-preflight-' + [guid]::NewGuid().ToString('N'))
$inputDirectory = Join-Path $root 'input'
$archive = Join-Path $root 'fixture.zip'
[IO.Directory]::CreateDirectory((Join-Path $inputDirectory 'resources')) | Out-Null
[IO.File]::WriteAllText((Join-Path $inputDirectory 'OpenClaw Desktop.exe'),'non-executed archive fixture')
[IO.File]::WriteAllText((Join-Path $inputDirectory 'resources\app.asar'),'non-executed archive fixture')
try {
 node (Join-Path $PSScriptRoot 'build-directory-package.cjs') $inputDirectory
 if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
 & (Join-Path $PSScriptRoot 'create-directory-archive.ps1') -Directory (Join-Path $project 'dist\directory') -Destination $archive
 & (Join-Path $PSScriptRoot 'verify-directory-archive.ps1') -Archive $archive
 Write-Output 'Producer -> normalized ZIP -> shipped native parser preflight passed (no GUI).'
} finally {
 [IO.Directory]::Delete($root,$true)
 if (Test-Path -LiteralPath (Join-Path $project 'dist\directory')) { [IO.Directory]::Delete((Join-Path $project 'dist\directory'),$true) }
}
