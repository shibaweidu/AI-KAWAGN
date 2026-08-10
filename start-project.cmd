@echo off
setlocal
chcp 65001 >nul
title AI Card - Local Development

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Startup failed. Review the message above, then press any key to close.
  pause >nul
)

exit /b %EXIT_CODE%
