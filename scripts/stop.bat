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

docker compose down --remove-orphans

echo Docker stack stopped.
