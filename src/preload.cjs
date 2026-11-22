'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  connect: address => ipcRenderer.invoke('desktop:connect', address),
  reconnect: () => ipcRenderer.invoke('desktop:reconnect'),
  settings: () => ipcRenderer.invoke('desktop:settings'),
  appearance: () => ipcRenderer.invoke('desktop:appearance'),
  video: patch => ipcRenderer.invoke('desktop:video', patch),
  bootDone: () => ipcRenderer.invoke('desktop:bootDone'),
  back: () => ipcRenderer.invoke('desktop:back'),
  minimize: () => ipcRenderer.invoke('desktop:minimize'),
  maximize: () => ipcRenderer.invoke('desktop:maximize'),
  close: () => ipcRenderer.invoke('desktop:close'),
  initial: () => ipcRenderer.invoke('desktop:initial'),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:state', listener);
    return () => ipcRenderer.removeListener('desktop:state', listener);
  }
}));
