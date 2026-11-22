'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pet',Object.freeze({
  command:(name,value)=>ipcRenderer.invoke('pet:command',name,value),
  onState:fn=>{ipcRenderer.on('pet:state',(_e,state)=>fn(state));ipcRenderer.invoke('pet:command','initial');},
}));
