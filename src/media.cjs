'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {Readable} = require('node:stream');
const SCHEME = 'oc-video';
const MEDIA_URL = `${SCHEME}://assets/`;
function byteRange(header, size) {
  if (!header) return {start: 0, end: size - 1, partial: false};
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return null;
  return {start, end, partial: true};
}
function createMediaHandler(directory) {
  return async request => {
    const url = new URL(request.url);
    if (url.protocol !== `${SCHEME}:` || url.host !== 'assets' || url.username || url.password || !['/boot.mp4', '/background.mp4'].includes(url.pathname)) return new Response(null, {status: 404});
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, {status: 405, headers: {Allow: 'GET, HEAD'}});
    const file = path.join(directory, url.pathname.slice(1));
    try {
      const {size} = await fs.promises.stat(file);
      const range = byteRange(request.headers.get('range'), size);
      if (!range) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${size}`}});
      const {start, end, partial} = range;
      const headers = {'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'private, max-age=86400', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff'};
      if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      const body = request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(file, {start, end}));
      return new Response(body, {status: partial ? 206 : 200, headers});
    } catch { return new Response(null, {status: 404}); }
  };
}
module.exports = {SCHEME, MEDIA_URL, byteRange, createMediaHandler};
