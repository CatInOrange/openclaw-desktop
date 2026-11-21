'use strict';
function normalizeGateway(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('请输入 Gateway 地址');
  let url;
  try { url = new URL(raw); } catch { throw new Error('请输入完整地址，例如 https://claw.example.com'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 地址');
  if (url.username || url.password || url.search || url.hash) throw new Error('地址中不能包含密码、Token、查询参数或片段；请在 Control UI 中登录');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
function allowedExternal(input) {
  try { return ['http:', 'https:'].includes(new URL(input).protocol); } catch { return false; }
}
function sameOrigin(input, gateway) {
  try { return new URL(input).origin === new URL(gateway).origin; } catch { return false; }
}
function restoreBounds(saved, displays) {
  const area = displays[0].workArea;
  const width = Math.min(Math.max(Number(saved?.width) || 1280, 800), area.width);
  const height = Math.min(Math.max(Number(saved?.height) || 860, 600), area.height);
  const x = Number(saved?.x), y = Number(saved?.y);
  const visible = Number.isFinite(x) && Number.isFinite(y) && displays.some(({workArea: r}) =>
    x >= r.x && y >= r.y && x + width <= r.x + r.width && y + height <= r.y + r.height);
  return visible ? {width, height, x, y} : {width, height};
}
module.exports = {normalizeGateway, allowedExternal, sameOrigin, restoreBounds};
