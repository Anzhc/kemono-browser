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
  downloadImage: (url, folder) =>
    ipcRenderer.invoke("app:downloadImage", { url, folder }),
});
