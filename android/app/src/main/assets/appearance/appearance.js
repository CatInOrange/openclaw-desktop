'use strict';
// Isolated content script: preferences and bounded diagnostics only.
(() => {
  let mediaUrl, pending = false, stopped = false, retryAt = 0;
  let status = {state: 'starting'};
  function dataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('media-read'));
      reader.readAsDataURL(blob);
    });
  }
  async function sample() {
    if (pending || stopped) return;
    pending = true;
    try {
      const settings = await browser.runtime.sendNativeMessage('appearance', {type: 'settings', status});
      if (!settings?.allowed) { status = {state: 'origin-denied'}; return; }
      if (Date.now() < retryAt) return;
      if (settings.enabled && !mediaUrl) {
        status = {state: 'loading-local-media'};
        const response = await fetch(browser.runtime.getURL('background.mp4'));
        if (!response.ok) throw new Error('media-fetch');
        // A data URL has no extension blob principal. The page already permits
        // data: media; no Gateway CSP changes or remote video requests needed.
        mediaUrl = await dataUrl(await response.blob());
      }
      const result = applyBackground({...settings, active: settings.active && !document.hidden, url: mediaUrl});
      const video = document.getElementById('oc-desktop-video')?.querySelector('video');
      status = {state: result?.state || 'waiting',
        error: video?.error ? 'media-' + video.error.code : '',
        ready: video?.readyState || 0, time: Math.floor(video?.currentTime || 0)};
    } catch (error) {
      status = {state: 'error', error: String(error?.name || 'Error').slice(0, 40)};
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
