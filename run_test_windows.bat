@echo off
chcp 65001 >nul
title Benchmark Tốc Độ Stream Video 4K (Windows)
color 0b

echo =====================================================================
echo    ĐANG KHỞI CHẠY BENCHMARK TỐC ĐỘ STREAM 4K TRÊN WINDOWS...
echo =====================================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0benchmark_windows.ps1"

echo.
echo =====================================================================
echo    Nhấn phím bất kỳ để đóng cửa sổ này...
echo =====================================================================
pause >nul
