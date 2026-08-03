@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Manifestador - Actualizacion y arranque

rem Si ya esta abierto, no tocamos sus archivos ni interrumpimos una posible
rem generacion en curso. Simplemente llevamos al usuario a la instancia activa.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo Manifestador ya esta ejecutandose. Abriendo la instancia activa...
  start "" "http://localhost:7777"
  exit /b 0
)

echo.
echo [1/3] Buscando actualizaciones...
where git >nul 2>&1
if errorlevel 1 (
  echo AVISO: Git no esta instalado o no esta en PATH. Se usara la copia local.
) else (
  git rev-parse --is-inside-work-tree >nul 2>&1
  if errorlevel 1 (
    echo AVISO: Esta carpeta no es un repositorio Git. Se usara la copia local.
  ) else (
    git pull --ff-only
    if errorlevel 1 echo AVISO: No se pudo actualizar. Se intentara iniciar la version local sin descartar cambios.
  )
)

echo.
echo [2/3] Comprobando Node.js y dependencias...
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado o no esta en PATH.
  echo Instala Node.js 20 o superior y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm no esta instalado o no esta en PATH.
  pause
  exit /b 1
)

set "MANIFEST_SOURCE=package.json"
if exist "package-lock.json" set "MANIFEST_SOURCE=package-lock.json"
set "MANIFEST_STAMP=node_modules\.manifestador-dependencies.sha256"
set "NEED_INSTALL=0"

if not exist "node_modules" set "NEED_INSTALL=1"
if "%NEED_INSTALL%"=="0" (
  powershell -NoProfile -Command "$source='%MANIFEST_SOURCE%'; $stamp='%MANIFEST_STAMP%'; if (!(Test-Path -LiteralPath $source) -or !(Test-Path -LiteralPath $stamp)) { exit 1 }; $expected=(Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash; $installed=(Get-Content -Raw -LiteralPath $stamp).Trim(); if ($expected -ceq $installed) { exit 0 } else { exit 1 }"
  if errorlevel 1 set "NEED_INSTALL=1"
)
if "%NEED_INSTALL%"=="0" (
  call npm ls --depth=0 >nul 2>&1
  if errorlevel 1 set "NEED_INSTALL=1"
)

if "%NEED_INSTALL%"=="1" (
  echo Instalando o reparando dependencias. Esto puede tardar unos minutos...
  if exist "package-lock.json" (
    call npm ci --no-audit --no-fund
  ) else (
    call npm install --no-audit --no-fund
  )
  if errorlevel 1 (
    echo.
    echo ERROR: npm no pudo instalar las dependencias. Revisa la conexion y los mensajes anteriores.
    pause
    exit /b 1
  )
  powershell -NoProfile -Command "$hash=(Get-FileHash -Algorithm SHA256 -LiteralPath '%MANIFEST_SOURCE%').Hash; Set-Content -NoNewline -Encoding ASCII -LiteralPath '%MANIFEST_STAMP%' -Value $hash"
) else (
  echo Dependencias completas y actualizadas.
)

echo.
echo [3/3] Iniciando Manifestador...
start "Manifestador" /min cmd /k "cd /d ""%~dp0"" && node server.js"

rem Espera hasta 20 segundos para no abrir una pagina vacia mientras Node inicia.
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(20); do { try { $response=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:7777/' -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 400 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo AVISO: El servidor no respondio a tiempo. Revisa la ventana de Manifestador.
  pause
  exit /b 1
)

start "" "http://localhost:7777"
endlocal
