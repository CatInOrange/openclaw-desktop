'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {applyWorkspaceChrome, WORKSPACE_CSS} = require('./workspace-chrome.cjs');
const BACKGROUND_CSS = fs.readFileSync(path.join(__dirname, 'background.css'), 'utf8');
// This function is serialized into an isolated renderer world; it has no native API.
function applyBackground(settings) {
  const root = document.documentElement;
  if (!root || !document.body) return {state: 'waiting'};
  const key = '__openclawDesktopVideo';
  let runtime = globalThis[key];
  if (!runtime) {
    runtime = {layer: null, video: null, failed: false, pending: false, enabled: false, active: false, state: 'off'};
    globalThis[key] = runtime;
  }
  function clear() {
    root.removeAttribute('data-oc-video');
    root.style.removeProperty('--oc-video-surface');
    root.style.removeProperty('--oc-glass-coverage');
    if (runtime.video) {
      runtime.video.pause(); runtime.video.removeAttribute('src'); runtime.video.load();
    }
    if (runtime.layer) runtime.layer.remove();
    runtime.video = null; runtime.layer = null; runtime.failed = false; runtime.pending = false;
    runtime.enabled = false; runtime.state = 'off';
  }
  if (!settings.enabled) {clear(); return {state: 'off'};}
  if (runtime.layer && !runtime.layer.isConnected) clear();
  runtime.enabled = true;
  runtime.active = Boolean(settings.active) && !document.hidden;
  if (!runtime.layer) {
    const layer = document.createElement('div');
    layer.id = 'oc-desktop-video'; layer.setAttribute('aria-hidden', 'true');
    const video = document.createElement('video');
    video.muted = true; video.defaultMuted = true; video.volume = 0; video.loop = true;
    video.playsInline = true; video.preload = 'auto'; video.disablePictureInPicture = true;
    // Preload behind the opening video; playback remains visibility-gated.
    video.src = settings.url; video.load();
    layer.appendChild(video); document.body.prepend(layer);
    runtime.layer = layer; runtime.video = video; runtime.state = 'loading';
    video.addEventListener('playing', () => {
      if (runtime.video !== video || !runtime.enabled) return;
      runtime.state = 'playing'; root.setAttribute('data-oc-video', 'on');
    });
    video.addEventListener('error', () => {
      if (runtime.video !== video) return;
      runtime.failed = true; runtime.state = 'error';
      root.removeAttribute('data-oc-video'); video.pause();
    });
  }
  const mode = root.dataset.themeMode || root.dataset.themeResolved || getComputedStyle(root).colorScheme || '';
  const dark = mode.includes('dark');
  const strength = Math.max(0, Math.min(100, settings.strength));
  // Light text/dark text need different levels of surface coverage.
  const coverage = dark ? 90 - strength * .65 : 96 - strength * .36;
  const surface = `${coverage.toFixed(1)}%`;
  if (root.style.getPropertyValue('--oc-video-surface') !== surface) root.style.setProperty('--oc-video-surface', surface);
  const transparency = Number.isFinite(settings.glassTransparency) ? Math.max(0, Math.min(100, settings.glassTransparency)) : 78;
  root.style.setProperty('--oc-glass-coverage', `${100 - transparency}%`);
  if (runtime.failed) return {state: 'error'};
  const video = runtime.video;
  if (!runtime.active) {
    video.pause(); runtime.state = 'paused';
  } else if (video.paused && !runtime.pending) {
    if (!video.getAttribute('src')) video.src = settings.url;
    runtime.pending = true;
    const result = video.play();
    Promise.resolve(result).catch(() => {
      if (runtime.video === video && runtime.enabled && runtime.active) {
        runtime.failed = true; runtime.state = 'error'; root.removeAttribute('data-oc-video');
      }
    }).finally(() => {if (runtime.video === video) runtime.pending = false;});
  }
  return {state: runtime.state};
}
function watchBackground(wc, getSettings, onStatus, interval = 400) {
  let stopped = false, busy = false, styled = false, generation = 0;
  async function sample() {
    if (stopped || busy || wc.isDestroyed()) return;
    busy = true;
    const currentGeneration = generation;
    try {
      if (!styled) {
        await wc.insertCSS(BACKGROUND_CSS + '\n' + WORKSPACE_CSS);
        if (currentGeneration !== generation) return;
        styled = true;
      }
      if (stopped || wc.isDestroyed()) return;
      const settings = getSettings();
      const result = await wc.executeJavaScriptInIsolatedWorld(1002, [{code: `(${applyWorkspaceChrome.toString()})(${JSON.stringify(settings)}); (${applyBackground.toString()})(${JSON.stringify(settings)})`}]);
      if (!stopped && currentGeneration === generation) onStatus(result?.state || 'waiting');
    } catch { if (!stopped) onStatus('error'); }
    finally { busy = false; }
  }
  const ready = () => {generation++; styled = false; sample();};
  wc.on('dom-ready', ready);
  const timer = setInterval(sample, interval);
  return {refresh: sample, stop() {stopped = true; clearInterval(timer); wc.removeListener('dom-ready', ready);}};
}
module.exports = {applyBackground, watchBackground};
