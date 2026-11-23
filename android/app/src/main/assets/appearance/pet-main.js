'use strict';
// MAIN world has no extension/native APIs, credentials or media. Facts are display-only.
(() => {
  installPetObserver({initiallyActive:false});
  let active = false;
  const send = () => {
    if (!active) return;
    const events = window.__ocPetObserver?.drain() || [];
    if (events.length) window.postMessage({type:'oc-pet-facts', json:JSON.stringify(events)}, location.origin);
  };
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.type !== 'oc-pet-control') return;
    active = e.data.active === true && !document.hidden;
    window.__ocPetObserver?.setActive(active); send();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {active=false; window.__ocPetObserver?.setActive(false);}
  });
  const timer = setInterval(send, 500);
  window.addEventListener('pagehide', e => { if (!e.persisted) {clearInterval(timer); window.__ocPetObserver?.stop();} });
})();
