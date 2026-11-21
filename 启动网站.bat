@echo off
chcp 65001 >nul
title 镜像溯源 VisTrace - 视频帧比对服务
echo.
echo   ============================================
echo    镜像溯源 VisTrace
echo    图片来源溯源 + 影视片段 + 视频帧精确比对
echo   ============================================
echo.
echo   [1/2] 启动视频帧比对服务 (端口 3777)...
cd /d "%~dp0server"
start "VisTrace-Backend" /MIN cmd /c "node server.js"
timeout /t 2 >nul
echo   [2/2] 打开浏览器...
start "" "http://localhost:3777/index.html"
echo.
echo   服务已在后台运行。关闭服务：结束名为 VisTrace-Backend 的窗口，
echo   或执行 taskkill /FI "WINDOWTITLE eq VisTrace-Backend"。
echo.
pause
