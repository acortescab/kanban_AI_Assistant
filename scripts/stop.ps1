$ErrorActionPreference = 'Stop'

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

try {
    docker info | Out-Null
}
catch {
    Write-Error "Docker is not running or is not available."
    exit 1
}

docker compose down --remove-orphans
Write-Host 'Docker stack stopped.'
