'use strict';
// Extension-only messaging; no externally_connectable or arbitrary URL/file API.
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || (sender.frameId !== undefined && sender.frameId !== 0) ||
      message?.type !== 'bundled-wallpaper' || !/^https?:\/\//.test(sender.url || '')) return;
  return Promise.resolve({url: OPENCLAW_BACKGROUND_MEDIA});
});
