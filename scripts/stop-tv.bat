@echo off
setlocal
echo [Smart TV Launcher] Port 3000 uzerindeki sunucu durduruluyor...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo PID %%a sonlandiriliyor...
    taskkill /F /PID %%a >nul 2>&1
)

echo Sunucu durduruldu.
pause