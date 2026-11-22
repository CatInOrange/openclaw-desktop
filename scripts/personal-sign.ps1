# Personal-use Authenticode helper. Run on your own Windows; never uploads keys.
# Creates a signed COPY. -TrustCurrentUser explicitly installs your public cert
# in this account's Root and TrustedPublisher stores. SmartScreen is separate.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [switch]$TrustCurrentUser,
    [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'OpenClaw Desktop Signing')
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $ExePath).Path
if ([IO.Path]::GetExtension($source) -ne '.exe') { throw 'Select a Windows EXE.' }
$actual = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
if ($actual -ne $ExpectedSha256) { throw 'SHA256 mismatch. No certificate or trust changes were made.' }
$destination = Join-Path ([IO.Path]::GetDirectoryName($source)) ([IO.Path]::GetFileNameWithoutExtension($source) + '.personal.exe')
if (Test-Path -LiteralPath $destination) { throw "Output already exists: $destination" }
$settingsDir = $StateDirectory
$thumbFile = Join-Path $settingsDir 'signer-thumbprint.txt'
New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
Write-Output 'Preparing personal signing certificate (private key stays on Windows).'
if (Test-Path -LiteralPath $thumbFile) {
    $thumb = (Get-Content -LiteralPath $thumbFile -Raw).Trim()
    if ($thumb -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Invalid saved certificate thumbprint.' }
    $cert = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumb"
    if (-not $cert.HasPrivateKey -or $cert.NotAfter -le (Get-Date)) { throw 'Saved signing certificate is unavailable or expired.' }
} else {
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=OpenClaw Desktop Personal' -FriendlyName 'OpenClaw Desktop Personal' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyExportPolicy NonExportable -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(3)
    $cert.Thumbprint | Set-Content -LiteralPath $thumbFile -Encoding ascii
}
$publicPath = Join-Path $settingsDir 'OpenClaw-Desktop-Personal.cer'
Export-Certificate -Cert $cert -FilePath $publicPath -Force | Out-Null
if ($TrustCurrentUser) {
    foreach ($storeName in @('Root', 'TrustedPublisher')) {
        $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($storeName, [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)
        try {
            $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
            # Public certificate only; signing key stays non-exportable in My.
            $publicCert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($publicPath)
            Write-Output "Installing public certificate in CurrentUser\$storeName (Windows may ask for consent)."
            $store.Add($publicCert)
        } finally { $store.Close() }
    }
}
Write-Output 'Signing a copy of the verified EXE.'
Copy-Item -LiteralPath $source -Destination $destination
$result = Set-AuthenticodeSignature -LiteralPath $destination -Certificate $cert -HashAlgorithm SHA256 -IncludeChain Signer
if ($null -eq $result.SignerCertificate -or $result.SignerCertificate.Thumbprint -ne $cert.Thumbprint) { throw 'Signature was not applied.' }
Write-Output "Signed copy: $destination"
Write-Output "Certificate: $($cert.Thumbprint)"
Write-Output "Signature status: $($result.Status)"
Write-Output "Public certificate: $publicPath"
Write-Output 'The original EXE and its release checksum are unchanged. SmartScreen warnings may still appear.'
if ($TrustCurrentUser -and $result.Status -ne 'Valid') { throw 'Windows did not validate local trust; inspect Get-AuthenticodeSignature on the signed copy.' }
