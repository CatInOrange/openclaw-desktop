'use strict';
const $ = id => document.getElementById(id);
let current = {}, busy = false;
function render(state) {
  const enteringSetup = current.phase !== 'setup' && state.phase === 'setup';
  current = state;
  $('setup').hidden = state.phase !== 'setup';
  $('waiting').hidden = !['loading', 'error'].includes(state.phase);
  $('footer').hidden = state.phase === 'ready';
  $('dot').dataset.phase = state.phase;
  $('host').textContent = state.address ? new URL(state.address).host : '尚未连接';
  $('badge').textContent = ({setup:'连接设置', loading:'加载中', ready:'页面已加载', error:'等待重试'})[state.phase];
  $('badge').title = state.message;
  $('back').hidden = !state.canBack;
  $('reload').disabled = !state.address;
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
$('settings').addEventListener('click', () => window.desktop.settings());
$('change-address').addEventListener('click', () => window.desktop.settings());
$('reload').addEventListener('click', () => window.desktop.reconnect());
$('retry').addEventListener('click', () => window.desktop.reconnect());
$('back').addEventListener('click', () => window.desktop.back());
window.addEventListener('online', () => { if (current.phase === 'error') window.desktop.reconnect(); });
