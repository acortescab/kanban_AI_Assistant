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

docker compose up --build -d

for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
        $null = Invoke-WebRequest -Uri 'http://localhost:8000/api/health' -UseBasicParsing -TimeoutSec 2
        Write-Host 'Docker stack started.'
        Write-Host 'App: http://localhost:8000'
        exit 0
    }
    catch {
        Start-Sleep -Seconds 1
    }
}

Write-Error 'Docker container started, but the health endpoint did not become ready in time.'
docker compose logs --tail 50
exit 1
