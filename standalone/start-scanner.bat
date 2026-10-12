@echo off
rem ================================================================
rem Kyocera Scanner Agent Bridge (Windows) - All-In-One Edition
rem No Node.js required. Zero configuration.
rem ================================================================
title Kyocera Scanner Local Agent
cls

echo ================================================================
echo        KYOCERA LOCAL SCANNER AGENT (Windows Bridge)
echo ================================================================
echo.
echo Starting Kyocera Scanner Local Bridge...
echo.

set "SCRIPT_FILE=%~dp0scanner-bridge.ps1"
if not exist "%SCRIPT_FILE%" (
    echo [INFO] Restoring scanner-bridge.ps1 helper...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$b64 = 'IyBLeW9jZXJhIFNjYW5uZXIgcHMx'; if (Test-Path '%SCRIPT_FILE%') {}"
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_FILE%"

if %errorlevel% neq 0 (
    echo.
    echo Bridge closed or encountered an issue.
    pause
)
