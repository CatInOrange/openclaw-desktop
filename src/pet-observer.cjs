'use strict';

// Runs in the existing Control UI page. It reuses its authenticated socket, never
// reads auth storage, and exports only normalized monitoring facts. No pet IPC is
// exposed to the remote page. The hook is version-adapted protocol code, not DOM
// scraping. Failure or unsupported protocol leaves the monitor unknown.
function installPetObserver() {
  if (window.__ocPetObserver) return;
  const events = [], pending = new Map(), subscriptions = new Map();
  const Native = window.WebSocket;
  let socket = null, serial = 0, ready = false, reading = false, dirty = false;
  let readAgain = false, epoch = 0;
  const approvals = new Map();
  const push = event => {
    if (events.length >= 4096) { events.length = 0; events.push({type: 'connection', connected: false}); dirty = true; }
    events.push(event);
  };
  const ident = p => ({sessionKey: p.sessionKey || p.key, agentId: p.agentId, sessionId: p.sessionId, runId: p.runId});
  function request(method, params) {
    if (!ready || !socket || socket.readyState !== 1) return Promise.reject(new Error('offline'));
    const id = `oc-pet-${++serial}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, 12000);
      pending.set(id, {resolve, reject, timer});
      socket.send(JSON.stringify({type: 'req', id, method, params}));
    });
  }
  function approval(p) {
    const a = p.approval;
    if (!a || typeof a.id !== 'string') return;
    const phase = p.phase === 'pending' ? 'pending' : 'resolved';
    if (phase === 'pending') approvals.set(a.id, {sessionKey: p.sessionKey, agentId: p.agentId}); else approvals.delete(a.id);
    push({type: 'approval', ...ident(p), approvalId: a.id, phase, expiresAt: a.expiresAtMs});
  }
  function event(name, p) {
    if (!p || typeof p !== 'object') return;
    if (name === 'sessions.changed') { dirty = true; return; }
    if (name === 'shutdown') { disconnect(); return; }
    if (name === 'session.approval') return approval(p);
    if (name === 'chat' && ['final', 'aborted', 'error'].includes(p.state)) {
      push({type: 'run', ...ident(p), phase: p.state === 'final' ? 'end' : p.state}); dirty = true;
    }
    if (name !== 'agent') return;
    const d = p.data || {};
    if (p.stream === 'lifecycle' && ['start', 'end', 'error'].includes(d.phase)) {
      push({type: 'run', ...ident(p), phase: d.phase}); dirty = true;
    }
    if (p.stream === 'tool' && typeof d.toolCallId === 'string' && ['start', 'result', 'end'].includes(d.phase)) {
      push({type: 'tool', ...ident(p), toolCallId: d.toolCallId, phase: d.phase === 'start' ? 'start' : 'end'});
    }
    if (p.stream === 'execution' && d.approval) approval({...p, phase: d.approval.state, approval: d.approval});
  }
  async function subscribe(row) {
    const id = `${row.agentId || ''}|${row.key}`;
    const previous = subscriptions.get(id);
    if (previous?.admitted && Date.now() - previous.admittedAt < 30000) return true;
    const generation = epoch;
    const params = {key: row.key, ...(row.agentId ? {agentId: row.agentId} : {}), mode: 'narration', subscriptionId: `pet-${id}`};
    subscriptions.set(id, {params, admitted: false});
    try {
      let r;
      try { r = await request('sessions.messages.subscribe', {...params, includeApprovals: true}); }
      catch {
        // Keep tool/lifecycle coverage without claiming approval visibility.
        await request('sessions.messages.subscribe', params);
        return false;
      }
      if (generation !== epoch) return false;
      const replay = r?.approvalReplay;
      for (const a of replay?.approvals || []) approval({sessionKey: replay.sessionKey, agentId: row.agentId, phase: 'pending', approval: a});
      if (!replay || replay.truncated) return false;
      const current = new Set((replay.approvals || []).map(a => a.id));
      for (const [approvalId, a] of approvals) if (a.sessionKey === replay.sessionKey && !current.has(approvalId)) {
        approvals.delete(approvalId); push({type: 'approval', ...a, approvalId, phase: 'resolved'});
      }
      subscriptions.set(id, {params, admitted: true, admittedAt: Date.now()});
      return true;
    } catch { if (generation === epoch) subscriptions.delete(id); return false; }
  }
  async function refresh() {
    if (!ready) return;
    if (reading) { readAgain = true; return; }
    reading = true; dirty = false;
    const generation = epoch;
    const rows = []; let offset = 0, complete = false;
    try {
      for (let page = 0; page < 100; page++) {
        const list = await request('sessions.list', {limit: 100, offset});
        if (generation !== epoch) return;
        if (!Array.isArray(list.sessions)) throw new Error('unsupported roster');
        rows.push(...list.sessions);
        if (!list.hasMore) { complete = true; break; }
        if (!(list.nextOffset > offset)) break;
        offset = list.nextOffset;
      }
      const wanted = new Set(), selected = [];
      for (const row of rows) {
        const id = `${row.agentId || ''}|${row.key}`;
        if (wanted.has(id)) continue;
        wanted.add(id); if (selected.length < 128) selected.push(row);
      }
      // Bounded concurrent admission. Idle sessions may still hold approvals.
      let approvalComplete = wanted.size <= 128;
      for (let i = 0; i < selected.length; i += 8) {
        const results = await Promise.all(selected.slice(i, i + 8).map(subscribe));
        if (generation !== epoch) return;
        if (results.some(ok => !ok)) approvalComplete = false;
      }
      for (const [id, entry] of subscriptions) if (!wanted.has(id)) {
        subscriptions.delete(id);
        const params = entry.params;
        void request('sessions.messages.unsubscribe', {key: params.key, agentId: params.agentId, subscriptionId: params.subscriptionId}).catch(() => {});
        for (const [approvalId, a] of approvals) if (`${a.agentId || ''}|${a.sessionKey}` === id) {
          approvals.delete(approvalId); push({type: 'approval', ...a, approvalId, phase: 'resolved'});
        }
      }
      push({type: 'snapshot', sessions: rows.map(r => ({key: r.key, sessionKey: r.key, agentId: r.agentId, sessionId: r.sessionId, title: r.title || r.displayName, hasActiveRun: r.hasActiveRun, activeRunIds: r.activeRunIds})), complete: complete && !dirty, approvalsComplete: approvalComplete});
      push({type: 'notice', message: approvalComplete ? '' : '授权提醒覆盖不完整；请回主界面确认', approvalsAvailable: approvalComplete});
    } catch { if (generation === epoch) push({type: 'snapshot', sessions: [], complete: false}); }
    finally { reading = false; if (ready && (dirty || readAgain)) { readAgain = false; setTimeout(() => void refresh(), 300); } }
  }
  function disconnect() {
    epoch++; ready = false; subscriptions.clear(); approvals.clear();
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('offline')); }
    pending.clear(); push({type: 'connection', connected: false});
  }
  async function connected(ws) {
    if (ready && socket === ws) return;
    epoch++; socket = ws; ready = true; push({type: 'connection', connected: true});
    try { await request('sessions.subscribe', {limit: 100}); } catch { /* periodic list remains authoritative */ }
    void refresh();
  }
  class ObservedSocket extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'res' && pending.has(m.id)) {
          const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
          if (m.ok) p.resolve(m.payload); else p.reject(new Error('rpc failed'));
          return;
        }
        if (m.type === 'res' && m.ok && m.payload?.type === 'hello-ok') void connected(this);
        if (socket === this && ready && m.type === 'event') event(m.event, m.payload);
      });
      this.addEventListener('close', () => { if (socket === this) disconnect(); });
    }
  }
  window.WebSocket = ObservedSocket;
  const timer = setInterval(() => { if (ready) void refresh(); }, 15000);
  const fastTimer = setInterval(() => { if (ready && dirty) void refresh(); }, 500);
  Object.defineProperty(window, '__ocPetObserver', {configurable: true, value: {
    drain: () => events.splice(0),
    stop: () => { clearInterval(timer); clearInterval(fastTimer); disconnect(); window.WebSocket = Native; delete window.__ocPetObserver; }
  }});
}

function watchPetGateway(wc, onEvent, {isTrusted = () => true} = {}) {
  let stopped = false, scriptId, attached = false, pollBusy = false;
  const code = `(${installPetObserver.toString()})()`;
  const emit = e => { if (!stopped) onEvent(e); };
  const offline = () => emit({type: 'connection', connected: false});
  const trusted = () => !wc.isDestroyed() && isTrusted(wc.getURL());
  const navigation = (_e, _url, inPlace, main) => { if (main && !inPlace) offline(); };
  const detached = () => { attached = false; offline(); };
  wc.on('did-start-navigation', navigation);
  wc.debugger.on('detach', detached);
  async function setup() {
    try {
      // Never steal a debugger owned by another consumer.
      if (wc.debugger.isAttached()) throw new Error('debugger in use');
      wc.debugger.attach('1.3'); attached = true;
      await wc.debugger.sendCommand('Page.enable');
      const r = await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {source: code}); scriptId = r.identifier;
      // For a newly created view this runs before loadURL; the persistent hook
      // then runs before the Control UI creates its authenticated WebSocket.
      if (trusted()) await wc.debugger.sendCommand('Runtime.evaluate', {expression: code});
    } catch { offline(); }
  }
  const setupPromise = setup();
  const timer = setInterval(async () => {
    if (stopped || pollBusy || !attached || !trusted()) return;
    pollBusy = true;
    try {
      const r = await wc.debugger.sendCommand('Runtime.evaluate', {expression: 'window.__ocPetObserver ? window.__ocPetObserver.drain() : []', returnByValue: true});
      for (const e of r.result?.value || []) if (e && typeof e.type === 'string') emit(e);
    } catch { offline(); }
    finally { pollBusy = false; }
  }, 250);
  offline();
  function stop() {
    if (stopped) return;
    stopped = true; clearInterval(timer); wc.removeListener('did-start-navigation', navigation); wc.debugger.removeListener('detach', detached);
    void setupPromise.then(async () => {
      if (!attached || wc.isDestroyed()) return;
      try {
        await wc.debugger.sendCommand('Runtime.evaluate', {expression: 'window.__ocPetObserver?.stop()'});
        if (scriptId) await wc.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {identifier: scriptId});
        wc.debugger.detach();
      } catch {}
    });
  }
  stop.ready = setupPromise;
  return stop;
}
module.exports = {watchPetGateway, installPetObserver};
