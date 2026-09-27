$ErrorActionPreference = 'Stop'

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

# Native commands do not throw on failure in Windows PowerShell, so check exit codes.
docker info | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker is not running or is not available."
    exit 1
}

docker compose down --remove-orphans
if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose down failed."
    exit 1
}

Write-Host 'Docker stack stopped.'
