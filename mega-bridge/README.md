# Kau-ik Pro — 兆豐 Windows Bridge

兆豐 Speedy Python API 依賴 Windows DLL，因此 Bridge 必須跑在 Windows
VM；Kau-ik Pro 本體仍跑在 Synology Docker。Bridge 只提供私人區網 HTTP
介面，不包含或重新散布兆豐 SDK。

## Windows VM 安裝

1. 安裝 64-bit Python 3.11 或 3.12。
2. 從兆豐取得 Speedy Python API，將下列原廠內容放在本資料夾：
   `megaSpeedy/`、`Temp/`、`speedyAPI_config.json`。
3. 以 PowerShell 執行 `Set-ExecutionPolicy -Scope Process Bypass`，再執行
   `.\install.ps1`。
4. 編輯 `.env`。`MEGA_BRIDGE_TOKEN` 至少使用 32 個隨機字元；交易主機
   IP/Port 使用兆豐提供的設定。
5. 執行 `.\run.ps1`，用瀏覽器開啟 `http://127.0.0.1:8787/v1/health`。
6. Windows 防火牆只允許 Synology `10.98.42.118` 連到 TCP 8787，勿對
   Internet 開放。

PFX 憑證留在 Windows VM。Kau-ik Pro 的「憑證路徑」要填 Windows 路徑，
例如 `C:\MegaAPI\certificate.pfx`，不是 Docker 容器路徑。

## 安全測試

將 `.env` 的 `MEGA_BRIDGE_MOCK=1` 可在不載入兆豐 DLL、不連線、不送出
真實委託的情況驗證 Bridge。確認網頁流程後，停止 Bridge、改回 `0`，再
重新啟動。

目前 Bridge 支援台股現股整股、盤中零股、盤後零股、定盤的新單、刪單、
改價、減量、委託查詢、庫存與未實現損益。兆豐的即時帳務回傳不包含可用
現金欄位，Kau-ik Pro 的「帳戶餘額」會顯示 0 並附說明；歷史已實現損益
目前回空列表。期貨、選擇權、融資券與複委託不在這個 Bridge 版本內。
