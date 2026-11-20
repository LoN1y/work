@echo off
chcp 65001 >nul
cd /d "%~dp0"
node devtool.js backup %*
echo.
echo  备份已完成。可用 node devtool.js list 查看所有备份。
pause
