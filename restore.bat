@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo  ============ 现有备份 ============
node devtool.js list
echo.
set /p NAME=请输入要恢复的备份名(直接回车取消):
if "%NAME%"=="" goto :end
node devtool.js restore %NAME%
:end
echo.
pause
