@echo off
echo ================================================
echo  [DEPLOY START]  %date% %time%
echo ================================================

rem -- Build release tag once, up front: release-YYYYMMDD-HHMM (locale-independent) --
for /f "tokens=2 delims==." %%a in ('wmic os get LocalDateTime /value') do set LDT=%%a
set STAMP=%LDT:~0,8%-%LDT:~8,4%
set HUMAN=%LDT:~0,4%-%LDT:~4,2%-%LDT:~6,2% %LDT:~8,2%:%LDT:~10,2%
set TAG=release-%STAMP%
rem Footer (REACT_APP_BUILD_TIME) will match the git tag exactly
set REACT_APP_BUILD_TIME=%TAG%

rem -- Build memory fix: Node 힙 확대 + 소스맵 끄기 (OOM 방지) --
set NODE_OPTIONS=--max-old-space-size=4096
set GENERATE_SOURCEMAP=false

echo.
echo  -- Building %TAG% ... --
call npm run build
if errorlevel 1 (
  echo.
  echo  ********************************************
  echo   BUILD FAILED^!  Deploy aborted.
  echo   Site was NOT updated. Check errors above.
  echo  ********************************************
  pause
  exit /b 1
)

echo.
echo  -- Build OK. Deploying to GitHub Pages... --
call npx gh-pages -d build
if errorlevel 1 (
  echo  gh-pages deploy FAILED. Check above.
  pause
  exit /b 1
)

echo.
echo  -- Committing and tagging: %TAG% --
git add -A
git commit -m "release %HUMAN%"
rem 원격에 다른 커밋이 있어도 자동 동기화 후 푸시 (rejected 방지)
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo  ********************************************
  echo   git pull --rebase FAILED (충돌 가능).
  echo   수동으로 충돌 해결 후 다시 시도하세요.
  echo  ********************************************
  pause
  exit /b 1
)
git push origin main

git tag %TAG%
git push origin %TAG%

echo ================================================
echo  [DEPLOY DONE]   %date% %time%
echo  Release tag: %TAG%
echo  Hard-refresh the site (Ctrl+Shift+R) to see changes.
echo ================================================
pause
