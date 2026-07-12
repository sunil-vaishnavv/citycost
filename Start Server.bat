@echo off
REM Compatibility wrapper — prefer START-CITYCOST.vbs or start-server.cmd
cd /d "%~dp0"
call "%~dp0start-server.cmd"
