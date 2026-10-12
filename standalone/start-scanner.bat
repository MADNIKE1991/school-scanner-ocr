@echo off
rem ================================================================
rem Kyocera Scanner Agent Bridge (Windows)
rem No Node.js required! Uses built-in Windows PowerShell.
rem ================================================================
title Kyocera Scanner Local Agent
cls

echo Starting Kyocera Scanner Local Bridge...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scanner-bridge.ps1"

if %errorlevel% neq 0 (
    echo.
    echo PowerShell script finished or encountered an issue.
    pause
)
