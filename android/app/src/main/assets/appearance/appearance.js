'use strict';
// Isolated content script: preferences and bounded diagnostics only.
(() => {
  let mediaUrl, pending = false, stopped = false, retryAt = 0;
  let status = {state: 'starting'};
  async function sample() {
    if (pending || stopped) return;
    pending = true;
    let stage = 'native-settings';
    try {
      const wire = await browser.runtime.sendNativeMessage('appearance', {type: 'settings', status});
      stage = 'settings-decode';
      const settings = typeof wire === 'string' ? JSON.parse(wire) : wire;
      if (!settings?.allowed) { status = {state: 'origin-denied'}; return; }
      if (Date.now() < retryAt) return;
      if (settings.enabled && !mediaUrl) {
        stage = 'local-media-message';
        status = {state: stage};
        // Native origin authorization above must succeed before requesting bytes.
        const media = await browser.runtime.sendMessage({type: 'bundled-wallpaper'});
        if (!media?.url?.startsWith('data:video/mp4;base64,')) throw new Error('media-response');
        mediaUrl = media.url;
      }
      stage = 'renderer';
      const result = applyBackground({...settings, active: settings.active && !document.hidden, url: mediaUrl});
      const video = document.getElementById('oc-desktop-video')?.querySelector('video');
      status = {state: result?.state || 'waiting',
        error: video?.error ? 'media-' + video.error.code : '',
        ready: video?.readyState || 0, time: Math.floor(video?.currentTime || 0)};
    } catch (error) {
      const name = ['Error', 'TypeError', 'SecurityError', 'NotAllowedError', 'NotSupportedError', 'ReferenceError'].includes(error?.name) ? error.name : 'Error';
      status = {state: 'error', error: stage + ':' + name};
      // Native messaging can fail transiently during page/session startup.
      // Do not permanently disable media after one rejected promise.
      retryAt = Date.now() + 3000;
      applyBackground({enabled: false});
    } finally { pending = false; }
  }
  const timer = setInterval(sample, 750);
  document.addEventListener('visibilitychange', sample);
  window.addEventListener('pagehide', event => {
    applyBackground({enabled: false});
    if (!event.persisted) { stopped = true; clearInterval(timer); mediaUrl = null; }
  });
  window.addEventListener('pageshow', sample);
  sample();
})();
