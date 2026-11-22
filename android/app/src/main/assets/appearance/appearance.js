'use strict';
// Isolated content script. No page event/message bridge; only read-only preferences.
(() => {
  let blobUrl, pending = false, stopped = false, failed = false;
  async function sample() {
    if (pending || stopped) return;
    pending = true;
    try {
      const settings = await browser.runtime.sendNativeMessage('appearance', {type: 'settings'});
      if (!settings?.allowed) return;
      if (settings.enabled && !blobUrl && !failed) {
        // Firefox MV2 extension fetch uses extension permissions. Present a blob
        // to the document's media-src CSP, without relaxing the Gateway CSP.
        const response = await fetch(browser.runtime.getURL('background.mp4'));
        if (!response.ok) throw new Error('Local media unavailable');
        blobUrl = URL.createObjectURL(await response.blob());
      }
      applyBackground({...settings, enabled: settings.enabled && !failed, active: settings.active && !document.hidden, url: blobUrl});
    } catch {
      failed = true;
      applyBackground({enabled: false});
    } finally { pending = false; }
  }
  const timer = setInterval(sample, 750);
  document.addEventListener('visibilitychange', sample);
  window.addEventListener('pagehide', event => {
    applyBackground({enabled: false});
    if (!event.persisted) { stopped = true; clearInterval(timer); if (blobUrl) URL.revokeObjectURL(blobUrl); }
  });
  window.addEventListener('pageshow', sample);
  sample();
})();
