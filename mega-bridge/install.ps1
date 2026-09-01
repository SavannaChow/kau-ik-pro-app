$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) {
    throw "找不到 Python Launcher。請先安裝 64-bit Python 3.11 或 3.12。"
}

& py -3 -m venv .venv
& ".venv\Scripts\python.exe" -m pip install --upgrade pip
& ".venv\Scripts\python.exe" -m pip install -r requirements.txt

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
}

Write-Host "安裝完成。"
Write-Host "1. 將兆豐提供的 megaSpeedy、Temp、speedyAPI_config.json 放在此資料夾。"
Write-Host "2. 編輯 .env，設定 Bridge Token 與兆豐交易主機。"
Write-Host "3. 執行 .\run.ps1。"
