[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertFrom-SecureStringPlainText {
    param(
        [Parameter(Mandatory = $true)]
        [Security.SecureString]$SecureValue
    )

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

$email = (Read-Host "SYSTEM admin email").Trim().ToLowerInvariant()
$name = (Read-Host "Administrator name").Trim()
$firstSecurePassword = Read-Host "New password (minimum 8 characters)" -AsSecureString
$secondSecurePassword = Read-Host "Confirm password" -AsSecureString
$firstPassword = ConvertFrom-SecureStringPlainText -SecureValue $firstSecurePassword
$secondPassword = ConvertFrom-SecureStringPlainText -SecureValue $secondSecurePassword

try {
    if ($firstPassword -cne $secondPassword) {
        throw "The passwords do not match."
    }

    $env:BOOTSTRAP_SYSTEM_EMAIL = $email
    $env:BOOTSTRAP_SYSTEM_NAME = $name
    $env:BOOTSTRAP_SYSTEM_PASSWORD = $firstPassword

    corepack pnpm --filter @video/database exec tsx prisma/bootstrap-admin.ts
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create or update the SYSTEM administrator."
    }
}
finally {
    Remove-Item Env:BOOTSTRAP_SYSTEM_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:BOOTSTRAP_SYSTEM_NAME -ErrorAction SilentlyContinue
    Remove-Item Env:BOOTSTRAP_SYSTEM_PASSWORD -ErrorAction SilentlyContinue
    $firstPassword = $null
    $secondPassword = $null
    $firstSecurePassword = $null
    $secondSecurePassword = $null
}
