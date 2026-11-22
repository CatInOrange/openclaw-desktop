'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petSettings',Object.freeze({
 initial:()=>ipcRenderer.invoke('pet:settings','initial'),
 update:patch=>ipcRenderer.invoke('pet:settings','update',patch),
 close:()=>ipcRenderer.invoke('pet:settings','close'),
 onState:fn=>ipcRenderer.on('pet:settings-state',(_e,s)=>fn(s))
}));
