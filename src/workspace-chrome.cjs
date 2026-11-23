'use strict';
const fs = require('node:fs');
const path = require('node:path');
const WORKSPACE_CSS = fs.readFileSync(path.join(__dirname, 'workspace-chrome.css'), 'utf8');
// Serialized into the isolated styling world. No IPC, Node, or window bridge.
function applyWorkspaceChrome(settings) {
  const root = document.documentElement;
  if (!root || !document.body) return;
  for (const region of document.querySelectorAll('[data-oc-caption-region]')) region.removeAttribute('data-oc-caption-region');
  const enabled = settings.chromeActive && ((settings.integratedChrome && !settings.fullscreen) || settings.musicControls);
  if (!enabled) {
    root.removeAttribute('data-oc-caption');
    root.removeAttribute('data-oc-caption-fallback');
    for (const header of document.querySelectorAll('[data-oc-caption-row]')) header.removeAttribute('data-oc-caption-row');
    document.getElementById('oc-desktop-caption-fallback')?.remove();
    return;
  }
  const zoom = Number.isFinite(settings.zoom) && settings.zoom > 0 ? settings.zoom : 1;
  const height = 48 / zoom;
  root.style.setProperty('--oc-caption-height', `${height}px`);
  root.style.setProperty('--oc-caption-inset', settings.reserveControls ? `${((settings.integratedChrome && !settings.fullscreen ? 144 : 0) + (settings.musicControls ? 152 : 0)) / zoom}px` : '0px');
  root.setAttribute('data-oc-caption', 'on');
  const wasFallback = root.hasAttribute('data-oc-caption-fallback');
  let found = false;
  for (const header of document.querySelectorAll('.chat-pane__header,.topbar')) {
    const rect = header.getBoundingClientRect();
    const atTop = rect.height > 0 && rect.width > 0 && rect.top >= -1 && rect.top <= (wasFallback ? height + 1 : 1);
    if (atTop) {
      // Only the rightmost header needs caption-button space in a split layout.
      // New Control UI reserves a sibling panels-toggle outside the header.
      // Use the owning region's edge, not the already-inset header edge.
      const region = header.closest?.('.sidebar-region');
      const regionRect = region?.getBoundingClientRect();
      const rightmost = (regionRect?.right ?? rect.right) >= window.innerWidth - 2;
      header.setAttribute('data-oc-caption-row', rightmost ? 'right' : 'left');
      if (rightmost && region) region.setAttribute('data-oc-caption-region', 'right');
      found = true;
    } else header.removeAttribute('data-oc-caption-row');
  }
  if (found) {
    root.removeAttribute('data-oc-caption-fallback');
    document.getElementById('oc-desktop-caption-fallback')?.remove();
  } else {
    // Non-chat pages without an existing toolbar still need accessible controls.
    root.setAttribute('data-oc-caption-fallback', 'on');
    if (!document.getElementById('oc-desktop-caption-fallback')) {
      const bar = document.createElement('div');
      bar.id = 'oc-desktop-caption-fallback'; bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);
    }
  }
}
module.exports = {applyWorkspaceChrome, WORKSPACE_CSS};
