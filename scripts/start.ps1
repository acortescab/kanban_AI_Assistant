$ErrorActionPreference = 'Stop'

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

$envFile = Join-Path $rootDir '.env'
if (-not (Test-Path $envFile)) {
    Write-Error "Missing .env in $rootDir. Copy .env.example to .env and add your OpenRouter API key."
    exit 1
}

$keyLine = Select-String -Path $envFile -Pattern '^\s*OPENROUTER_API_KEY\s*=\s*(.*)$' |
    Select-Object -First 1
if (-not $keyLine -or -not $keyLine.Matches[0].Groups[1].Value.Trim()) {
    Write-Error "OPENROUTER_API_KEY is missing or empty in $envFile."
    exit 1
}

# Native commands do not throw on failure in Windows PowerShell, so check exit codes.
docker info | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker is not running or is not available."
    exit 1
}

docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose up failed."
    exit 1
}

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
