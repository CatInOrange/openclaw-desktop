'use strict';
/** Pure, transport-independent multi-agent pet state.
 * applyPetEvent mutates and returns state; summarizePetState returns only display facts.
 * Snapshots must include every visible session (or set complete:false). Only
 * hasActiveRun describes direct activity; descendant projections are not counted.
 * Run terminals never clear an aggregate-only activity fact: request a new snapshot.
 */
function createPetState() {
  return {connected: false, complete: false, sessions: new Map(), focus: null, feedback: null};
}
const identity = e => JSON.stringify([e.agentId || agentFromKey(e.sessionKey || e.key), e.sessionKey || e.key, e.sessionId || '']);
function agentFromKey(key) { return /^agent:([^:]+):/.exec(key || '')?.[1] || 'unknown'; }
function row(e) {
  return {id: identity(e), sessionKey: e.sessionKey || e.key, sessionId: e.sessionId,
    agentId: e.agentId || agentFromKey(e.sessionKey || e.key), title: String(e.title || e.label || '').slice(0, 160),
    active: null, runs: new Set(), tools: new Map(), approvals: new Map(), error: false, resultAt: 0};
}
function getRow(state, e, authoritative = false) {
  if (!(e.sessionKey || e.key)) return null;
  const matches = [...state.sessions.values()].filter(s => s.sessionKey === (e.sessionKey || e.key) && s.agentId === (e.agentId || agentFromKey(e.sessionKey || e.key)));
  if (!e.sessionId && matches.length === 1) return matches[0];
  if (!authoritative && e.sessionId && matches.some(s => s.sessionId && s.sessionId !== e.sessionId)) return null;
  const id = identity(e);
  // Generation changes must not inherit old tools or approval prompts.
  for (const [key, prior] of state.sessions) {
    if (prior.sessionKey === (e.sessionKey || e.key) && prior.agentId === (e.agentId || agentFromKey(e.sessionKey || e.key)) && e.sessionId && prior.sessionId !== e.sessionId) state.sessions.delete(key);
  }
  if (!state.sessions.has(id)) state.sessions.set(id, row(e));
  return state.sessions.get(id);
}
function applyPetEvent(state, event, now = Date.now()) {
  if (event.type === 'connection') {
    state.connected = Boolean(event.connected); state.complete = false;
    // Tools and prompts from a retired connection are not current evidence.
    for (const s of state.sessions.values()) {s.tools.clear(); s.approvals.clear();}
    state.feedback = null;
    return state;
  }
  if (event.type === 'snapshot') {
    const next = new Map();
    for (const item of event.sessions || []) {
      if (!(item.sessionKey || item.key)) continue;
      const s = getRow(state, item, true);
      s.title = String(item.title || item.label || s.title).slice(0, 160);
      s.active = typeof item.hasActiveRun === 'boolean' ? item.hasActiveRun : null;
      if (Array.isArray(item.activeRunIds)) {
        s.runs = new Set(item.activeRunIds.filter(x => typeof x === 'string'));
        for (const [id, tool] of s.tools) if (!s.runs.has(tool.runId)) s.tools.delete(id);
      } else s.runs.clear(); // exact identities unavailable, not an empty-run assertion
      if (s.active === false) {s.runs.clear(); s.tools.clear();}
      next.set(s.id, s);
    }
    if (event.complete === true) state.sessions = next;
    state.complete = event.complete === true;
    return state;
  }
  const s = getRow(state, event);
  if (!s) return state;
  if (event.type === 'run' && event.runId) {
    if (event.phase === 'start') {s.runs.add(event.runId); s.error = false;}
    else if (['end', 'error', 'aborted'].includes(event.phase)) {
      s.runs.delete(event.runId);
      for (const [id, tool] of s.tools) if (tool.runId === event.runId) s.tools.delete(id);
      if (event.phase === 'error') s.error = true;
      state.feedback = event.phase === 'aborted' ? null : {action: event.phase === 'error' ? 'error' : 'success', until: now + 4000};
      // Aggregate activity can only be retired by an authoritative snapshot.
      if (s.active !== false) state.complete = false;
    }
  }
  if (event.type === 'tool' && event.toolCallId && event.runId) {
    const id = JSON.stringify([event.runId, event.toolCallId]);
    if (event.phase === 'start') {s.runs.add(event.runId); s.tools.set(id, {runId: event.runId});}
    else if (event.phase === 'end') {s.tools.delete(id); s.resultAt = now;}
  }
  if (event.type === 'approval' && event.approvalId) {
    if (event.phase === 'pending') s.approvals.set(event.approvalId, {expiresAt: event.expiresAt});
    else if (event.phase === 'resolved') s.approvals.delete(event.approvalId);
  }
  if (event.type === 'acknowledge') s.error = false;
  return state;
}
function summarizePetState(state, now = Date.now()) {
  const sessions = [...state.sessions.values()].map(s => {
    const waiting = [...s.approvals.values()].filter(a => !Number.isFinite(a.expiresAt) || a.expiresAt > now).length;
    const active = s.active === true || s.runs.size > 0;
    return {id: s.id, sessionKey: s.sessionKey, sessionId: s.sessionId, agentId: s.agentId, title: s.title,
      active, waiting, error: s.error,
      action: waiting ? 'waiting' : active ? s.tools.size ? 'working' : s.resultAt > 0 && now - s.resultAt < 1500 ? 'result' : 'thinking' : 'idle'};
  });
  const activeSessions = sessions.filter(s => s.active).length;
  const activeAgents = new Set(sessions.filter(s => s.active).map(s => s.agentId)).size;
  const waitingCount = sessions.reduce((sum, s) => sum + s.waiting, 0);
  const errorCount = sessions.filter(s => s.error).length;
  const priority = {waiting: 4, working: 3, thinking: 2, result: 1, idle: 0};
  const candidates = sessions.filter(s => s.active || s.waiting);
  const top = candidates.reduce((p, s) => Math.max(p, priority[s.action]), 0);
  const focus = candidates.find(s => s.id === state.focus && priority[s.action] === top) || candidates.find(s => priority[s.action] === top);
  state.focus = focus?.id || null;
  let action = focus?.action || 'idle';
  const complete = state.complete && sessions.every(s => state.sessions.get(s.id).active !== null);
  if (!state.connected) action = 'offline';
  else if (!focus && !complete) action = 'unknown';
  else if (!focus && state.feedback?.until > now) action = state.feedback.action;
  return {action, connected: state.connected, complete, activeAgents, activeSessions, waitingCount, errorCount, sessions, focus: focus?.id || null};
}
module.exports = {createPetState, applyPetEvent, summarizePetState};
