@echo off
setlocal enabledelayedexpansion

:: OpenTunnel Test Script for Windows
:: ===================================

echo ========================================
echo   OpenTunnel Local Test
echo ========================================
echo.

:: Build first
echo [1/6] Building project...
call npm run build
if errorlevel 1 (
    echo Build failed!
    exit /b 1
)
echo.

:: Start test HTTP server on port 5000
echo [2/6] Starting test HTTP server on port 5000...
start /b node dist/cli/index.js test-server -p 5000 -d
timeout /t 2 /nobreak > nul
echo.

:: Start tunnel server (no HTTPS for local testing)
echo [3/6] Starting tunnel server on port 8080...
start /b node dist/cli/index.js server --domain localhost -d
timeout /t 3 /nobreak > nul
echo.

:: Create tunnel
echo [4/6] Creating HTTP tunnel...
start /b node dist/cli/index.js http 5000 -n test -d
timeout /t 3 /nobreak > nul
echo.

:: Show status
echo [5/6] Checking status...
node dist/cli/index.js ps
echo.

:: Test the tunnel
echo [6/6] Testing connections...
echo.
echo Testing direct connection to test server:
echo -----------------------------------------
curl -s http://localhost:5000 2>nul || (
    echo curl not found, using PowerShell...
    powershell -Command "Invoke-RestMethod http://localhost:5000 | ConvertTo-Json"
)
echo.
echo.
echo Testing tunnel via Host header:
echo -----------------------------------------
curl -s -H "Host: test.op.localhost" http://localhost:8080 2>nul || (
    powershell -Command "Invoke-RestMethod -Uri http://localhost:8080 -Headers @{Host='test.op.localhost'} | ConvertTo-Json"
)
echo.

echo ========================================
echo   Test Complete!
echo ========================================
echo.
echo URLs:
echo   - Test server:   http://localhost:5000
echo   - Tunnel server: http://localhost:8080
echo   - Tunnel URL:    http://test.op.localhost:8080
echo.
echo For browser testing, add to C:\Windows\System32\drivers\etc\hosts:
echo   127.0.0.1 test.op.localhost
echo.
echo Commands:
echo   - View status:  node dist/cli/index.js ps
echo   - View logs:    type opentunnel.log
echo   - Stop all:     node dist/cli/index.js down
echo.
echo Press any key to stop all services and exit...
pause > nul

:: Cleanup
echo.
echo Stopping services...
node dist/cli/index.js down
node dist/cli/index.js test-server-stop

echo Done!
