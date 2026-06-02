@echo off
REM Daily GoWild scrape launcher for Windows Task Scheduler.
REM Runs the scraper once, appending output to data\scrape.log.
cd /d "%~dp0.."
node src\scrape.js --days 7 >> data\scrape.log 2>&1
