'use strict';
// Native caption buttons sit over the remote toolbar: no remote native bridge,
// no second video, and no desktop Acrylic surface above the wallpaper.
function windowChromeOptions(platform, theme) {
  return platform === 'win32' ? {
    titleBarStyle: 'hidden',
    titleBarOverlay: {color: '#00000000', symbolColor: theme.foreground, height: 48},
  } : {frame: false};
}
const applied = new WeakMap();
function applyWindowChrome(win, state, platform) {
  const integrated = platform === 'win32' && !state.bootPlaying && Boolean(state.canBack) &&
    ['ready', 'appearance'].includes(state.phase);
  const height = integrated && state.phase === 'ready' ? 48 : 32;
  const key = `${height}:${state.theme.background}:${state.theme.foreground}`;
  if (applied.get(win) !== key) {
    win.setBackgroundColor(state.theme.background);
    if (platform === 'win32') win.setTitleBarOverlay({color: '#00000000', symbolColor: state.theme.foreground, height});
    applied.set(win, key);
  }
  return integrated;
}
module.exports = {windowChromeOptions, applyWindowChrome};
