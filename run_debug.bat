@echo off
cd /d "%~dp0"
call npm.cmd run dev > debug.log 2>&1
