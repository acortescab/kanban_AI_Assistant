@echo off
setlocal

set ROOT_DIR=%~dp0..
cd /d "%ROOT_DIR%"

where docker >nul 2>nul
if errorlevel 1 (
    echo Docker is not installed or not on PATH.
    exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
    echo Docker is not running or is not available.
    exit /b 1
)

docker compose up --build -d

for /L %%i in (1,1,30) do (
    powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://localhost:8000/api/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
    if not errorlevel 1 (
        echo Docker stack started.
        echo App: http://localhost:8000
        exit /b 0
    )
    timeout /t 1 >nul
)

echo Docker container started, but the health endpoint did not become ready in time.
docker compose logs --tail 50
exit /b 1
