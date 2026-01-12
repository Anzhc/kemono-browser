const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const JSZip = require("jszip");

const API_BASE = "https://kemono.cr/api/v1";

let creatorsCache = null;
let outputFolder = "";

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "svg",
]);

function getUniquePath(folder, baseName) {
  const ext = path.extname(baseName);
  const nameOnly = ext ? baseName.slice(0, -ext.length) : baseName;
  let candidate = path.join(folder, baseName);
  let index = 1;
  while (fs.existsSync(candidate)) {
    const nextName = `${nameOnly} (${index})${ext}`;
    candidate = path.join(folder, nextName);
    index += 1;
  }
  return candidate;
}

function guessMime(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function fetchBufferWithProgress(
  event,
  url,
  requestId,
  channel,
  doneLabel
) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Download failed ${response.status}: ${text}`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  const chunks = [];
  let loaded = 0;
  const started = Date.now();
  let lastSent = 0;

  const sendProgress = (done = false, force = false) => {
    if (!requestId) {
      return;
    }
    const now = Date.now();
    if (!force && !done && now - lastSent < 200) {
      return;
    }
    lastSent = now;
    const elapsed = Math.max(0.001, (now - started) / 1000);
    const speed = loaded / elapsed;
    event.sender.send(channel, {
      requestId,
      loaded,
      total,
      speed,
      done,
      doneLabel,
    });
  };

  try {
    const body = response.body;
    sendProgress(false, true);
    if (body && typeof body.getReader === "function") {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          const chunk = Buffer.from(value);
          chunks.push(chunk);
          loaded += chunk.length;
          sendProgress(false);
        }
      }
    } else if (body && body[Symbol.asyncIterator]) {
      for await (const chunk of body) {
        const buffer = Buffer.from(chunk);
        chunks.push(buffer);
        loaded += buffer.length;
        sendProgress(false);
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      chunks.push(buffer);
      loaded = buffer.length;
    }
    sendProgress(true, true);
  } catch (error) {
    if (requestId) {
      event.sender.send(channel, {
        requestId,
        error: error.message,
      });
    }
    throw error;
  }

  return Buffer.concat(chunks);
}

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

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
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

  ipcMain.handle("api:getThumbBase", () => {
    return "https://img.kemono.cr/thumbnail/data";
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

  ipcMain.handle("app:selectOutputFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    outputFolder = result.filePaths[0];
    return outputFolder;
  });

  ipcMain.handle("app:getOutputFolder", async () => {
    return outputFolder || null;
  });

  ipcMain.handle("app:downloadImage", async (_event, { url, folder }) => {
    const targetFolder = folder || outputFolder;
    if (!targetFolder) {
      throw new Error("Output folder is not set.");
    }
    const parsed = new URL(url);
    const baseName = path.basename(parsed.pathname) || "image";
    const candidate = getUniquePath(targetFolder, baseName);

    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Download failed ${response.status}: ${text}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(candidate, buffer);
    return candidate;
  });

  ipcMain.handle("app:fetchFileBytes", async (event, { url, requestId }) => {
    if (!url) {
      throw new Error("File URL is not set.");
    }
    return fetchBufferWithProgress(
      event,
      url,
      requestId,
      "app:fileProgress",
      "Rendering pages..."
    );
  });

  ipcMain.handle("app:saveBytes", async (_event, { bytes, filename, folder }) => {
    const targetFolder = folder || outputFolder;
    if (!targetFolder) {
      throw new Error("Output folder is not set.");
    }
    const safeName = filename && filename.trim() ? filename : "image";
    const candidate = getUniquePath(targetFolder, safeName);
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    fs.writeFileSync(candidate, buffer);
    return candidate;
  });

  ipcMain.handle("app:extractZipImages", async (event, payload) => {
    const { url, requestId } = payload || {};
    if (!url) {
      throw new Error("Zip URL is required.");
    }
    const buffer = await fetchBufferWithProgress(
      event,
      url,
      requestId,
      "app:zipProgress",
      "Extracting..."
    );
    const zip = await JSZip.loadAsync(buffer);
    const results = [];
    const entries = Object.values(zip.files);
    for (const entry of entries) {
      if (entry.dir) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase().slice(1);
      if (!IMAGE_EXTENSIONS.has(ext)) {
        continue;
      }
      const bytes = await entry.async("nodebuffer");
      results.push({
        name: path.basename(entry.name),
        bytes,
        mime: guessMime(entry.name),
      });
    }
    return results;
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
