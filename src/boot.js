'use strict';
// Local shell only; also exportable to the non-GUI lifecycle tests.
function createBootPlayer({video, overlay, onDone, clock = globalThis}) {
  let started = false, finished = false, ending = false, deadline, firstFrame, fadeTimer, fadeEnd;
  function complete() {
    if (finished) return;
    finished = true;
    clock.clearTimeout(deadline); clock.clearTimeout(firstFrame);
    clock.clearTimeout(fadeEnd); clock.clearInterval(fadeTimer);
    video.pause(); video.removeAttribute('src'); video.load(); overlay.hidden = true;
    onDone();
  }
  function finish(immediate = false) {
    if (finished || ending) return;
    ending = true;
    clock.clearTimeout(deadline); clock.clearTimeout(firstFrame);
    if (immediate) {complete(); return;}
    overlay.classList.add('leaving');
    const volume = video.volume;
    let step = 0;
    fadeTimer = clock.setInterval(() => {video.volume = Math.max(0, volume * (1 - ++step / 10));}, 30);
    fadeEnd = clock.setTimeout(complete, 320);
  }
  video.addEventListener('ended', () => finish());
  video.addEventListener('error', () => finish(true));
  video.addEventListener('playing', () => clock.clearTimeout(firstFrame));
  return {
    async start({sound = true, url}) {
      if (started) return;
      started = true; overlay.hidden = false; video.muted = !sound; video.volume = 1;
      deadline = clock.setTimeout(() => finish(true), 18000);
      firstFrame = clock.setTimeout(() => finish(true), 5000);
      video.src = url;
      try {await video.play();}
      catch {
        if (finished || ending) return;
        video.muted = true;
        try {await video.play();} catch {finish(true);}
      }
    },
    stop: () => {ending = true; complete();},
  };
}
if (typeof module !== 'undefined') module.exports = {createBootPlayer};
else window.createBootPlayer = createBootPlayer;
