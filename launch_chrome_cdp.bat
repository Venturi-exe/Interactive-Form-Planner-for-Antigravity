@echo off
echo.
echo [Antigravity Launcher] Starting Chrome with CDP on port 9222...
echo [Profile] C:\Users\cesar\.gemini\antigravity-browser-profile
echo.
echo IMPORTANT: Close all other Chrome windows before running this.
echo.

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\Users\cesar\.gemini\antigravity-browser-profile" --no-first-run --no-default-browser-check

echo Chrome launched. You can now return to the Antigravity Auto Accept Control Panel.
pause
