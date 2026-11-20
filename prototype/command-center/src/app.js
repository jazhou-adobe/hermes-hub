// PROTOTYPE, throwaway. Command Center flow: structurally different variants over one shared live engine.
// Plan: "Five variants of the Command Center triage flow (bay | bay-page | feed | focus | lanes), switchable via ?variant=, on one page."
import * as hub from './engine.js';
import { callsign, endedRounds, hhmm, hhmmss, isOpenQ, isSet, liveness, pendingRounds, roundById, sessionById, state, valueWords } from './engine.js';
import { patch } from './morph.js';
import { KIND_WORD, chip, esc, expandedRuns, icon, lockSoon, lockSoonBadge, questionCount, roundForm, stateWord, strip, timer } from './widgets.js';

const VARIANTS = [
  { key: 'bay', name: 'Strip Bay' },
  { key: 'bay-page', name: 'Bay · page scroll' },
  { key: 'feed', name: 'Feed' },
  { key: 'focus', name: 'Focus Queue' },
  { key: 'lanes', name: 'Agent Lanes' },
];
const isBay = () => ui.variant === 'bay' || ui.variant === 'bay-page';
const params = new URLSearchParams(location.search);
const ui = {
  variant: VARIANTS.some((v) => v.key === params.get('variant')) ? params.get('variant') : 'bay',
  view: ['triage', 'log', 'agents', 'settings'].includes(params.get('view')) ? params.get('view') : 'triage',
  openId: pendingRounds()[0]?.id ?? null,
  bayActive: null,
  drawerOpen: false,
  currentQ: {},
  panel: {},
  panelText: {},
  redirectError: {},
  editProposal: {},
  notesOpen: {},
  invalid: {},
  status: {},
  toasts: [],
  announce: '',
  confirm: null,
  stateOpen: params.get('state') === 'open',
  outline: false,
  keysOpen: false,
  logOpen: {},
  agentOpen: {},
  forget: null,
  copied: {},
  feedShown: new Set(),
  feedCleared: new Set(),
};
let toastSeq = 0;
let pendingFocus = null;
let pendingScroll = null;

const root = document.getElementById('app');

// ---------- Engine events ----------

hub.subscribe((type, d) => {
  if (type === 'announce') ui.announce = d.text;
  if (type === 'notify') {
    const id = ++toastSeq;
    ui.toasts.push({ id, ...d });
    ui.toasts = ui.toasts.slice(-4);
    setTimeout(() => { ui.toasts = ui.toasts.filter((t) => t.id !== id); render(); }, 9000);
  }
  render();
});

// ---------- Helpers ----------

const pending = () => pendingRounds();
function firstOpenQ(r) {
  const i = r.questions.findIndex((q) => isOpenQ(q) && !isSet(q, r.draft.values[q.id]));
  return i >= 0 ? i : Math.max(0, r.questions.findIndex(isOpenQ));
}
const curQ = (r) => {
  const i = ui.currentQ[r.id];
  return i != null && r.questions[i] && isOpenQ(r.questions[i]) ? i : firstOpenQ(r);
};
function ctxFor(r, scope, extra = {}) {
  return {
    scope, currentQ: curQ(r), hints: true, invalid: ui.invalid[r.id], editProposal: ui.editProposal[r.id],
    panel: ui.panel[r.id], panelText: ui.panelText[r.id], redirectError: ui.redirectError[r.id],
    notesOpen: ui.notesOpen[r.id], status: ui.status[r.id], ...extra,
  };
}
function focusSoon(selector) { pendingFocus = selector; }
function scrollSoon(selector) { pendingScroll = selector; }
function nextAfter(id, list) {
  const i = list.findIndex((r) => r.id === id);
  return list[(i + 1) % list.length] ?? null;
}
function setVariant(key) {
  ui.variant = key;
  const p = new URLSearchParams(location.search);
  p.set('variant', key);
  history.replaceState(null, '', `?${p}`);
  hub.state.events.unshift({ at: state.now, text: `Variant → ${key}` });
  if (key === 'feed' && ui.openId) scrollSoon(`#feed-item-${ui.openId}`);
  render();
}
function setView(view) {
  ui.view = view;
  const p = new URLSearchParams(location.search);
  if (view === 'triage') p.delete('view'); else p.set('view', view);
  history.replaceState(null, '', `?${p}`);
  render();
  focusSoon('#main h1');
}
function confirmation(text, tone = 'answered') {
  ui.confirm = { text, tone, key: Date.now() };
}
async function copy(text, key) {
  try {
    await navigator.clipboard.writeText(text);
    ui.copied[key] = 'Copied to the clipboard';
  } catch {
    ui.copied[key] = 'Copy blocked by the browser · select the text instead';
  }
  render();
  setTimeout(() => { delete ui.copied[key]; render(); }, 2500);
}

// ---------- Shell ----------

function appBar() {
  const n = pending().length;
  return `<header class="hh-app-bar">
    <span class="hh-app-bar-brand">Hermes Hub · studio-mac</span>
    <span class="hh-live-value" data-live="true">Pending · ${n}</span>
    <span class="hh-app-bar-spacer"></span>
    <span class="hh-connection" data-state="live"><span class="hh-connection-lamp" aria-hidden="true"></span><span>Live</span><span class="hh-connection-detail">since ${hhmm(state.t0)} · 127.0.0.1:4747</span></span>
    <button type="button" class="hh-button" data-variant="ghost" data-size="sm" data-action="keys" aria-keyshortcuts="?">Keys <kbd class="hh-kbd" aria-hidden="true">?</kbd></button>
  </header>`;
}

function sideNav() {
  const n = pending().length;
  const items = [
    ['triage', 'Triage', `${n}`, `Triage, ${n} pending`],
    ['log', 'Answered log', `${endedRounds().length}`, 'Answered log'],
    ['agents', 'Agents', `${state.sessions.filter((s) => !s.forgotten).length}`, 'Agents'],
    ['settings', 'Settings', '', 'Settings'],
  ];
  return `<nav class="hh-side-nav proto-nav" aria-label="Command Center">${items.map(([v, label, count, aria]) =>
    `<a href="?variant=${ui.variant}${v === 'triage' ? '' : `&view=${v}`}" data-action="nav" data-view="${v}" aria-label="${aria}" ${ui.view === v ? 'aria-current="page"' : ''}>${label}${count ? `<span class="hh-side-nav-count">${count}</span>` : ''}</a>`).join('')}</nav>`;
}

function statusLine() {
  return `<div class="hh-bay-status" role="status">${ui.confirm ? `<div class="hh-toast" data-placement="inline" data-key="confirm-${ui.confirm.key}"><span class="hh-badge" data-tone="${ui.confirm.tone}">${ui.confirm.tone === 'answered' ? 'Sent' : 'Ended'}</span><span class="hh-body-sm">${esc(ui.confirm.text)}</span><button type="button" class="hh-button" data-variant="ghost" data-size="sm" data-action="confirm-close">Dismiss</button></div>` : ''}<span class="hh-visually-hidden">${esc(ui.announce)}</span></div>`;
}

// ---------- Variant 1: Strip Bay ----------

function bay() {
  const list = pending();
  const scope = ui.variant;
  if (ui.openId && !roundById(ui.openId)) ui.openId = list[0]?.id ?? null;
  const open = ui.openId ? roundById(ui.openId) : null;
  const active = list.some((r) => r.id === ui.bayActive) ? ui.bayActive : list.some((r) => r.id === ui.openId) ? ui.openId : list[0]?.id;
  return `<h1 class="hh-visually-hidden">Triage · ${scope === 'bay' ? 'Strip Bay' : 'Bay, page scroll'}</h1>${statusLine()}
  <div class="hh-command" data-view="round"><div class="hh-command-grid">
    <section class="hh-strip-bay" aria-label="Pending Rounds">
      <div class="hh-strip-bay-head"><h2 class="hh-heading-md">Pending</h2><span class="hh-live-value" data-live="true">${list.length} pending</span><span class="hh-body-sm">Arrival order</span></div>
      ${list.length ? `<ul class="hh-strip-bay-list" data-density="compact" role="listbox" aria-label="Pending Rounds" aria-keyshortcuts="J K ArrowDown ArrowUp Home End Enter" data-list="bay">
        ${list.map((r) => strip(r, { selected: r.id === ui.openId, tabIndex: r.id === active ? 0 : -1 })).join('')}</ul>`
        : `<div class="hh-strip-bay-empty"><div class="hh-empty-state">${icon('bay')}<p class="hh-heading-md">Bay clear</p><p class="hh-body-sm">No pending Rounds. Agents ask through the Hub Skill.</p></div></div>`}
      <ul class="hh-kbd-hints" aria-label="Keyboard shortcuts">
        <li><kbd class="hh-kbd">J</kbd>/<kbd class="hh-kbd">K</kbd><span>next / previous strip</span></li><li><kbd class="hh-kbd">Enter</kbd><span>open</span></li>
        <li><kbd class="hh-kbd">1–9</kbd><span>choose</span></li><li><kbd class="hh-kbd">A</kbd>/<kbd class="hh-kbd">R</kbd><span>approve / reject</span></li>
        <li><kbd class="hh-kbd">N</kbd><span>notes</span></li><li><kbd class="hh-kbd">Esc</kbd><span>back to bay</span></li><li><kbd class="hh-kbd">⌘↵</kbd><span>send</span></li></ul>
    </section>
    <div class="hh-command-panel">${open ? roundForm(open, ctxFor(open, scope, { back: { label: 'Back to pending', action: 'back' } }))
      : `<div class="hh-empty-state">${icon('bay')}<p class="hh-heading-md">No Round open</p><p class="hh-body-sm">${list.length ? 'Pick a strip, or press J.' : 'Nothing is waiting for you.'}</p></div>`}</div>
  </div></div>`;
}

// ---------- Variant: Feed ----------

function feed() {
  const list = pending();
  // Rounds that ended by policy or by their Agent while in the feed stay (ended, read-only) until the Human removes them.
  const shown = state.rounds
    .filter((r) => r.status === 'pending' || (ui.feedShown.has(r.id) && ['expired', 'cancelled'].includes(r.status) && !ui.feedCleared.has(r.id)))
    .sort((a, b) => a.order - b.order || (a.status === 'pending') - (b.status === 'pending'));
  ui.feedShown = new Set(shown.map((r) => r.id));
  if (!shown.some((r) => r.id === ui.openId)) ui.openId = list[0]?.id ?? shown[0]?.id ?? null;
  const index = `<nav class="proto-feed-index x-add" aria-label="Rounds in the feed">
    <div class="hh-strip-bay-head"><h2 class="hh-heading-md">Pending</h2><span class="hh-live-value" data-live="true">${list.length}</span></div>
    <ol class="proto-feed-list">${shown.map((r) => {
      const soon = lockSoon(r);
      const t = hub.timerReadout(r);
      return `<li data-key="fi-${r.id}"><button type="button" class="proto-feed-link" data-action="feed-goto" data-round="${r.id}" ${r.id === ui.openId ? 'aria-current="true"' : ''} ${soon ? 'data-lock-soon="true"' : ''} data-status="${r.status}">
        ${chip(r.sessionId)}<span class="proto-feed-title">${esc(r.title)}</span>${r.id === ui.openId ? '<span class="hh-mono-sm">▸ In view</span>' : ''}
        <span class="hh-mono-sm">${r.status === 'pending' ? esc(t.left == null ? 'No deadline' : `${hub.mmss(t.left)} to next Lock`) : esc(r.status[0].toUpperCase() + r.status.slice(1))}</span>${soon ? lockSoonBadge() : ''}</button></li>`;
    }).join('')}</ol>
    <ul class="hh-kbd-hints" aria-label="Keyboard shortcuts"><li><kbd class="hh-kbd">J</kbd>/<kbd class="hh-kbd">K</kbd><span>next / previous Round</span></li><li><kbd class="hh-kbd">1–9</kbd><span>choose</span></li><li><kbd class="hh-kbd">A</kbd>/<kbd class="hh-kbd">R</kbd></li><li><kbd class="hh-kbd">⌘↵</kbd><span>send the Round in view</span></li></ul>
  </nav>`;
  const items = shown.map((r) => `<section class="proto-feed-item" data-key="feed-${r.id}" id="feed-item-${r.id}" data-round="${r.id}" ${r.id === ui.openId ? 'data-in-view="true"' : ''} aria-label="${esc(r.title)}">
    ${roundForm(r, ctxFor(r, 'feed', { currentQ: r.id === ui.openId ? curQ(r) : -1, nextAction: 'feed-clear', nextLabel: 'Remove from feed' }))}</section>`).join('');
  return `<h1 class="hh-visually-hidden">Triage · Feed</h1>${statusLine()}
  <div class="proto-feed-wrap">${index}<div class="proto-feed">${items || `<div class="hh-empty-state">${icon('bay')}<p class="hh-heading-md">Feed clear</p><p class="hh-body-sm">No pending Rounds. New ones join the end of the feed.</p></div>`}</div></div>`;
}

// ---------- Variant 2: Focus Queue ----------

function focus() {
  const list = pending();
  let r = ui.openId ? roundById(ui.openId) : null;
  if (!r) { r = list[0] ?? null; ui.openId = r?.id ?? null; }
  const pos = r ? list.findIndex((x) => x.id === r.id) : -1;
  const upcoming = pos >= 0 ? [...list.slice(pos + 1), ...list.slice(0, pos)] : list;
  const head = `<div class="proto-queue x-add" role="group" aria-label="Queue">
    <span class="proto-queue-count"><span class="hh-live-value" data-live="true">${list.length} pending</span>${pos >= 0 ? `<span class="hh-mono-sm">Now ${pos + 1} of ${list.length}</span>` : ''}</span>
    <span class="proto-queue-next"><span class="hh-label">Next</span>${upcoming.slice(0, 4).map((x) => `<button type="button" class="proto-next" data-action="open" data-round="${x.id}" title="${esc(x.title)}">${chip(x.sessionId)}<span class="hh-mono-sm">${esc(hub.timerReadout(x).left == null ? 'waits' : hub.mmss(hub.timerReadout(x).left))}</span>${lockSoon(x) ? lockSoonBadge() : ''}</button>`).join('')}${upcoming.length > 4 ? `<span class="hh-mono-sm">+${upcoming.length - 4} more</span>` : ''}${upcoming.length === 0 ? '<span class="hh-body-sm">Nothing after this one</span>' : ''}</span>
    <ul class="hh-kbd-hints" aria-label="Keyboard shortcuts"><li><kbd class="hh-kbd">1–9</kbd><span>choose</span></li><li><kbd class="hh-kbd">A</kbd>/<kbd class="hh-kbd">R</kbd></li><li><kbd class="hh-kbd">J</kbd>/<kbd class="hh-kbd">K</kbd><span>Question</span></li><li><kbd class="hh-kbd">⌘↵</kbd><span>send + next</span></li><li><kbd class="hh-kbd">S</kbd><span>skip</span></li><li><kbd class="hh-kbd">D</kbd><span>dismiss</span></li><li><kbd class="hh-kbd">E</kbd><span>redirect</span></li></ul>
  </div>`;
  if (!r) {
    return `<h1 class="hh-visually-hidden">Triage · Focus Queue</h1>${statusLine()}${head}<div class="hh-empty-state proto-focus-empty">${icon('bay')}<p class="hh-heading-md">Queue clear</p><p class="hh-body-sm">No pending Rounds. New ones appear here on their own.</p></div>`;
  }
  const ended = r.status !== 'pending';
  return `<h1 class="hh-visually-hidden">Triage · Focus Queue</h1>${statusLine()}${head}
    <div class="proto-focus">${ended ? '' : `<div class="proto-focus-timer" aria-hidden="true">${timer(r)}</div>`}
    ${roundForm(r, ctxFor(r, 'focus', {
      nextAction: 'next', nextLabel: `Next Round ${icon('arrow-right')}`,
      extraActions: ended ? '' : `<button type="button" class="hh-button" data-variant="ghost" data-size="sm" data-action="skip" ${list.length < 2 ? 'aria-disabled="true"' : ''}>Skip for now <kbd class="hh-kbd" aria-hidden="true">S</kbd></button>`,
    }))}</div>`;
}

// ---------- Variant 3: Agent Lanes ----------

function lanes() {
  const list = pending();
  const sessions = state.sessions.filter((s) => !s.forgotten).map((s) => ({ s, rounds: list.filter((r) => r.sessionId === s.id), st: liveness(s) }));
  const rank = { Live: 0, Idle: 1, Gone: 2 };
  sessions.sort((a, b) => rank[a.st] - rank[b.st]);
  const open = ui.drawerOpen && ui.openId ? roundById(ui.openId) : null;
  const lane = ({ s, rounds, st }) => `<section class="proto-lane" data-key="lane-${s.id}" data-state="${st}" aria-labelledby="lane-${s.id}">
    <header class="proto-lane-head"><h2 id="lane-${s.id}" class="proto-lane-title">${chip(s.id)}</h2>${stateWord(s)}
      <span class="hh-mono-sm">${rounds.length} pending · seen ${hub.ago(s.lastSeenAt)}</span>
      <span class="hh-mono-sm hh-muted">${esc(s.git.branch)}</span></header>
    ${st === 'Gone' && rounds.length ? '<p class="hh-body-sm">Gone · Answers are kept for its next poll</p>' : ''}
    ${rounds.length ? `<ul class="hh-strip-bay-list proto-lane-list" data-density="compact" aria-label="Pending Rounds from ${esc(callsign(s))}">${rounds.map((r) => strip(r, { mode: 'button', selected: open?.id === r.id, goneNote: false })).join('')}</ul>`
      : '<div class="hh-strip-bay-slot proto-lane-empty"><span class="hh-body-sm">No pending Rounds</span></div>'}
  </section>`;
  return `<h1 class="hh-visually-hidden">Triage · Agent Lanes</h1>${statusLine()}
  <div class="proto-lanes-wrap" data-drawer="${open ? 'open' : 'closed'}">
    <div class="proto-lanes x-add"><div class="proto-lanes-head"><h2 class="hh-heading-md">Agents · ${sessions.length}</h2><span class="hh-live-value" data-live="true">${list.length} pending</span><span class="hh-body-sm">One lane per Agent session · Live first</span></div>
      <div class="proto-lane-grid">${sessions.map(lane).join('')}</div></div>
    ${open ? `<aside class="proto-drawer" data-key="drawer" aria-label="Open Round">${roundForm(open, ctxFor(open, 'lanes', { back: { label: 'Close', action: 'close-drawer' } }))}</aside>` : ''}
  </div>`;
}

// ---------- Shared views ----------

function setByWords(q, a) {
  if (!a) return '';
  if (a.set_by === 'policy') return a.value ? 'Policy: applied recommended' : 'Policy: cancelled';
  if (a.set_by === 'none') return 'Not set';
  return `You${a.suggested_by ? ` · suggested by ${a.suggested_by}` : ''}`;
}

function logView() {
  const rows = endedRounds();
  const tone = (st) => (['answered', 'dismissed', 'redirected'].includes(st) ? 'answered' : 'expired');
  return `<h1 class="hh-heading-lg" tabindex="-1">Answered log · ${rows.length}</h1>
  <p class="hh-body-sm">Every Round that left the bay: answered, dismissed, redirected, expired or cancelled. Newest first.</p>
  <div class="hh-answered-log hh-table-wrap" data-density="compact" role="region" aria-label="Answered log" tabindex="0"><table class="hh-table">
    <thead><tr><th scope="col">Time</th><th scope="col">Round</th><th scope="col">Agent</th><th scope="col">Outcome</th><th scope="col">Answer</th><th scope="col">Delivery</th></tr></thead>
    <tbody>${rows.map((r) => {
      const a = r.answer;
      const open = ui.logOpen[r.id];
      const answers = r.questions.map((q, i) => {
        const qa = a?.questions?.[q.id];
        return `<li><span class="hh-mono-sm">Q${i + 1}</span> ${qa?.value ? esc(valueWords(q, qa.value)) : '—'} <span class="hh-muted-inline">· ${esc(setByWords(q, qa))}</span></li>`;
      }).join('');
      return `<tr data-key="log-${r.id}"><td class="hh-mono">${hhmmss(r.decidedAt)}</td>
        <td><span class="hh-mono-sm">${r.id}</span> ${esc(r.title)}<br><button type="button" class="hh-button" data-variant="ghost" data-size="sm" data-action="log-toggle" data-round="${r.id}" aria-expanded="${!!open}">${open ? 'Hide details' : 'Details'}</button></td>
        <td>${chip(r.sessionId)}</td>
        <td><span class="hh-badge" data-tone="${tone(r.status)}">${r.status[0].toUpperCase() + r.status.slice(1)}</span><br><span class="hh-body-sm">${esc(hub.outcomeWords(r))}</span></td>
        <td><ul class="proto-answers">${answers}</ul>${a?.message ? `<p class="hh-body-sm">Redirect: “${esc(a.message)}”</p>` : ''}${a?.note ? `<p class="hh-body-sm">Note: “${esc(a.note)}”</p>` : ''}
          ${r.notSent ? `<p class="hh-body-sm"><span class="hh-badge" data-tone="expired">Not sent</span> your draft is kept · <button type="button" class="hh-button" data-variant="ghost" data-size="sm" data-action="copy-draft" data-round="${r.id}">Copy draft</button></p>` : ''}${ui.copied[`draft-${r.id}`] ? `<p class="hh-body-sm" role="status">${ui.copied[`draft-${r.id}`]}</p>` : ''}</td>
        <td>${r.deliveredAt ? `<span class="hh-body-sm">Delivered ${hhmm(r.deliveredAt)}</span>` : '<span class="hh-badge x-add" data-tone="warning">Not picked up</span>'}</td></tr>
        ${open ? `<tr data-key="logd-${r.id}"><td></td><td colspan="5"><div class="proto-log-detail"><div><p class="hh-label">History</p><ul class="proto-history">${r.history.map((h) => `<li><span class="hh-mono-sm">${hhmmss(h.at)}</span> ${esc(h.text)}</li>`).join('')}</ul>
          ${r.runs.length ? `<p class="hh-label">Advisor runs</p><ul class="proto-history">${r.runs.map((x) => `<li>${esc(x.advisor)} · ${x.trigger === 'rule' ? 'auto-ask rule' : 'manual'} · ${x.status}${x.brief ? ` · brief “${esc(x.brief)}”` : ''}</li>`).join('')}</ul>` : ''}
          ${r.notSent ? `<p class="hh-label">Not sent draft</p><pre class="proto-briefing">${esc(r.notSent)}</pre>` : ''}</div>
          <div><p class="hh-label">Answer document</p><pre class="proto-briefing">${esc(JSON.stringify(a, null, 2))}</pre></div></div></td></tr>` : ''}`;
    }).join('')}</tbody></table></div>`;
}

function agentsView() {
  const sessions = state.sessions.filter((s) => !s.forgotten);
  const client = { 'claude-code': 'Claude Code', codex: 'Codex CLI', 'cursor-ide': 'Cursor (IDE)', omp: 'omp', 'vscode-copilot': 'VS Code Copilot' };
  return `<h1 class="hh-heading-lg" tabindex="-1">Agents · ${sessions.length}</h1>
  <p class="hh-body-sm">Agent sessions the Hub has seen. Live: open wait or seen in the last 2 min · Idle: within 30 min · Gone: longer. Liveness never changes a Round.</p>
  <ul class="hh-agent-roster" aria-label="Agents · ${sessions.length}">${sessions.map((s) => {
    const n = pending().filter((r) => r.sessionId === s.id).length;
    const open = ui.agentOpen[s.id];
    const cs = callsign(s);
    const suffixed = cs.split('·').length > 2;
    return `<li class="hh-agent-card" data-key="agent-${s.id}"><div class="hh-agent-card-head">${chip(s.id)}<span class="hh-agent-state">${stateWord(s)}</span></div>
      <dl class="hh-dl"><dt>Client</dt><dd>${client[s.kind] ?? s.kind}</dd><dt>Pending</dt><dd class="hh-mono">${n}</dd>
        <dt>Session</dt><dd class="hh-mono-sm">${esc(s.key.slice(0, 8))}</dd><dt>Where</dt><dd class="hh-mono-sm">${esc(s.host)} · ${esc(s.cwd)} · ${esc(s.git.branch)}</dd>
        <dt>Last seen</dt><dd class="hh-mono-sm">${hub.ago(s.lastSeenAt)}</dd></dl>
      <div class="hh-row"><button type="button" class="hh-button" data-size="sm" data-action="agent-toggle" data-session="${s.id}" aria-expanded="${!!open}">Detection details</button>
        <button type="button" class="hh-button x-add" data-size="sm" data-variant="destructive" data-action="forget" data-session="${s.id}">Forget Agent</button></div>
      ${ui.forget === s.id ? `<div class="hh-alert x-add" data-tone="destructive" role="alertdialog" aria-label="Forget ${esc(cs)}"><span class="hh-badge" data-tone="destructive">Forget</span>
        <p class="hh-body-sm">Forget ${esc(cs)}? Its ${n} pending Round${n === 1 ? '' : 's'} become cancelled (by you) and stay in the log. It reappears when it next contacts the Hub.</p>
        <div class="hh-row"><button type="button" class="hh-button" data-variant="destructive" data-size="sm" data-action="forget-confirm" data-session="${s.id}">Forget ${esc(cs)}</button><button type="button" class="hh-button" data-size="sm" data-variant="ghost" data-action="forget-cancel">Keep</button></div></div>` : ''}
      ${open ? `<dl class="hh-dl proto-detect">
        <dt>Label</dt><dd>${esc(s.label)} · ${s.declared ? 'Declared by the Agent' : 'From the working directory'}${suffixed ? ` · suffix ·${esc(s.key.slice(0, 4))} shown because another Live/Idle session is also ${esc(`${s.KIND}·${s.label}`)}` : ''}</dd>
        <dt>Client kind</dt><dd>${client[s.kind] ?? s.kind} ${s.version} · from <code>${esc(s.detection.source)}</code> (step ${s.detection.step}) <span class="hh-badge" data-tone="${s.detection.documented ? 'success' : 'warning'}">${s.detection.documented ? 'Documented signal' : 'Undocumented signal'}</span>${s.detection.documented ? '' : '<br><span class="hh-body-sm">The client does not document this marker; the kind may be wrong if another client sets it.</span>'}</dd>
        <dt>Session id</dt><dd><code>${esc(s.key)}</code> <button type="button" class="hh-button" data-variant="ghost" data-size="sm" data-action="copy" data-text="${esc(s.key)}" data-key="sid-${s.id}">Copy</button></dd>
        <dt>Resume handle</dt><dd>${s.resume ? `<code>${esc(s.resume)}</code> <button type="button" class="hh-button" data-variant="ghost" data-size="sm" data-action="copy" data-text="${esc(s.resume)}" data-key="res-${s.id}">Copy</button>` : 'None for this client'}</dd>
        <dt>Working dir and git</dt><dd class="hh-mono-sm">${esc(s.cwd)} · root ${esc(s.git.root)} · ${esc(s.git.branch)} @ ${esc(s.git.head)}</dd>
        <dt>Host</dt><dd>${esc(s.host)} (local)</dd></dl>${['sid', 'res'].map((k) => ui.copied[`${k}-${s.id}`] ? `<p class="hh-body-sm" role="status">${ui.copied[`${k}-${s.id}`]}</p>` : '').join('')}` : ''}
    </li>`;
  }).join('')}</ul>
  ${state.sessions.some((s) => s.forgotten) ? `<p class="hh-body-sm">Forgotten: ${state.sessions.filter((s) => s.forgotten).map((s) => esc(callsign(s))).join(', ')} · hidden until they next contact the Hub.</p>` : ''}`;
}

function settingsView() {
  return `<h1 class="hh-heading-lg" tabindex="-1">Settings</h1>
  <section class="hh-panel proto-settings x-add"><h2 class="hh-heading-md">Advisors</h2><p class="hh-body-sm">One-off runs that suggest an Answer. Read-only is set through each CLI’s own flags; the Hub cannot enforce it.</p>
    <table class="hh-table" data-density="compact"><thead><tr><th scope="col">Name</th><th scope="col">Command (argument list)</th><th scope="col">Timeout</th></tr></thead>
    <tbody>${state.advisors.map((a) => `<tr><td>${esc(a.name)}</td><td><code>${esc(JSON.stringify(a.command))}</code></td><td class="hh-mono">${a.timeout} s</td></tr>`).join('')}</tbody></table></section>
  <section class="hh-panel proto-settings x-add"><h2 class="hh-heading-md">Auto-ask rules</h2><p class="hh-body-sm">Start an Advisor as soon as a matching Round arrives. Matches on kind + project (git root); a label narrows it. Off unless you add one.</p>
    <table class="hh-table" data-density="compact"><thead><tr><th scope="col">Kind</th><th scope="col">Project</th><th scope="col">Label</th><th scope="col">Advisor</th><th scope="col">Standing brief</th></tr></thead>
    <tbody>${state.autoAsk.map((x) => `<tr><td><code>${x.kind}</code></td><td class="hh-mono-sm">${esc(x.project)}</td><td>${x.label ?? 'any'}</td><td>${esc(state.advisors.find((a) => a.id === x.advisor).name)}</td><td>${esc(x.brief ?? '')}</td></tr>`).join('')}</tbody></table></section>
  <section class="hh-panel proto-settings"><h2 class="hh-heading-md">Notifications</h2>
    <button type="button" role="switch" aria-checked="${state.notifications}" class="hh-switch" data-action="toggle-notify"><span class="hh-switch-track" aria-hidden="true"><span class="hh-switch-thumb"></span></span><span class="hh-body-sm">Browser notifications ${state.notifications ? 'on' : 'off'} (mock: shown as in-page toasts marked “would notify”)</span></button>
    <p class="hh-body-sm">Fires on: a new Round, a Lock 15 s away, an Advisor Suggestion ready.</p></section>`;
}

// ---------- Prototype chrome (not part of the design) ----------

function switcher() {
  const i = VARIANTS.findIndex((v) => v.key === ui.variant);
  const v = VARIANTS[i];
  return `<div class="proto-switcher" role="group" aria-label="Prototype variant switcher">
    <button type="button" data-action="variant-prev" aria-label="Previous variant">←</button>
    <span><strong>${v.key}</strong> (${v.name}) · ${i + 1}/${VARIANTS.length}</span>
    <button type="button" data-action="variant-next" aria-label="Next variant">→</button></div>`;
}

function statePanel() {
  const last = state.events[0];
  return `<aside class="proto-state" aria-label="Prototype state">
    <div class="proto-state-row"><button type="button" class="proto-state-toggle" data-action="state-toggle" aria-expanded="${ui.stateOpen}">Prototype state ${ui.stateOpen ? '▴' : '▾'}</button><span>${hhmmss(state.now)} ×${state.speed}${state.paused ? ' paused' : ''}</span>
      <button type="button" data-action="pause">${state.paused ? 'Resume' : 'Pause'}</button>
      <button type="button" data-action="speed" data-speed="1" aria-pressed="${state.speed === 1}">×1</button>
      <button type="button" data-action="speed" data-speed="5" aria-pressed="${state.speed === 5}">×5</button>
      <button type="button" data-action="jump">+15 s</button></div>
    <div class="proto-state-row proto-last">Last: ${last ? `${hhmmss(last.at)} ${esc(last.text)}` : '—'}</div>
    ${ui.stateOpen ? `<label class="proto-state-row"><input type="checkbox" data-action="outline" ${ui.outline ? 'checked' : ''}> Outline design additions</label>
      <ol class="proto-events">${state.events.slice(0, 8).map((e) => `<li>${hhmmss(e.at)} ${esc(e.text)}</li>`).join('')}</ol>
      <pre class="proto-json">${esc(JSON.stringify({ ui: { variant: ui.variant, view: ui.view, openId: ui.openId, drawerOpen: ui.drawerOpen }, ...hub.snapshot() }, null, 1))}</pre>` : ''}
  </aside>`;
}

function toasts() {
  return `<div class="hh-toast-region proto-toasts" aria-live="polite">${ui.toasts.map((t) => `<div class="hh-toast" data-key="toast-${t.id}">
    <span class="hh-badge x-add" data-tone="${t.kind === 'lock' ? 'warning' : 'info'}">(would notify)</span><span class="hh-body-sm">${esc(t.text)}</span>
    ${t.roundId && roundById(t.roundId)?.status === 'pending' ? `<button type="button" class="hh-button" data-size="sm" data-action="toast-open" data-round="${t.roundId}">Open</button>` : ''}
    <button type="button" class="hh-button" data-variant="ghost" data-size="sm" data-action="toast-close" data-toast="${t.id}">Dismiss</button></div>`).join('')}</div>`;
}

function keysDialog() {
  if (!ui.keysOpen) return '';
  const rows = {
    bay: [['J / K', 'move in the bay'], ['Enter', 'open the Round'], ['Esc', 'back to the bay']],
    'bay-page': [['J / K', 'move in the bay'], ['Enter', 'open the Round (the page scrolls to it)'], ['Esc', 'back to the bay']],
    feed: [['J / K', 'next / previous Round in the feed'], ['⌘↵', 'send the Round in view, then the next one scrolls in']],
    focus: [['J / K', 'next / previous Question'], ['S', 'skip to the next Round'], ['⌘↵', 'send, then the next Round opens']],
    lanes: [['Tab', 'move between strips'], ['Enter', 'open in the drawer'], ['Esc', 'close the drawer']],
  }[ui.variant];
  const common = [['1–9', 'choose an option on the current Question'], ['A / R', 'approve / reject (approve/reject Questions only)'], ['N', 'notes'], ['D', 'dismiss…'], ['E', 'redirect…'], ['⌘↵', 'send the Answer'], ['← / →', 'switch prototype variant']];
  return `<div class="proto-scrim" data-action="keys-close"></div><dialog class="hh-dialog proto-dialog" open aria-label="Keyboard shortcuts"><div class="hh-overlay-head"><h2 class="hh-heading-md">Keys · ${VARIANTS.find((v) => v.key === ui.variant).name}</h2></div>
    <div class="hh-overlay-body"><ul class="proto-keylist">${[...rows, ...common].map(([k, a]) => `<li><kbd class="hh-kbd">${k}</kbd> ${a}</li>`).join('')}</ul></div>
    <div class="hh-overlay-foot"><button type="button" class="hh-button" data-action="keys-close">Close</button></div></dialog>`;
}

// ---------- Render ----------

function render() {
  const main = ui.view === 'triage' ? { bay, 'bay-page': bay, feed, focus, lanes }[ui.variant]() : { log: logView, agents: agentsView, settings: settingsView }[ui.view]();
  document.documentElement.toggleAttribute('data-outline', ui.outline);
  document.title = `(${pending().length}) ${ui.view === 'triage' ? 'Triage' : ui.view[0].toUpperCase() + ui.view.slice(1)} · Hermes Hub · ${ui.variant}`;
  patch(root, `<a class="hh-skip-link" href="#main">Skip to ${ui.view === 'triage' ? 'triage' : 'content'}</a>${appBar()}
    <div class="proto-shell" data-variant="${ui.variant}"><div class="proto-nav-wrap">${sideNav()}</div><main id="main" class="proto-main" data-view="${ui.view}">${main}</main></div>
    ${toasts()}${keysDialog()}${statePanel()}${switcher()}`);
  const scrollTo = pendingScroll ? document.querySelector(pendingScroll) : null;
  pendingScroll = null;
  if (pendingFocus) {
    const el = document.querySelector(pendingFocus);
    pendingFocus = null;
    el?.focus({ preventScroll: !!scrollTo });
  }
  if (scrollTo) {
    ignoreScrollUntil = performance.now() + 300;
    scrollTo.scrollIntoView({ block: 'start' });
  }
}

// Feed: the Round whose head is nearest the top of the viewport is "in view"; keys act on it and the index marks it.
let ignoreScrollUntil = 0;
let scrollRaf = 0;
window.addEventListener('scroll', () => {
  if (ui.view !== 'triage' || ui.variant !== 'feed' || scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (performance.now() < ignoreScrollUntil) return;
    const items = [...document.querySelectorAll('.proto-feed-item')];
    let cur = items[0];
    for (const it of items) if (it.getBoundingClientRect().top <= 140) cur = it;
    if (cur && cur.dataset.round !== ui.openId) { ui.openId = cur.dataset.round; render(); }
  });
}, { passive: true });

// ---------- Actions ----------

function afterTerminal(prevList, id) {
  // The next pending Round in arrival order opens automatically, in every variant.
  const idx = prevList.findIndex((r) => r.id === id);
  const now = pending();
  const next = now[idx] ?? now[0] ?? null;
  ui.openId = next?.id ?? null;
  if (isBay()) {
    ui.bayActive = next?.id ?? null;
    focusSoon(next ? `.hh-strip[data-round="${next.id}"]` : '.hh-strip-bay');
    if (ui.variant === 'bay-page' && next) scrollSoon(`[data-key="round-bay-page-${next.id}"]`);
  } else if (ui.variant === 'focus') {
    focusSoon(next ? `#focus-${next.id}-title` : '#main');
  } else if (ui.variant === 'feed') {
    if (next) { scrollSoon(`#feed-item-${next.id}`); focusSoon(`#feed-${next.id}-title`); }
  } else {
    ui.drawerOpen = !!next;
    focusSoon(next ? `#lanes-${next.id}-title` : '.proto-lanes');
  }
}

function send(id) {
  const prev = pending();
  const r = roundById(id);
  const res = hub.sendAnswer(id);
  if (!res.ok) {
    ui.invalid[id] = res.missing;
    const q = res.missing[0];
    if (q) {
      ui.currentQ[id] = r.questions.findIndex((x) => x.id === q);
      focusSoon(`[data-key="q-${id}-${q}"] input:not([disabled]), [data-key="q-${id}-${q}"] textarea`);
    }
    render();
    return;
  }
  delete ui.invalid[id];
  confirmation(`Answer sent · ${callsign(sessionById(r.sessionId))} · ${r.title}`);
  afterTerminal(prev, id);
  render();
}

function openRound(id, moveFocus) {
  ui.openId = id;
  ui.bayActive = id;
  if (ui.variant === 'lanes') ui.drawerOpen = true;
  if (ui.view !== 'triage') ui.view = 'triage';
  if (ui.variant === 'feed') { scrollSoon(`#feed-item-${id}`); moveFocus = true; }
  if (ui.variant === 'bay-page') scrollSoon(`[data-key="round-bay-page-${id}"]`);
  if (moveFocus) focusSoon(`#${ui.variant}-${id}-title`);
  render();
}

function pick(r, n) {
  const qi = curQ(r);
  const q = r.questions[qi];
  if (!q || !isOpenQ(q)) return;
  if (q.kind === 'single' && q.options[n - 1]) hub.setValue(r.id, q.id, { selected: q.options[n - 1].id });
  else if (q.kind === 'multi' && q.options[n - 1]) {
    const cur = r.draft.values[q.id]?.selected ?? [];
    const id = q.options[n - 1].id;
    hub.setValue(r.id, q.id, { selected: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    return;
  } else if (q.kind === 'approve' && (n === 1 || n === 2)) hub.setValue(r.id, q.id, { decision: n === 1 ? 'approve' : 'reject' });
  else return;
  if (ui.variant === 'focus') advanceQ(r, qi);
}
function advanceQ(r, from) {
  const next = r.questions.findIndex((q, i) => i > from && isOpenQ(q) && !isSet(q, r.draft.values[q.id]));
  if (next >= 0) ui.currentQ[r.id] = next;
}

const actions = {
  nav: (el, e) => { e.preventDefault(); setView(el.dataset.view); },
  open: (el) => openRound(el.dataset.round, !isBay()),
  'feed-goto': (el) => openRound(el.dataset.round, true),
  'feed-clear': (el) => { ui.feedCleared.add(el.dataset.round); ui.openId = null; render(); },
  'diff-expand': (el) => { expandedRuns.add(el.dataset.run); render(); },
  back: () => {
    const list = pending();
    if (!roundById(ui.openId) || roundById(ui.openId).status !== 'pending') ui.openId = list[0]?.id ?? null;
    if (ui.variant === 'lanes') { ui.drawerOpen = false; render(); return; }
    focusSoon(ui.openId ? `.hh-strip[data-round="${ui.openId}"]` : '.hh-strip-bay');
    ui.bayActive = ui.openId;
    render();
  },
  next: () => { ui.openId = pending()[0]?.id ?? null; focusSoon(ui.openId ? `#focus-${ui.openId}-title` : '#main'); render(); },
  'close-drawer': () => { ui.drawerOpen = false; focusSoon(`.hh-strip[data-round="${ui.openId}"] .hh-strip-head`); render(); },
  skip: () => {
    const nx = nextAfter(ui.openId, pending());
    if (nx && nx.id !== ui.openId) { ui.openId = nx.id; focusSoon(`#focus-${nx.id}-title`); }
    render();
  },
  'open-replacement': (el) => openRound(el.dataset.round, true),
  panel: (el) => {
    const id = el.dataset.round;
    ui.panel[id] = ui.panel[id] === el.dataset.panel ? null : el.dataset.panel;
    delete ui.redirectError[id];
    if (ui.panel[id]) focusSoon(ui.panel[id] === 'advisor' ? `[name="adv-${id}"]` : `#${ui.panel[id]}-${id}`);
    render();
  },
  'panel-close': (el) => { ui.panel[el.dataset.round] = null; render(); },
  'dismiss-confirm': (el) => {
    const id = el.dataset.round;
    const prev = pending();
    const r = roundById(id);
    hub.dismiss(id, ui.panelText[id]?.dismiss?.trim() ?? '');
    ui.panel[id] = null;
    confirmation(`Dismissed · ${callsign(sessionById(r.sessionId))} · ${r.title}`, 'expired');
    afterTerminal(prev, id);
    render();
  },
  'redirect-confirm': (el) => {
    const id = el.dataset.round;
    const msg = ui.panelText[id]?.redirect ?? '';
    if (!msg.trim()) { ui.redirectError[id] = true; focusSoon(`#redirect-${id}`); render(); return; }
    const prev = pending();
    const r = roundById(id);
    hub.redirect(id, msg);
    ui.panel[id] = null;
    confirmation(`Redirected · ${callsign(sessionById(r.sessionId))} · “${msg.trim()}”`);
    afterTerminal(prev, id);
    render();
  },
  'advisor-start': (el) => {
    const id = el.dataset.round;
    const t = ui.panelText[id] ?? {};
    hub.askAdvisor(id, t.advisor ?? 'claude', t.brief ?? '');
    ui.panel[id] = null;
    render();
  },
  'advisor-cancel': (el) => hub.cancelAdvisor(el.dataset.round),
  'accept-offer': (el) => hub.acceptOffer(el.dataset.round, el.dataset.q),
  'proposal-edit': (el) => { (ui.editProposal[el.dataset.round] ??= {})[el.dataset.q] = true; focusSoon(`textarea[data-bind="proposal"][data-q="${el.dataset.q}"]`); render(); },
  'proposal-done': (el) => { ui.editProposal[el.dataset.round][el.dataset.q] = false; render(); },
  'proposal-reset': (el) => { delete roundById(el.dataset.round).draft.proposals[el.dataset.q]; ui.editProposal[el.dataset.round][el.dataset.q] = false; render(); },
  'use-rec': (el) => { const r = roundById(el.dataset.round); const q = r.questions.find((x) => x.id === el.dataset.q); hub.setValue(r.id, q.id, { text: q.recommended }); },
  'notes-toggle': (el, e) => { e.preventDefault(); const id = el.dataset.round; ui.notesOpen[id] = !(ui.notesOpen[id] || roundById(id).draft.notes); render(); },
  'copy-draft': (el) => { const r = roundById(el.dataset.round); copy(r.notSent ?? hub.copyDraftText(r), `draft-${r.id}`); ui.status[r.id] = 'Draft copied'; setTimeout(() => { delete ui.status[r.id]; render(); }, 2500); },
  'copy-q-draft': (el) => { const r = roundById(el.dataset.round); const q = r.questions.find((x) => x.id === el.dataset.q); copy(`${q.prompt} → ${valueWords(q, q.notSent)}`, `q-${q.id}`); ui.status[r.id] = 'Draft copied'; setTimeout(() => { delete ui.status[r.id]; render(); }, 2500); },
  copy: (el) => copy(el.dataset.text, el.dataset.key),
  'confirm-close': () => { ui.confirm = null; render(); },
  'toast-open': (el) => openRound(el.dataset.round, true),
  'toast-close': (el) => { ui.toasts = ui.toasts.filter((t) => String(t.id) !== el.dataset.toast); render(); },
  'log-toggle': (el) => { ui.logOpen[el.dataset.round] = !ui.logOpen[el.dataset.round]; render(); },
  'agent-toggle': (el) => { ui.agentOpen[el.dataset.session] = !ui.agentOpen[el.dataset.session]; render(); },
  forget: (el) => { ui.forget = el.dataset.session; render(); },
  'forget-cancel': () => { ui.forget = null; render(); },
  'forget-confirm': (el) => { hub.forgetSession(el.dataset.session); ui.forget = null; render(); },
  'toggle-notify': () => hub.toggleNotifications(),
  keys: () => { ui.keysOpen = true; render(); },
  'keys-close': () => { ui.keysOpen = false; render(); },
  'variant-prev': () => cycle(-1),
  'variant-next': () => cycle(1),
  'state-toggle': () => { ui.stateOpen = !ui.stateOpen; render(); },
  outline: () => { ui.outline = !ui.outline; render(); },
  pause: () => { hub.togglePause(); render(); },
  speed: (el) => { hub.setSpeed(Number(el.dataset.speed)); render(); },
  jump: () => { hub.jump(15); render(); },
};

function cycle(d) {
  const i = VARIANTS.findIndex((v) => v.key === ui.variant);
  setVariant(VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  actions[el.dataset.action]?.(el, e);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form="round"]');
  if (!form) return;
  e.preventDefault();
  send(form.dataset.round);
});

document.addEventListener('focusin', (e) => {
  const q = e.target.closest?.('.hh-question');
  if (q && q.dataset.round) {
    const i = Number(q.dataset.qidx);
    if (ui.currentQ[q.dataset.round] !== i) { ui.currentQ[q.dataset.round] = i; render(); }
  }
  const s = e.target.closest?.('.hh-strip[role="option"]');
  if (s) ui.bayActive = s.dataset.round;
  const f = ui.variant === 'feed' && e.target.closest?.('.proto-feed-item');
  if (f && f.dataset.round !== ui.openId) { ui.openId = f.dataset.round; render(); }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  const b = el.dataset.bind;
  if (b === 'choice') {
    const r = roundById(el.dataset.round);
    const q = r.questions.find((x) => x.id === el.dataset.q);
    const opt = el.dataset.opt;
    if (q.kind === 'single') hub.setValue(r.id, q.id, { selected: opt });
    else if (q.kind === 'multi') {
      const cur = r.draft.values[q.id]?.selected ?? [];
      hub.setValue(r.id, q.id, { selected: el.checked ? [...new Set([...cur, opt])] : cur.filter((x) => x !== opt) });
    } else hub.setValue(r.id, q.id, { decision: opt });
    delete ui.invalid[r.id];
  }
  if (b === 'panel-radio') { (ui.panelText[el.dataset.round] ??= {})[el.dataset.field] = el.dataset.value; render(); }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  const b = el.dataset.bind;
  const id = el.dataset.round;
  if (b === 'text') hub.setValue(id, el.dataset.q, { text: el.value });
  else if (b === 'notes') hub.setNotes(id, el.value);
  else if (b === 'proposal') hub.setProposal(id, el.dataset.q, el.value);
  else if (b === 'panel') (ui.panelText[id] ??= {})[el.dataset.field] = el.value;
});

// ---------- Keyboard ----------

const isTyping = (t) => t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['radio', 'checkbox', 'button'].includes(t.type));

function roundKeys(e, r) {
  if (!r) return false;
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    if (r.status === 'pending') send(r.id);
    return true;
  }
  if (r.status !== 'pending' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return false;
  const k = e.key.toLowerCase();
  if (/^[1-9]$/.test(e.key)) { e.preventDefault(); pick(r, Number(e.key)); render(); return true; }
  const q = r.questions[curQ(r)];
  if ((k === 'a' || k === 'r') && q?.kind === 'approve' && isOpenQ(q)) {
    e.preventDefault();
    hub.setValue(r.id, q.id, { decision: k === 'a' ? 'approve' : 'reject' });
    if (ui.variant === 'focus') { advanceQ(r, curQ(r)); render(); }
    return true;
  }
  if (k === 'n') { e.preventDefault(); ui.notesOpen[r.id] = true; focusSoon(`#${ui.variant}-${r.id}-notes`); render(); return true; }
  if (k === 'd' || k === 'e') { e.preventDefault(); actions.panel({ dataset: { round: r.id, panel: k === 'd' ? 'dismiss' : 'redirect' } }); return true; }
  return false;
}

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (ui.keysOpen && e.key === 'Escape') { ui.keysOpen = false; render(); return; }
  if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
    e.preventDefault();
    cycle(e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  if (e.key === '?' && !isTyping(t)) { ui.keysOpen = !ui.keysOpen; render(); return; }
  if (ui.view !== 'triage') return;
  const open = ui.openId ? roundById(ui.openId) : null;

  if (isBay()) {
    const list = t.closest?.('[data-list="bay"]');
    if (list && !e.metaKey && !e.ctrlKey) {
      const strips = [...list.querySelectorAll('.hh-strip[role="option"]')];
      const i = strips.indexOf(t.closest('.hh-strip'));
      const k = e.key;
      let to = null;
      if (k === 'j' || k === 'ArrowDown') to = strips[Math.min(strips.length - 1, i + 1)];
      else if (k === 'k' || k === 'ArrowUp') to = strips[Math.max(0, i - 1)];
      else if (k === 'Home') to = strips[0];
      else if (k === 'End') to = strips.at(-1);
      else if (k === 'Enter' && i >= 0) { e.preventDefault(); openRound(strips[i].dataset.round, true); return; }
      if (to) { e.preventDefault(); ui.bayActive = to.dataset.round; render(); to.focus(); }
      return;
    }
    if (t.closest?.('[data-form="round"]') || t === document.body) {
      if (e.key === 'Escape' && !isTyping(t)) { e.preventDefault(); actions.back(); return; }
      roundKeys(e, open);
    } else if (!isTyping(t) && (e.key === 'j' || e.key === 'k')) {
      focusSoon(`.hh-strip[data-round="${ui.bayActive ?? ui.openId}"]`); render();
    }
    return;
  }

  if (ui.variant === 'focus') {
    if (!open) return;
    if (roundKeys(e, open)) return;
    if (isTyping(t) || e.metaKey || e.ctrlKey || e.altKey) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); actions.skip(); }
    else if (k === 'enter' && open.status !== 'pending') { e.preventDefault(); actions.next(); }
    else if ((k === 'j' || k === 'k') && open.status === 'pending') {
      e.preventDefault();
      const openIdx = open.questions.map((q, i) => (isOpenQ(q) ? i : -1)).filter((i) => i >= 0);
      const at = openIdx.indexOf(curQ(open));
      const nx = openIdx[Math.max(0, Math.min(openIdx.length - 1, at + (k === 'j' ? 1 : -1)))];
      ui.currentQ[open.id] = nx;
      render();
      document.querySelector(`[data-key="q-${open.id}-${open.questions[nx].id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    return;
  }

  if (ui.variant === 'feed') {
    const inRound = t.closest?.('.proto-feed-item');
    const r = inRound ? roundById(inRound.dataset.round) : open;
    if (roundKeys(e, r)) return;
    if (isTyping(t) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault();
      const ids = [...document.querySelectorAll('.proto-feed-item')].map((x) => x.dataset.round);
      const at = ids.indexOf(ui.openId);
      const to = ids[Math.max(0, Math.min(ids.length - 1, at + (e.key === 'j' ? 1 : -1)))];
      if (to) openRound(to, true);
    }
    return;
  }

  if (ui.variant === 'lanes') {
    if (e.key === 'Escape' && ui.drawerOpen && !isTyping(t)) { e.preventDefault(); actions['close-drawer'](); return; }
    if (ui.drawerOpen && t.closest?.('.proto-drawer')) roundKeys(e, open);
  }
});

render();
