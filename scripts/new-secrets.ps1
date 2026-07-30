[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-RandomHex256 {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

Write-Output "SESSION_SECRET=$(New-RandomHex256)"
Write-Output "CSRF_SECRET=$(New-RandomHex256)"
Write-Output "IP_HASH_SALT=$(New-RandomHex256)"
Write-Output "MEDIA_SIGNING_SECRET=$(New-RandomHex256)"
Write-Output "GOOGLE_TOKEN_ENCRYPTION_KEY=$(New-RandomHex256)"
