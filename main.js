const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");

const API_BASE = "https://kemono.cr/api/v1";

let creatorsCache = null;

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== "") {
          search.append(key, String(item));
        }
      });
      return;
    }
    search.set(key, String(value));
  });
  return search.toString();
}

async function apiGet(pathname, params) {
  const query = buildQuery(params);
  const url = query ? `${API_BASE}${pathname}?${query}` : `${API_BASE}${pathname}`;
  const response = await fetch(url, {
    headers: {
      Accept: "text/css",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status} ${response.statusText}: ${text}`);
  }
  return response.json();
}

async function getCreators() {
  if (!creatorsCache) {
    creatorsCache = await apiGet("/creators");
  }
  return creatorsCache;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0f1414",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("api:getCreators", async () => {
    return getCreators();
  });

  ipcMain.handle("api:getCreatorProfile", async (_event, { service, id }) => {
    return apiGet(`/${service}/user/${id}/profile`);
  });

  ipcMain.handle(
    "api:getCreatorPosts",
    async (_event, { service, id, offset = 0, query = "", tags = [] }) => {
      return apiGet(`/${service}/user/${id}/posts`, {
        o: offset,
        q: query || undefined,
        tag: tags,
      });
    }
  );

  ipcMain.handle(
    "api:getPost",
    async (_event, { service, id, postId }) => {
      const data = await apiGet(`/${service}/user/${id}/post/${postId}`);
      return data.post || data;
    }
  );

  ipcMain.handle("api:getDataBase", () => {
    return "https://kemono.cr/data";
  });

  ipcMain.handle("api:getMediaBytes", async (_event, { path }) => {
    const base = "https://kemono.cr/data";
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Media ${response.status} ${response.statusText}: ${text}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  });

  ipcMain.handle("app:openExternal", async (_event, url) => {
    return shell.openExternal(url);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
