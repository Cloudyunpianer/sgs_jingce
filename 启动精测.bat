@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

if not exist "%~dp0index.html" (
  echo  [x] 同目录下找不到 index.html
  echo      请把这个 .bat 和项目的 index.html 放在同一个文件夹里。
  echo.
  pause
  exit /b 1
)

rem ------------------------------------------------------------------
rem  路径里含中文时，必须先把 file:// 地址转成百分号编码，
rem  否则 Edge / Chrome 会直接丢弃 --app 参数，只弹一个空白页。
rem  （实测：未编码 -> 只开「新建标签页」；编码后 -> 正常加载）
rem  同时这里顺带把反斜杠换成斜杠，不必再用 %DIR:\=/% 拼字符串。
rem ------------------------------------------------------------------
set "URL="
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "([uri]'%~dp0index.html').AbsoluteUri"`) do set "URL=%%U"
if not defined URL goto fallback

set "EDGE86=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE64=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHR64=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHR86=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE86%" (
  start "" "%EDGE86%" --app="%URL%" --window-size=1560,940
  exit /b
)
if exist "%EDGE64%" (
  start "" "%EDGE64%" --app="%URL%" --window-size=1560,940
  exit /b
)
if exist "%CHR64%" (
  start "" "%CHR64%" --app="%URL%" --window-size=1560,940
  exit /b
)
if exist "%CHR86%" (
  start "" "%CHR86%" --app="%URL%" --window-size=1560,940
  exit /b
)

:fallback
rem 没有 Chromium 系浏览器，或取不到编码地址时，交给系统默认浏览器
rem （ShellExecute 是 Unicode 通道，中文路径不会出问题）
start "" "%~dp0index.html"
exit /b
