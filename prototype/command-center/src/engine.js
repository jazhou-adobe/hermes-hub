// PROTOTYPE, throwaway. The shared live engine: one in-memory Hub that every variant reads and drives.
// Rules follow docs/specs/round-lifecycle.md and delegation.md (per-Question Lock, Supersede, Advisors, delivery).
import { ADVISORS, ARRIVALS, AUTO_ASK, SEED_LOG, SEED_ROUNDS, SESSIONS, SUPERSEDE } from './data.js';

const T0 = Date.now();
const S = 1000;
const ADVISOR_RUN = 6 * S;
const ARRIVAL_EVERY = 40 * S;
const LOCK_WARN = 15 * S;

let seed = 0x5eed;
const hex = (n) => {
  let out = '';
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out += (seed >> 16 & 15).toString(16);
  }
  return out;
};
const rid = () => `r_${hex(8)}`;
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

export const state = {
  t0: T0,
  now: T0,
  speed: 1,
  paused: false,
  sessions: SESSIONS.map((s) => ({ ...s, lastSeenAt: T0 + s.seenOffset * S, forgotten: false })),
  rounds: [],
  advisors: ADVISORS,
  autoAsk: AUTO_ASK,
  notifications: true,
  events: [],
  nextArrivalAt: T0 + 25 * S,
  arrivalIndex: 0,
  superseded: false,
  orderSeq: 0,
};

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);
const emit = (type, detail) => listeners.forEach((fn) => fn(type, detail));

function event(text, extra = {}) {
  state.events.unshift({ at: state.now, text });
  state.events.length = Math.min(state.events.length, 40);
  emit('event', { text, ...extra });
}
function notify(kind, text, roundId) {
  if (state.notifications) emit('notify', { kind, text, roundId });
}
function announce(text) {
  emit('announce', { text });
}

// ---------- Derived helpers ----------

export const sessionById = (id) => state.sessions.find((s) => s.id === id);
export const roundById = (id) => state.rounds.find((r) => r.id === id);
export const policyOf = (round, q) => q.policy ?? round.policy ?? { on_timeout: 'wait' };
export const deadlineOf = (round, q) => {
  const p = policyOf(round, q);
  return p.on_timeout === 'wait' ? null : round.receivedAt + p.after_seconds * S;
};

export function liveness(session) {
  const hasWait = !session.noWait && state.rounds.some((r) => r.sessionId === session.id && r.status === 'pending');
  const age = state.now - session.lastSeenAt;
  if (hasWait || age <= 120 * S) return 'Live';
  if (age <= 30 * 60 * S) return 'Idle';
  return 'Gone';
}

/** KIND·label, with a 4-character session suffix only when two Live/Idle sessions would look the same. */
export function callsign(session) {
  const base = `${session.KIND}·${session.label}`;
  const clash = state.sessions.some(
    (o) => o !== session && !o.forgotten && `${o.KIND}·${o.label}` === base && liveness(o) !== 'Gone',
  );
  return clash && liveness(session) !== 'Gone' ? `${base}·${session.key.slice(0, 4)}` : base;
}

export const pendingRounds = () => state.rounds.filter((r) => r.status === 'pending').sort((a, b) => a.order - b.order);
export const endedRounds = () => state.rounds.filter((r) => r.status !== 'pending').sort((a, b) => b.decidedAt - a.decidedAt);
export const isOpenQ = (q) => !q.lock;

export function isSet(q, v) {
  if (!v) return false;
  if (q.kind === 'single') return !!v.selected || !!v.other;
  if (q.kind === 'multi') return (v.selected?.length ?? 0) > 0;
  if (q.kind === 'text') return !!v.text?.trim();
  if (q.kind === 'approve') return !!v.decision;
  return false;
}

/** The Round's next deadline among its open Questions: what the strip timer shows. */
export function nextDeadline(round) {
  let best = null;
  for (const q of round.questions) {
    if (!isOpenQ(q)) continue;
    const d = deadlineOf(round, q);
    if (d != null && (!best || d < best.at)) best = { at: d, q, policy: policyOf(round, q) };
  }
  return best;
}

export const recommendedValue = (q) => {
  if (q.recommended == null) return null;
  if (q.kind === 'single') return { selected: q.recommended };
  if (q.kind === 'multi') return { selected: [...q.recommended] };
  if (q.kind === 'text') return { text: q.recommended };
  return { decision: q.recommended, edited: false };
};

export function valueWords(q, v) {
  if (!v) return 'no value';
  if (q.kind === 'single') return v.other ? `Other: ${v.other}` : q.options.find((o) => o.id === v.selected)?.label ?? v.selected;
  if (q.kind === 'multi') return v.selected.map((id) => q.options.find((o) => o.id === id)?.label ?? id).join(', ') || 'none';
  if (q.kind === 'text') return `“${v.text}”`;
  const word = v.decision === 'approve' ? (q.approve_label ?? 'Approve') : (q.reject_label ?? 'Reject');
  return v.edited ? `${word} (edited: ${v.proposal})` : word;
}

// ---------- Creating Rounds ----------

function makeRound(tpl, receivedAt, order) {
  const round = {
    id: rid(),
    key: tpl.key,
    sessionId: tpl.session,
    title: tpl.title,
    context: tpl.context ?? null,
    policy: tpl.policy ?? { on_timeout: 'wait' },
    attachments: tpl.attachments ?? [],
    questions: tpl.questions.map((q) => ({ required: true, ...clone(q), lock: null, notSent: null })),
    receivedAt,
    order: order ?? ++state.orderSeq,
    status: 'pending',
    advisorUnparsed: !!tpl.advisorUnparsed,
    draft: { values: {}, notes: '', proposals: {} },
    suggestions: {},
    offers: {},
    advisor: null,
    runs: [],
    history: [{ at: receivedAt, text: 'Received' }],
    warned: {},
  };
  return round;
}

for (const tpl of SEED_ROUNDS) {
  const r = makeRound(tpl, T0 + tpl.at * S);
  state.rounds.push(r);
  if (tpl.autoAskDone) {
    // This Round arrived before the page opened; its auto-ask run already finished.
    const advisor = ADVISORS[0];
    r.runs.push({ advisor: advisor.name, trigger: 'rule', brief: AUTO_ASK[0].brief, startedAt: r.receivedAt + 1 * S, endedAt: r.receivedAt + 7 * S, status: 'succeeded' });
    r.advisor = { status: 'done', name: advisor.name, summary: 'Badge only the states that need the customer to act; give it its own column.', trigger: 'rule' };
    for (const q of r.questions) {
      r.draft.values[q.id] = clone(q.advice.value);
      r.suggestions[q.id] = { by: advisor.name, value: clone(q.advice.value), rationale: q.advice.rationale };
    }
    r.history.push({ at: r.receivedAt + 7 * S, text: `Suggestion from ${advisor.name} (auto-ask rule)` });
  }
}
for (const tpl of SEED_LOG) {
  const r = makeRound(tpl, T0 + tpl.at * S, 0);
  r.status = tpl.outcome;
  r.decidedAt = T0 + tpl.endedAt * S;
  r.deliveredAt = tpl.delivered ? r.decidedAt + 2 * S : null;
  r.answer = {
    schema: 'hermes.answer/v1', round_id: r.id, outcome: tpl.outcome, ...(tpl.note ? { note: tpl.note } : {}),
    questions: Object.fromEntries(tpl.questions.map((q) => [q.id, q.answer])), decided_at: new Date(r.decidedAt).toISOString(),
  };
  r.questions.forEach((q) => {
    if (q.answer.set_by === 'policy') q.lock = { at: r.decidedAt, how: 'applied', value: q.answer.value };
  });
  state.rounds.push(r);
}

// ---------- Ending Rounds ----------

function draftText(round) {
  const lines = [`Round ${round.id} · ${round.title} · ${callsign(sessionById(round.sessionId))}`];
  round.questions.forEach((q, i) => {
    const v = q.notSent ?? round.draft.values[q.id];
    lines.push(`Q${i + 1} ${q.prompt} → ${isSet(q, v) ? valueWords(q, v) : '(empty)'}`);
  });
  if (round.draft.notes) lines.push(`Notes: ${round.draft.notes}`);
  return lines.join('\n');
}
export const copyDraftText = draftText;

function hasDraft(round) {
  return round.questions.some((q) => q.notSent || (isSet(q, round.draft.values[q.id]) && isOpenQ(q))) || !!round.draft.notes.trim();
}

function finish(round, outcome, extra = {}) {
  const human = outcome === 'answered';
  const questions = {};
  for (const q of round.questions) {
    if (q.lock) {
      questions[q.id] = { value: q.lock.value, set_by: 'policy' };
      continue;
    }
    const v = round.draft.values[q.id];
    if (human && isSet(q, v)) {
      let value = clone(v);
      if (q.kind === 'approve') {
        const edit = round.draft.proposals[q.id];
        const edited = value.decision === 'approve' && edit != null && edit !== q.proposal?.value;
        value = { decision: value.decision, edited, ...(edited ? { proposal: edit } : {}) };
      }
      const sug = round.suggestions[q.id];
      const same = sug && JSON.stringify(normal(sug.value)) === JSON.stringify(normal(value));
      questions[q.id] = { value, set_by: 'human', ...(same ? { suggested_by: sug.by } : {}) };
    } else {
      questions[q.id] = { value: null, set_by: 'none' };
    }
  }
  if ((outcome === 'expired' || outcome === 'cancelled') && hasDraft(round)) round.notSent = draftText(round);
  round.status = outcome;
  round.decidedAt = state.now;
  round.answer = {
    schema: 'hermes.answer/v1', round_id: round.id, outcome,
    ...(extra.message ? { message: extra.message } : {}),
    ...(round.draft.notes && (human || outcome === 'dismissed') ? { note: round.draft.notes } : extra.note ? { note: extra.note } : {}),
    questions, decided_at: new Date(state.now).toISOString(),
    ...(extra.cancelled_by ? { cancelled_by: extra.cancelled_by } : {}),
    ...(extra.superseded_by ? { superseded_by: extra.superseded_by } : {}),
  };
  if (round.advisor?.status === 'working') {
    round.advisor.status = 'stopped';
    const run = round.runs.at(-1);
    if (run) Object.assign(run, { endedAt: state.now, status: 'cancelled' });
  }
  round.deliveredAt = null;
  round.history.push({ at: state.now, text: outcomeWords(round) });
}
const normal = (v) => (v && v.selected && Array.isArray(v.selected) ? { ...v, selected: [...v.selected].sort() } : v);

export function outcomeWords(round) {
  const a = round.answer;
  const t = hhmm(round.decidedAt);
  switch (round.status) {
    case 'answered': return `Answered · ${t}`;
    case 'dismissed': return `Dismissed · ${t}`;
    case 'redirected': return `Redirected · ${t}`;
    case 'expired': return `Expired · ${t} · every Question locked by policy`;
    case 'cancelled':
      if (a?.superseded_by) return `Cancelled · ${t} · Replaced by ${a.superseded_by}`;
      return `Cancelled by ${a?.cancelled_by === 'human' ? 'you (Forget Agent)' : callsign(sessionById(round.sessionId))} · ${t}`;
    default: return 'Pending';
  }
}

// ---------- Human actions ----------

export function setValue(roundId, qid, value) {
  const r = roundById(roundId);
  if (!r || r.status !== 'pending') return;
  const q = r.questions.find((x) => x.id === qid);
  if (!q || q.lock) return;
  r.draft.values[qid] = value;
  if (r.offers[qid] && JSON.stringify(normal(r.offers[qid].value)) === JSON.stringify(normal(value))) {
    r.suggestions[qid] = r.offers[qid];
    delete r.offers[qid];
  }
  emit('change');
}
export function setNotes(roundId, text) {
  const r = roundById(roundId);
  if (r?.status === 'pending') r.draft.notes = text;
}
export function setProposal(roundId, qid, text) {
  const r = roundById(roundId);
  if (r?.status === 'pending') r.draft.proposals[qid] = text;
}

/** Returns the ids of required open Questions still missing a value; sends when there are none. */
export function sendAnswer(roundId) {
  const r = roundById(roundId);
  if (!r || r.status !== 'pending') return { ok: false, missing: [] };
  const missing = r.questions.filter((q) => isOpenQ(q) && q.required !== false && !isSet(q, r.draft.values[q.id])).map((q) => q.id);
  if (missing.length) return { ok: false, missing };
  finish(r, 'answered');
  const cs = callsign(sessionById(r.sessionId));
  event(`Answer sent · ${r.id} · ${cs}`);
  announce(`Answered · ${cs} · ${r.title}`);
  return { ok: true };
}
export function dismiss(roundId, note) {
  const r = roundById(roundId);
  if (r?.status !== 'pending') return;
  if (note) r.draft.notes = note;
  finish(r, 'dismissed', { note });
  event(`Dismissed · ${r.id}`);
  announce(`Dismissed · ${r.title}`);
}
export function redirect(roundId, message) {
  const r = roundById(roundId);
  if (r?.status !== 'pending' || !message.trim()) return;
  finish(r, 'redirected', { message: message.trim() });
  event(`Redirected · ${r.id} · “${message.trim()}”`);
  announce(`Redirected · ${r.title}`);
}

export function askAdvisor(roundId, advisorId, brief = '', trigger = 'manual') {
  const r = roundById(roundId);
  if (r?.status !== 'pending') return;
  const adv = ADVISORS.find((a) => a.id === advisorId) ?? ADVISORS[0];
  if (r.advisor?.status === 'working') cancelAdvisor(roundId, 'replaced by a new run');
  r.advisor = { status: 'working', name: adv.name, advisorId: adv.id, brief, trigger, startedAt: state.now, endsAt: state.now + ADVISOR_RUN };
  r.runs.push({ advisor: adv.name, trigger, brief, startedAt: state.now, status: 'running' });
  r.history.push({ at: state.now, text: `${adv.name} started (${trigger === 'rule' ? 'auto-ask rule' : 'Ask advisor'})` });
  event(`Advisor started · ${adv.name} · ${r.id} (${trigger})`);
  emit('change');
}
export function cancelAdvisor(roundId, why = 'cancelled by you') {
  const r = roundById(roundId);
  if (r?.advisor?.status !== 'working') return;
  r.advisor.status = 'cancelled';
  Object.assign(r.runs.at(-1), { endedAt: state.now, status: 'cancelled' });
  r.history.push({ at: state.now, text: `${r.advisor.name} run ${why}` });
  event(`Advisor cancelled · ${r.id}`);
  emit('change');
}
export function acceptOffer(roundId, qid) {
  const r = roundById(roundId);
  const offer = r?.offers[qid];
  const q = r?.questions.find((x) => x.id === qid);
  if (!offer || !q || q.lock) return;
  r.draft.values[qid] = clone(offer.value);
  r.suggestions[qid] = offer;
  delete r.offers[qid];
  emit('change');
}

export function forgetSession(sessionId) {
  const s = sessionById(sessionId);
  if (!s) return;
  s.forgotten = true;
  const cs = callsign(s);
  for (const r of pendingRounds().filter((x) => x.sessionId === sessionId)) finish(r, 'cancelled', { cancelled_by: 'human' });
  event(`Forgot ${cs} · its pending Rounds were cancelled`);
  announce(`Forgot ${cs}`);
}

export function setSpeed(n) { state.speed = n; event(`Clock ×${n}`); }
export function togglePause() { state.paused = !state.paused; event(state.paused ? 'Clock paused' : 'Clock running'); }
export function jump(seconds) { advance(seconds * S); event(`Clock jumped +${seconds} s`); }
export function toggleNotifications() { state.notifications = !state.notifications; emit('change'); }

// ---------- The clock ----------

function completeAdvisor(r) {
  const run = r.runs.at(-1);
  r.advisor.endedAt = state.now;
  if (r.advisorUnparsed && r.runs.length === 1) {
    r.advisor.status = 'unparsed';
    r.advisor.raw = `Looked at both images. Going by the alt text, option B ("phone showing a green check mark") explains the app at a glance, while A is mood only. I would pick B but I cannot see the actual pixels, so check the contrast of the check mark on small screens.\n\n(no JSON object found in output)`;
    Object.assign(run, { endedAt: state.now, status: 'failed' });
    r.history.push({ at: state.now, text: `${r.advisor.name} returned no Suggestion (unparsed briefing kept)` });
    event(`Advisor output unparsed · ${r.id}`);
    notify('advisor', `${r.advisor.name} finished on “${r.title}” · no Suggestion, briefing only`, r.id);
    return;
  }
  const filled = [];
  const offered = [];
  const ignored = [];
  for (const q of r.questions) {
    if (!q.advice) continue;
    const sug = { by: r.advisor.name, value: clone(q.advice.value), rationale: q.advice.rationale };
    if (q.lock) ignored.push(q.id);
    else if (!isSet(q, r.draft.values[q.id])) {
      r.draft.values[q.id] = clone(q.advice.value);
      r.suggestions[q.id] = sug;
      filled.push(q.id);
    } else if (JSON.stringify(normal(r.draft.values[q.id])) !== JSON.stringify(normal(sug.value))) {
      r.offers[q.id] = sug;
      offered.push(q.id);
    }
  }
  r.advisor.status = 'done';
  r.advisor.summary = r.questions.map((q) => q.advice?.rationale).filter(Boolean)[0] ?? '';
  r.advisor.filled = filled;
  r.advisor.offered = offered;
  r.advisor.ignored = ignored;
  Object.assign(run, { endedAt: state.now, status: 'succeeded' });
  r.history.push({ at: state.now, text: `Suggestion from ${r.advisor.name}: filled ${filled.length}, offered ${offered.length}, ignored ${ignored.length} (locked)` });
  event(`Suggestion ready · ${r.advisor.name} · ${r.id}`);
  notify('advisor', `Suggestion ready · ${r.advisor.name} on “${r.title}”`, r.id);
}

function lockQuestion(r, q, at) {
  const p = policyOf(r, q);
  const v = r.draft.values[q.id];
  if (isSet(q, v)) q.notSent = clone(v);
  q.lock = p.on_timeout === 'apply_recommended' ? { at, how: 'applied', value: recommendedValue(q) } : { at, how: 'cancelled', value: null };
  delete r.offers[q.id];
  const cs = callsign(sessionById(r.sessionId));
  const what = q.lock.how === 'applied' ? 'Policy applied recommended' : 'Policy cancelled';
  r.history.push({ at, text: `Q “${q.prompt}” locked · ${what}${q.notSent ? ' · your draft kept as Not sent' : ''}` });
  event(`Lock · ${r.id}/${q.id} · ${what}`);
  announce(`${cs}: ${what} on “${q.prompt}”${q.notSent ? ' · your draft was not sent' : ''}`);
  if (r.questions.every((x) => x.lock)) {
    state.now = at;
    finish(r, 'expired');
    event(`Expired · ${r.id} · no open Question left`);
    announce(`Expired · ${r.title}`);
  }
}

function arrive(tpl, order) {
  const r = makeRound(tpl, state.now, order);
  const s = sessionById(r.sessionId);
  s.lastSeenAt = state.now;
  if (s.forgotten) s.forgotten = false;
  state.rounds.push(r);
  const cs = callsign(s);
  event(`New Round · ${r.id} · ${cs}`);
  announce(`New Round from ${cs}: ${r.title}`);
  notify('round', `New Round · ${cs} · ${r.title}`, r.id);
  const rule = AUTO_ASK.find((x) => x.kind === s.kind && x.project === s.git.root && (!x.label || x.label === s.label));
  if (rule) askAdvisor(r.id, rule.advisor, rule.brief ?? '', 'rule');
  return r;
}

function supersede() {
  state.superseded = true;
  const old = state.rounds.find((r) => r.key === SUPERSEDE.replaces);
  if (!old || old.status !== 'pending') {
    event(`Supersede rejected · ${old?.id} already ${old?.status}; the Agent collects its Answer instead`);
    return;
  }
  const fresh = makeRound(SUPERSEDE.round, state.now, old.order);
  // Carry the Human's Draft for Questions whose id and kind match.
  for (const q of fresh.questions) {
    const prev = old.questions.find((x) => x.id === q.id && x.kind === q.kind);
    if (prev && !prev.lock && old.draft.values[q.id]) fresh.draft.values[q.id] = clone(old.draft.values[q.id]);
    if (prev && old.suggestions[q.id]) fresh.suggestions[q.id] = old.suggestions[q.id];
  }
  fresh.draft.notes = old.draft.notes;
  fresh.supersedes = old.id;
  fresh.history.push({ at: state.now, text: `Replaces ${old.id}; your Draft carried over for matching Questions` });
  finish(old, 'cancelled', { cancelled_by: 'agent', superseded_by: fresh.id });
  old.notSent = null; // the Draft moved to the replacement, it was not lost
  state.rounds.push(fresh);
  sessionById(fresh.sessionId).lastSeenAt = state.now;
  const cs = callsign(sessionById(fresh.sessionId));
  event(`Supersede · ${cs} replaced ${old.id} with ${fresh.id}`);
  announce(`${cs} replaced “${old.title}” with ${fresh.id}`);
  notify('round', `${cs} replaced a Round · ${fresh.title}`, fresh.id);
  emit('superseded', { from: old.id, to: fresh.id });
}

function advance(ms) {
  const target = state.now + ms;
  // Step through in at most 1 s slices so events fire in deadline order.
  while (state.now < target) {
    state.now = Math.min(target, state.now + S);
    step();
  }
}

function step() {
  const now = state.now;
  for (const r of pendingRounds()) {
    const s = sessionById(r.sessionId);
    if (!s.noWait) s.lastSeenAt = now; // holds an open wait
    // Locks in deadline order.
    const due = r.questions.filter((q) => isOpenQ(q) && deadlineOf(r, q) != null).sort((a, b) => deadlineOf(r, a) - deadlineOf(r, b));
    for (const q of due) {
      const d = deadlineOf(r, q);
      if (d <= now && r.status === 'pending') lockQuestion(r, q, d);
      else if (d - now <= LOCK_WARN && !r.warned[q.id]) {
        r.warned[q.id] = true;
        const what = policyOf(r, q).on_timeout === 'apply_recommended' ? 'applies recommended' : 'cancels';
        notify('lock', `Lock in 15 s · ${callsign(s)} · “${q.prompt}” then ${what}`, r.id);
        announce(`15 seconds left on “${q.prompt}”`);
      }
    }
    if (r.status === 'pending' && r.advisor?.status === 'working' && now >= r.advisor.endsAt) completeAdvisor(r);
  }
  // Delivery: a Live session picks up ended Answers about 2 s later; Idle and Gone ones stay "Not picked up".
  for (const r of state.rounds) {
    if (r.status === 'pending' || r.deliveredAt) continue;
    const s = sessionById(r.sessionId);
    if (s.forgotten || liveness(s) !== 'Live') continue;
    if (now - r.decidedAt >= 2 * S && liveness(s) !== 'Gone') r.deliveredAt = now;
  }
  if (!state.superseded && now >= T0 + SUPERSEDE.at * S) supersede();
  if (now >= state.nextArrivalAt) {
    state.nextArrivalAt += ARRIVAL_EVERY;
    arrive(ARRIVALS[state.arrivalIndex++ % ARRIVALS.length]);
  }
}

let last = performance.now();
setInterval(() => {
  const t = performance.now();
  const dt = t - last;
  last = t;
  if (!state.paused) advance(dt * state.speed);
  emit('tick');
}, 250);

// ---------- Formatting ----------

export const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
export const hhmmss = (ms) => new Date(ms).toTimeString().slice(0, 8);
export const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / S));
  return `${String(Math.floor(s / 60)).padStart(1, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const ago = (ms) => {
  const s = Math.max(0, Math.round((state.now - ms) / S));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return hhmm(ms);
};

export function policyWords(p) {
  if (!p || p.on_timeout === 'wait') return 'keeps waiting';
  const m = Math.floor(p.after_seconds / 60);
  const sec = p.after_seconds % 60;
  const t = m ? `${m} min${sec ? ` ${sec} s` : ''}` : `${sec} s`;
  return p.on_timeout === 'apply_recommended' ? `waits ${t}, then applies recommended` : `waits ${t}, then cancels`;
}

/** The strip/lane readout for the Round's NEXT deadline. */
export function timerReadout(round) {
  const d = nextDeadline(round);
  if (!d) return { text: 'No deadline · keeps waiting', fraction: 1, policy: 'wait', left: null };
  const left = d.at - state.now;
  const then = d.policy.on_timeout === 'apply_recommended' ? 'then applies recommended' : 'then cancels';
  const which = round.questions.length > 1 ? ` · Q${round.questions.indexOf(d.q) + 1}` : '';
  return {
    text: `${mmss(left)} left${which}, ${then}`,
    fraction: Math.max(0, Math.min(1, left / (d.policy.after_seconds * S))),
    policy: d.policy.on_timeout,
    left,
  };
}

/** Compact JSON for the prototype state panel. */
export function snapshot() {
  return {
    clock: { now: hhmmss(state.now), elapsed_s: Math.round((state.now - T0) / S), speed: state.speed, paused: state.paused, next_arrival_in_s: Math.round((state.nextArrivalAt - state.now) / S) },
    rounds: state.rounds.filter((r) => r.order > 0 || r.status === 'pending').map((r) => ({
      id: r.id, status: r.status, order: r.order, agent: callsign(sessionById(r.sessionId)),
      next_deadline_s: r.status === 'pending' && nextDeadline(r) ? Math.round((nextDeadline(r).at - state.now) / S) : null,
      locks: Object.fromEntries(r.questions.filter((q) => q.lock).map((q) => [q.id, q.lock.how])),
      draft: r.draft.values, advisor: r.advisor?.status ?? null,
      ...(r.supersedes ? { supersedes: r.supersedes } : {}),
      ...(r.answer ? { answer: { outcome: r.answer.outcome, superseded_by: r.answer.superseded_by, cancelled_by: r.answer.cancelled_by }, delivered: !!r.deliveredAt } : {}),
    })),
    sessions: state.sessions.map((s) => ({ id: s.id, callsign: callsign(s), state: liveness(s), forgotten: s.forgotten })),
  };
}
