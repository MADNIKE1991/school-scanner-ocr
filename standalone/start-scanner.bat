@echo off
chcp 65001 > nul
title Kyocera Scanner Agent Bridge

echo ================================================================
echo    ЗАПУСК МОСТА СКАНИРОВАНИЯ KYOCERA ДЛЯ ВЕБ-САЙТА
echo ================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не найден на этом компьютере!
    echo Скачайте и установите Node.js с официального сайта: https://nodejs.org/
    echo После установки перезапустите этот файл.
    pause
    exit /b
)

echo [OK] Node.js обнаружен.
echo Запуск локального агента на порту 3000...
echo.

node bridge-agent.js

pause
