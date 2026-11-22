param([string]$Directory = '', [string]$Destination = '')
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Directory) { $Directory = Join-Path $project 'dist\directory' }
if (-not $Destination) { $Destination = Join-Path $project "dist\OpenClaw-Desktop-$version-win-x64-directory.zip" }
$Directory = [IO.Path]::GetFullPath($Directory).TrimEnd('\','/')
$Destination = [IO.Path]::GetFullPath($Destination)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$items = @(Get-ChildItem -LiteralPath $Directory -Recurse -Force)
foreach ($item in $items) { if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Archive producer refuses links' } }
# Use a strict POSIX ZIP namespace on every host. Windows PowerShell's
# Compress-Archive emitted paths that the native safety parser correctly rejected.
$archive = [IO.Compression.ZipFile]::Open($Destination,[IO.Compression.ZipArchiveMode]::Create)
try {
 foreach ($item in ($items | Where-Object { -not $_.PSIsContainer } | Sort-Object FullName)) {
  $relative = $item.FullName.Substring($Directory.Length + 1).Replace('\','/')
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$item.FullName,$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
 }
} finally { $archive.Dispose() }
Write-Output "Directory ZIP created with normalized forward-slash entry paths: $Destination"
