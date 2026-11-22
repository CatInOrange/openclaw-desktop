'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('music',Object.freeze({
  command:(action,token)=>ipcRenderer.invoke('music:command',action,token),
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('music:state',listener);return()=>ipcRenderer.removeListener('music:state',listener);},
}));
