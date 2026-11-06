@echo off
chcp 65001 >nul
echo Kutuphane Yonetim Sistemi baslatiliyor...
start "" "http://localhost:8000"
py "%~dp0app.py"
pause
