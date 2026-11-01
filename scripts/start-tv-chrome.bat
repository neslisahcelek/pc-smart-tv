@echo off
setlocal
cd /d "%~dp0.."
echo [Smart TV Launcher] Sunucu ve Google Chrome baslatiliyor...
start "" wscript.exe "%~dp0start-tv-background.vbs"