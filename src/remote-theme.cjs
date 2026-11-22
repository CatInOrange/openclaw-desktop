'use strict';
// Isolated, sandboxed preload: reads appearance only; exposes no API to the page.
const {ipcRenderer} = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  if (window.top !== window) return;
  const root = document.documentElement;
  let timer, last = '';
  function sample() {
    const style = getComputedStyle(root);
    const mode = root.dataset.themeMode || root.dataset.themeResolved || style.colorScheme;
    const dark = mode.includes('dark');
    // Resolve CSS variables through the browser, including modern color syntax.
    function color(value) {
      if (!value) return null;
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none';
      probe.style.color = value;
      if (!probe.style.color) return null;
      root.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return /^rgb\(\d+, \d+, \d+\)$/.test(resolved) ? resolved : null;
    }
    const background = color(style.getPropertyValue('--desktop-titlebar-bg').trim())
      || color(style.getPropertyValue('--bg').trim()) || color(style.backgroundColor)
      || (dark ? 'rgb(16, 21, 28)' : 'rgb(250, 249, 246)');
    const foreground = color(style.getPropertyValue('--desktop-titlebar-text').trim())
      || color(style.getPropertyValue('--text').trim()) || (dark ? 'rgb(233, 237, 243)' : 'rgb(32, 36, 42)');
    const theme = {background, foreground, dark};
    const signature = JSON.stringify(theme);
    if (signature !== last) { last = signature; ipcRenderer.send('desktop:theme', theme); }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(sample, 80); }
  new MutationObserver(schedule).observe(root, {attributes: true, attributeFilter: ['data-theme', 'data-theme-mode', 'data-theme-resolved', 'class', 'style']});
  if (document.head) new MutationObserver(schedule).observe(document.head, {subtree: true, childList: true, attributes: true, characterData: true});
  document.addEventListener('load', schedule, true);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
  sample();
}, {once: true});
