'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  connect: address => ipcRenderer.invoke('desktop:connect', address),
  reconnect: () => ipcRenderer.invoke('desktop:reconnect'),
  settings: () => ipcRenderer.invoke('desktop:settings'),
  back: () => ipcRenderer.invoke('desktop:back'),
  initial: () => ipcRenderer.invoke('desktop:initial'),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:state', listener);
    return () => ipcRenderer.removeListener('desktop:state', listener);
  }
}));
