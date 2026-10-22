@echo off
cd /d "%~dp0"
if not exist node_modules\pdfkit (
  echo Instalez componentele necesare... (poate dura putin)
  call npm install
)
echo.
echo Pornesc serverul. Deschide in browser: http://localhost:3000
echo Lasa aceasta fereastra deschisa cat folosesti site-ul.
echo.
node server.js
pause
