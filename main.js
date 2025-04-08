const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const WebSocket = require("ws");
const fs = require("fs");

app.setPath("userData", path.join(__dirname, "user_data"));

let mainWindow;
let settingsWindow;
let ws = null;

let wsURL = "";
let savedConfigs = [];
const configPath = path.join(__dirname, "config.json");
const logPath = path.join(__dirname, "print-log.txt");

function loadConfig() {
  try {
    const data = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(data);
    wsURL = config.websocketURL || "";
    savedConfigs = config.saved || [];
    console.log("[Config] Loaded:", wsURL);
  } catch (err) {
    console.log("[Config] Failed to read config.");
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
    console.log("[Config] Saved:", url);
  } catch (err) {
    console.error("[Config] Save failed:", err.message);
  }
}

function logPrintEvent(status, detail = "") {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${status}${detail ? " - " + detail : ""}\n`;
  fs.appendFileSync(logPath, logEntry);
  console.log("[Log]", logEntry.trim());
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
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
      ws.terminate();
    }
    ws = null;
  }

  ws = new WebSocket(url);

  ws.on("open", () => {
    console.log("[WebSocket] Connected:", url);
    settingsWindow.webContents.send("ws-status", {
      status: "connected",
      url,
    });
  });

  ws.on("message", async (data) => {
    console.log("[Print] HTML received, opening window...");

    const html = data.toString();

    // ✅ 在 </body> 前插入 window.print() 觸發列印
    const htmlWithPrint = html.replace(
      /<\/body>/i,
      `<script>
        window.onload = () => {
          setTimeout(() => window.print(), 500);
        };
      </script></body>`
    );

    const tempPath = path.join(app.getPath("temp"), `print_${Date.now()}.html`);
    fs.writeFileSync(tempPath, htmlWithPrint, "utf8");

    const printWindow = new BrowserWindow({
      width: 800,
      height: 1000,
      show: true,
      frame: true,
      webPreferences: {
        sandbox: false,
        contextIsolation: false,
        nodeIntegration: false,
      },
    });

    await printWindow.loadFile(tempPath);

    // log 記錄
    logPrintEvent("📄 已開啟列印預覽", tempPath);

    // 使用者自行選擇列印或取消，我們不強制關閉
  });

  ws.on("close", () => {
    console.log("[WebSocket] Disconnected. Reconnecting in 5s...");
    settingsWindow.webContents.send("ws-status", {
      status: "disconnected",
      url,
    });
    setTimeout(() => setupWebSocket(wsURL), 5000);
  });

  ws.on("error", (err) => {
    console.error("[WebSocket] Error:", err.message);
    settingsWindow.webContents.send("ws-status", {
      status: "error",
      url,
      error: err.message,
    });
  });
}

// ========== IPC ==========
ipcMain.on("printed", () => {
  logPrintEvent("🖨️ 列印完成");
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

// 啟動
app.whenReady().then(() => {
  loadConfig();
  createMainWindow();
  createSettingsWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
