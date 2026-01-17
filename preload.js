const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kemono", {
  getCreators: () => ipcRenderer.invoke("api:getCreators"),
  getCreatorProfile: (service, id) =>
    ipcRenderer.invoke("api:getCreatorProfile", { service, id }),
  getCreatorPosts: (service, id, options = {}) =>
    ipcRenderer.invoke("api:getCreatorPosts", { service, id, ...options }),
  getPost: (service, id, postId) =>
    ipcRenderer.invoke("api:getPost", { service, id, postId }),
  getDataBase: () => ipcRenderer.invoke("api:getDataBase"),
  getThumbBase: () => ipcRenderer.invoke("api:getThumbBase"),
  getMediaBytes: (path) => ipcRenderer.invoke("api:getMediaBytes", { path }),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  selectOutputFolder: () => ipcRenderer.invoke("app:selectOutputFolder"),
  getOutputFolder: () => ipcRenderer.invoke("app:getOutputFolder"),
  getFavorites: () => ipcRenderer.invoke("app:getFavorites"),
  saveFavorites: (favorites) =>
    ipcRenderer.invoke("app:saveFavorites", { favorites }),
  getReadPosts: () => ipcRenderer.invoke("app:getReadPosts"),
  saveReadPosts: (posts) => ipcRenderer.invoke("app:saveReadPosts", { posts }),
  downloadImage: (url, folder) =>
    ipcRenderer.invoke("app:downloadImage", { url, folder }),
  fetchFileBytes: (url, requestId) =>
    ipcRenderer.invoke("app:fetchFileBytes", { url, requestId }),
  saveBytes: (bytes, filename, folder) =>
    ipcRenderer.invoke("app:saveBytes", { bytes, filename, folder }),
  extractZipImages: (url, requestId) =>
    ipcRenderer.invoke("app:extractZipImages", { url, requestId }),
  onZipProgress: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("app:zipProgress", listener);
    return () => {
      ipcRenderer.removeListener("app:zipProgress", listener);
    };
  },
  onFileProgress: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("app:fileProgress", listener);
    return () => {
      ipcRenderer.removeListener("app:fileProgress", listener);
    };
  },
});
