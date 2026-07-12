@echo off
cd /d "%~dp0"
title CityCost Global Server
echo Starting CityCost on http://localhost:3001 ...
if not exist "node_modules\" call npm.cmd install
call npm.cmd run dev
pause
