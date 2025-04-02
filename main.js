// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const WebSocket = require("ws");
const fs = require("fs");

let mainWindow;
let settingsWindow;
let ws = null;

let wsURL = "";
let savedConfigs = [];
const configPath = path.join(__dirname, "config.json");

function loadConfig() {
  try {
    const data = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(data);
    wsURL = config.websocketURL || "";
    savedConfigs = config.saved || [];
    console.log("🔧 已載入設定:", wsURL);
  } catch (err) {
    console.log("⚠️ 無法讀取設定，請從畫面設定 WebSocket URL");
  }
}

function saveConfig(url) {
  try {
    wsURL = url;
    if (!savedConfigs.includes(url)) {
      savedConfigs.push(url);
    }
    fs.writeFileSync(
      configPath,
      JSON.stringify({ websocketURL: url, saved: savedConfigs }, null, 2)
    );
    console.log("✅ 已儲存設定:", url);
  } catch (err) {
    console.error("❌ 儲存設定失敗:", err.message);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.loadFile("renderer.html");
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 500,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  settingsWindow.loadFile("settings.html");
  settingsWindow.webContents.on("did-finish-load", () => {
    settingsWindow.webContents.send("ws-saved-list", {
      current: wsURL,
      saved: savedConfigs,
    });
  });
}

function setupWebSocket(url) {
  if (!url) return;

  if (ws) {
    ws.removeAllListeners();
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CLOSING
    ) {
      ws.terminate(); // ✅ 安全終止連線
    }
    ws = null;
  }

  ws = new WebSocket(url);

  ws.on("open", () => {
    console.log("✅ 已連接 WebSocket:", url);
    settingsWindow.webContents.send("ws-status", {
      status: "connected",
      url,
    });
  });

  ws.on("message", async (data) => {
    console.log("📩 收到 HTML 資料，準備列印");

    const html = data.toString();
    const tempPath = path.join(app.getPath("temp"), `print_${Date.now()}.html`);
    fs.writeFileSync(tempPath, html, "utf8");

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: false,
      },
    });

    await printWindow.loadFile(tempPath);
    printWindow.webContents.on("did-finish-load", () => {
      printWindow.webContents.print({ silent: true }, (success, errorType) => {
        if (!success) {
          console.error("列印錯誤:", errorType);
        }
        printWindow.close();
      });
    });
  });

  ws.on("close", () => {
    console.log("⚠️ WebSocket 已關閉，5 秒後重試...");
    settingsWindow.webContents.send("ws-status", {
      status: "disconnected",
      url,
    });
    setTimeout(() => setupWebSocket(wsURL), 5000);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket 錯誤:", err.message);
    settingsWindow.webContents.send("ws-status", {
      status: "error",
      url,
      error: err.message,
    });
  });
}

// ========== IPC 操作 ==========
ipcMain.on("printed", () => {
  console.log("🖨️ 已完成列印");
});

ipcMain.on("ws-url", (event, url) => {
  saveConfig(url);
  setupWebSocket(url);
});

ipcMain.on("delete-ws-url", (event, urlToDelete) => {
  savedConfigs = savedConfigs.filter((u) => u !== urlToDelete);
  fs.writeFileSync(
    configPath,
    JSON.stringify({ websocketURL: wsURL, saved: savedConfigs }, null, 2)
  );
  settingsWindow.webContents.send("ws-saved-list", {
    current: wsURL,
    saved: savedConfigs,
  });
});

ipcMain.on("get-current-status", () => {
  settingsWindow.webContents.send("ws-status", {
    status: ws?.readyState === 1 ? "connected" : "disconnected",
    url: wsURL,
  });
});

// ========== 啟動應用 ==========
app.whenReady().then(() => {
  loadConfig();
  createMainWindow();
  createSettingsWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
