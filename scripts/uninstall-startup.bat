@echo off
setlocal
set "SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SmartTVLauncher.lnk"
if exist "%SHORTCUT_PATH%" (
    del /f /q "%SHORTCUT_PATH%"
    echo [Smart TV Launcher] Baslangic kisayolu basariyla kaldirildi.
) else (
    echo [Smart TV Launcher] Baslangic klasorunde kisayol bulunamadi.
)
echo.
pause