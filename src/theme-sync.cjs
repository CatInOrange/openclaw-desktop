'use strict';
// Runs in an isolated renderer world, with no Node or native bridge.
function readTheme() {
  const root = document.documentElement;
  if (!root) return null;
  const style = getComputedStyle(root);
  const mode = root.dataset.themeMode || root.dataset.themeResolved || style.colorScheme || '';
  const dark = mode.includes('dark');
  function color(value) {
    if (!value) return null;
    const probe = document.createElement('span');
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    probe.style.color = value;
    if (!probe.style.color) return null;
    root.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    if (/^rgb\(\d+, \d+, \d+\)$/.test(resolved)) return resolved;
    // Chromium can preserve modern color syntax. Convert it to opaque sRGB.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) return null;
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : null;
  }
  return {
    background: color(style.getPropertyValue('--desktop-titlebar-bg').trim()) || color(style.getPropertyValue('--bg').trim()) || color(style.backgroundColor) || (dark ? 'rgb(16, 21, 28)' : 'rgb(250, 249, 246)'),
    foreground: color(style.getPropertyValue('--desktop-titlebar-text').trim()) || color(style.getPropertyValue('--text').trim()) || (dark ? 'rgb(233, 237, 243)' : 'rgb(32, 36, 42)'),
    dark,
  };
}
const THEME_SCRIPT = `(${readTheme.toString()})()`;
function watchTheme(wc, onTheme, onError, interval = 300) {
  let stopped = false, busy = false;
  async function sample() {
    if (stopped || busy || wc.isDestroyed()) return;
    busy = true;
    try {
      const theme = await wc.executeJavaScriptInIsolatedWorld(1001, [{code: THEME_SCRIPT}]);
      if (!stopped && !wc.isDestroyed()) onTheme(theme);
    } catch (error) { if (!stopped) onError(error); }
    finally { busy = false; }
  }
  const timer = setInterval(sample, interval);
  wc.on('dom-ready', sample);
  sample();
  return () => {stopped = true; clearInterval(timer); wc.removeListener('dom-ready', sample);};
}
module.exports = {readTheme, watchTheme};
