$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    throw "找不到 .venv，請先執行 install.ps1"
}

if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $pair = $line.Split("=", 2)
            if ($pair.Length -eq 2) {
                [Environment]::SetEnvironmentVariable($pair[0].Trim(), $pair[1].Trim(), "Process")
            }
        }
    }
}

$hostName = if ($env:MEGA_BRIDGE_HOST) { $env:MEGA_BRIDGE_HOST } else { "0.0.0.0" }
$port = if ($env:MEGA_BRIDGE_PORT) { [int]$env:MEGA_BRIDGE_PORT } else { 8787 }
& ".venv\Scripts\python.exe" -m uvicorn app:app --host $hostName --port $port
