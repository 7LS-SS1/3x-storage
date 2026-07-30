[CmdletBinding()]
param(
    [switch]$Force
)

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

$projectRoot = Split-Path -Parent $PSScriptRoot
$templatePath = Join-Path $projectRoot ".env.example"
$environmentPath = Join-Path $projectRoot ".env"

if ((Test-Path -LiteralPath $environmentPath) -and -not $Force) {
    Write-Output ".env already exists. Nothing was overwritten. Use -Force to recreate it."
    exit 0
}

if (-not (Test-Path -LiteralPath $templatePath)) {
    throw ".env.example was not found."
}

$content = Get-Content -Raw -LiteralPath $templatePath
foreach ($name in @("SESSION_SECRET", "CSRF_SECRET", "IP_HASH_SALT", "MEDIA_SIGNING_SECRET", "GOOGLE_TOKEN_ENCRYPTION_KEY")) {
    $secret = New-RandomHex256
    $content = [Regex]::Replace(
        $content,
        "(?m)^$([Regex]::Escape($name))=.*$",
        "$name=$secret"
    )
}

[IO.File]::WriteAllText($environmentPath, $content, (New-Object Text.UTF8Encoding($false)))
Write-Output ".env was created with random 256-bit secrets."
Write-Output "Set BOOTSTRAP_SYSTEM_EMAIL and BOOTSTRAP_SYSTEM_PASSWORD before running db:seed."
