'use strict';
const $ = id => document.getElementById(id);
let current = {}, busy = false;
function render(state) {
  const enteringSetup = current.phase !== 'setup' && state.phase === 'setup';
  current = state;
  $('setup').hidden = state.phase !== 'setup';
  $('waiting').hidden = !['loading', 'error'].includes(state.phase);
  $('footer').hidden = state.phase === 'ready';
  document.body.classList.toggle('fullscreen', Boolean(state.fullscreen));
  $('maximize').textContent = state.maximized ? '❐' : '□';
  $('maximize').title = state.maximized ? '还原' : '最大化';
  $('maximize').setAttribute('aria-label', $('maximize').title);
  $('close').title = state.trayAvailable ? '关闭到托盘' : '退出应用';
  $('back').hidden = !state.canBack;
  $('status-title').textContent = state.phase === 'error' ? '暂时无法打开工作区' : '正在打开工作区';
  $('status-message').textContent = state.message;
  document.querySelector('.status-card').dataset.error = state.phase === 'error';
  $('retry').hidden = state.phase !== 'error';
  $('footer-note').textContent = state.notice || (state.trayAvailable ? '关闭窗口后常驻托盘 · 托盘菜单退出' : '独立桌面壳 · 非官方客户端');
  if (enteringSetup || !$('address').value) $('address').value = state.address || '';
  if (enteringSetup) { $('form-error').textContent = ''; $('address').focus(); }
}
window.desktop.onState(render);
window.desktop.initial().then(render);
$('connect-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  busy = true; $('connect-button').disabled = true; $('form-error').textContent = '';
  try {
    const result = await window.desktop.connect($('address').value);
    if (!result.ok) $('form-error').textContent = result.error;
  } catch { $('form-error').textContent = '连接请求失败，请重试。'; }
  finally { busy = false; $('connect-button').disabled = false; }
});
$('minimize').addEventListener('click', () => window.desktop.minimize());
$('maximize').addEventListener('click', () => window.desktop.maximize());
$('close').addEventListener('click', () => window.desktop.close());
$('change-address').addEventListener('click', () => window.desktop.settings());
$('retry').addEventListener('click', () => window.desktop.reconnect());
$('back').addEventListener('click', () => window.desktop.back());
window.addEventListener('online', () => { if (current.phase === 'error') window.desktop.reconnect(); });
