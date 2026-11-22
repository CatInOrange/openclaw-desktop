'use strict';
const $ = id => document.getElementById(id);
let current = {}, busy = false, videoSaving = false, pendingVideo = {}, videoTimer;
let bootSeen = false, bootRunning = false, videoTask = Promise.resolve();
const boot = window.createBootPlayer({
  video: $('boot-video'), overlay: $('boot-overlay'),
  onDone: () => {bootRunning = false; window.desktop.bootDone().catch(() => {});},
});
function renderVideo(state) {
  if (!state.video) return;
  if (!videoSaving && !Object.keys(pendingVideo).length) {
    $('video-boot').checked = state.video.bootEnabled;
    $('video-sound').checked = state.video.bootSound;
    $('video-background').checked = state.video.backgroundEnabled;
    $('video-strength').value = state.video.strength;
    $('video-strength-value').textContent = state.video.strength + '%';
  }
  $('video-sound').disabled = !$('video-boot').checked;
  $('video-strength').disabled = !$('video-background').checked;
  const statuses = {off: '背景已关闭，使用原版界面', paused: '背景已暂停', loading: '正在加载本地背景视频…', playing: '背景正在静音循环播放', error: '背景暂时无法播放，已保留原版界面。可关闭后重新开启重试。', waiting: '打开工作区后显示背景预览'};
  $('background-status').textContent = statuses[state.backgroundStatus] || statuses.waiting;
}
function queueVideo(patch) {
  Object.assign(pendingVideo, patch);
  $('video-save-status').dataset.error = 'false';
  $('video-save-status').textContent = '正在保存…';
  $('video-sound').disabled = !$('video-boot').checked;
  $('video-strength').disabled = !$('video-background').checked;
  if (!videoTimer) videoTimer = setTimeout(flushVideo, 120);
}
async function flushVideo() {
  clearTimeout(videoTimer); videoTimer = null;
  if (videoSaving) {await videoTask; return flushVideo();}
  if (!Object.keys(pendingVideo).length) return;
  let release; videoTask = new Promise(resolve => {release = resolve;});
  const patch = pendingVideo; pendingVideo = {}; videoSaving = true;
  try {
    const result = await window.desktop.video(patch);
    if (!result.ok) throw new Error(result.error);
    $('video-save-status').textContent = '已保存到本机';
  } catch (error) {
    $('video-save-status').textContent = error.message || '设置保存失败';
    $('video-save-status').dataset.error = 'true';
  } finally {
    videoSaving = false;
    if (Object.keys(pendingVideo).length) videoTimer = setTimeout(flushVideo, 120);
    else renderVideo(current);
    release();
  }
}
function render(state) {
  const wasHidden = current.windowActive === false;
  const enteringSetup = current.phase !== 'setup' && state.phase === 'setup';
  current = state;
  document.documentElement.classList.toggle('titlebar-glass', Boolean(state.titlebarGlass));
  if (state.theme) {
    const style = document.documentElement.style;
    style.setProperty('--titlebar-bg', state.theme.background);
    style.setProperty('--titlebar-text', state.theme.foreground);
    style.setProperty('--titlebar-hover', state.theme.dark ? '#ffffff18' : '#0000000d');
  }
  $('appearance').hidden = state.phase !== 'appearance';
  document.body.classList.toggle('appearance-preview', state.phase === 'appearance' && Boolean(state.canBack));
  renderVideo(state);
  if (state.version) $('version').textContent = state.version + ' Preview';
  if (state.bootPlaying && !bootSeen) {
    bootSeen = true; bootRunning = true;
    boot.start({sound: Boolean(state.video?.bootSound), url: 'oc-video://assets/boot.mp4'});
  } else if (!state.bootPlaying && bootRunning) {bootRunning = false; boot.stop();}
  if (bootRunning && state.windowActive === false) $('boot-video').pause();
  else if (bootRunning && wasHidden && state.windowActive) $('boot-video').play().catch(() => boot.stop());
  $('setup').hidden = state.phase !== 'setup';
  $('waiting').hidden = !['loading', 'error'].includes(state.phase);
  $('footer').hidden = ['ready', 'appearance'].includes(state.phase);
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

$('setup-appearance').addEventListener('click', () => window.desktop.appearance());
$('appearance-back').addEventListener('click', async () => {
  // Do not leave with a queued, unsaved slider value.
  clearTimeout(videoTimer); videoTimer = null;
  await flushVideo();
  window.desktop.back();
});
for (const [id, key] of [['video-boot', 'bootEnabled'], ['video-sound', 'bootSound'], ['video-background', 'backgroundEnabled']]) {
  $(id).addEventListener('change', () => queueVideo({[key]: $(id).checked}));
}
$('video-strength').addEventListener('input', () => {
  const strength = Number($('video-strength').value);
  $('video-strength-value').textContent = strength + '%'; queueVideo({strength});
});
document.addEventListener('visibilitychange', () => {
  const video = $('boot-video');
  if (!bootRunning) return;
  if (document.hidden) video.pause();
  else video.play().catch(() => boot.stop());
});
