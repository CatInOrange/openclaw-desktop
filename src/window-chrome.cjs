'use strict';
// Acrylic is available only on Windows 11 22H2+. Never request transparent
// chrome on unsupported systems: that can leave an unpainted titlebar.
const applied = new WeakMap();
function supportsAcrylic(platform, release) {
  const [major, , build] = String(release).split('.').map(Number);
  return platform === 'win32' && (major > 10 || (major === 10 && build >= 22621));
}
function applyWindowChrome(win, state, platform, release) {
  const color = state.theme.background;
  const glass = supportsAcrylic(platform, release) && Boolean(state.video?.backgroundEnabled) &&
    !state.bootPlaying && ['ready', 'appearance'].includes(state.phase);
  const key = `${glass}:${color}`;
  const previous = applied.get(win);
  if (previous?.key === key) return previous.glass;
  let enabled = false;
  try {
    if (supportsAcrylic(platform, release)) win.setBackgroundMaterial(glass ? 'acrylic' : 'none');
    win.setBackgroundColor(glass ? '#00000000' : color);
    enabled = glass;
  } catch {
    try {win.setBackgroundMaterial('none');} catch {}
    win.setBackgroundColor(color);
  }
  applied.set(win, {key, glass: enabled});
  return enabled;
}
module.exports = {supportsAcrylic, applyWindowChrome};
