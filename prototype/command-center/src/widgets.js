// PROTOTYPE, throwaway. Shared pieces every variant uses: callsign chip, strip, the open Round (Questions, Advisor,
// Answer bar), attachments. Variants differ in layout and navigation, not in these widgets.
import {
  callsign, hhmm, isOpenQ, isSet, liveness, mmss, nextDeadline, outcomeWords, policyOf, policyWords, sessionById, state,
  timerReadout, valueWords,
} from './engine.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICONS = {
  check: 'M4 12.5l5 5L20 6.5',
  x: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3.5 2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  code: 'M9 7l-5 5l5 5M15 7l5 5l-5 5',
  diff: 'M6 4v10M1 9h10M14 17h9M17 4h4v4',
  send: 'M4 12l16-8l-6 16l-3-7z',
  bay: 'M3 4h18v4H3zM3 10h18v4H3zM3 16h18v4H3z',
  'arrow-left': 'M20 12H4M10 6l-6 6l6 6',
  'arrow-right': 'M4 12h16M14 6l6 6l-6 6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  image: 'M3 5h18v14H3zM3 16l5-5l5 5l3-3l5 5M15.5 9.5a1 1 0 1 0 0 .1',
  spark: 'M12 3v6M12 15v6M3 12h6M15 12h6',
};
export const icon = (name) =>
  `<svg class="hh-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;

export const KIND_WORD = { single: 'Choose one', multi: 'Choose any', text: 'Free text', approve: 'Approve or reject' };

export function chip(sessionId) {
  const s = sessionById(sessionId);
  const cs = callsign(s);
  const gone = liveness(s) === 'Gone';
  return `<span class="hh-callsign" data-agent="${s.slot}" title="${esc(`${s.client} · ${s.cwd}`)}"><span class="hh-callsign-mark" aria-hidden="true"></span><span class="hh-callsign-text">${esc(cs)}${gone ? ' · gone' : ''}</span></span>`;
}

export function stateWord(session) {
  const st = liveness(session);
  if (st === 'Live') return `<span class="hh-connection" data-state="live"><span class="hh-connection-lamp" aria-hidden="true"></span><span>Live</span></span>`;
  return `<span class="hh-badge" data-tone="${st === 'Gone' ? 'expired' : ''}">${st}</span>`;
}

export const questionCount = (r) => `${r.questions.length} Question${r.questions.length === 1 ? '' : 's'}`;

export function timer(r) {
  const t = timerReadout(r);
  return `<span class="hh-policy-timer" data-policy="${t.policy === 'wait' ? 'wait' : t.policy}" aria-hidden="true" style="--timer-fraction:${t.fraction.toFixed(3)}"><span class="hh-policy-timer-fill"></span></span>`;
}

const lockCount = (r) => r.questions.filter((q) => q.lock).length;

/** A Round whose next deadline is under 60 s: shown as "Lock soon" (word + dashed warning frame), never colour alone. */
export const lockSoon = (r) => r.status === 'pending' && (timerReadout(r).left ?? Infinity) < 60_000;
export const lockSoonBadge = () => `<span class="proto-lock-soon x-add">${icon('clock')} Lock soon</span>`;

/** Diff runs of unchanged lines the Human expanded ("Show N unchanged lines"), keyed by attachment + run start. */
export const expandedRuns = new Set();

/** One pending Round as a strip in its holder. mode: 'option' (listbox) or 'button'. */
export function strip(r, { mode = 'option', selected = false, tabIndex = -1, action = 'open', goneNote = true } = {}) {
  const t = timerReadout(r);
  const s = sessionById(r.sessionId);
  const locks = lockCount(r);
  const soon = lockSoon(r);
  const label = ['Pending', soon ? 'Lock soon' : '', r.title, callsign(s), questionCount(r), t.text, locks ? `${locks} locked` : ''].filter(Boolean).join(', ');
  const cells = `
    <span class="hh-strip-cell" data-cell="callsign">${chip(r.sessionId)}<span class="hh-mono-sm">${r.id}</span></span>
    <span class="hh-strip-cell" data-cell="title"><span class="hh-strip-header hh-strip-title">${esc(r.title)}</span>
      <span class="hh-strip-policy">${questionCount(r)}${locks ? ` · ${locks} locked` : ''}${r.advisor?.status === 'working' ? ' · Advisor working' : ''}${r.supersedes ? ` · replaces ${r.supersedes}` : ''}</span></span>
    <span class="hh-strip-cell" data-cell="meta"><span class="hh-mono">${hhmm(r.receivedAt)}</span>${selected ? '<span class="hh-mono-sm">Open</span>' : ''}${goneNote && liveness(s) === 'Gone' ? '<span class="hh-body-sm">Agent gone · Answer is kept for its next poll</span>' : ''}</span>`;
  const tab = `<div class="hh-strip-tab" aria-hidden="true"><span>Pending${soon ? ' · Lock soon' : ''}</span><span class="hh-mono-sm">${esc(t.text)}</span></div>`;
  if (mode === 'button') {
    return `<li class="hh-strip" data-mode="button" data-status="pending" data-key="strip-${r.id}" data-round="${r.id}" ${soon ? 'data-lock-soon="true"' : ''}>${tab}
      <div class="hh-strip-paper"><button type="button" class="hh-strip-head" data-action="${action}" data-round="${r.id}" aria-label="${esc(label)}">${cells}</button></div>${timer(r)}</li>`;
  }
  return `<li class="hh-strip" role="option" data-status="pending" data-key="strip-${r.id}" data-round="${r.id}" aria-selected="${selected}" aria-label="${esc(label)}" tabindex="${tabIndex}" ${selected ? 'data-selected="true"' : ''} ${soon ? 'data-lock-soon="true"' : ''} data-action="${action}">${tab}
    <div class="hh-strip-paper" aria-hidden="true"><div class="hh-strip-head">${cells}</div></div>${timer(r)}</li>`;
}

// ---------- Attachments ----------

function md(src) {
  const out = [];
  const lines = esc(src).split('\n');
  let list = false;
  let code = null;
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (code) { out.push(`<pre><code>${code.join('\n')}</code></pre>`); code = null; } else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    if (line.startsWith('- ')) {
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (list) { out.push('</ul>'); list = false; }
    if (line.startsWith('## ')) out.push(`<p class="hh-heading-md">${inline(line.slice(3))}</p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

export function attachment(a, scope) {
  if (a.kind === 'diff') {
    const lines = a.content.split('\n');
    const add = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
    const rem = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
    const rows = lines.filter((l) => !l.startsWith('+++') && !l.startsWith('---')).map((l) => {
      const kind = l.startsWith('+') ? 'add' : l.startsWith('-') ? 'remove' : null;
      const sign = kind === 'add' ? '+' : kind === 'remove' ? '−' : ' ';
      const text = kind || l.startsWith(' ') ? l.slice(1) : l;
      return { kind, html: `<li class="hh-diff-line"${kind ? ` data-kind="${kind}"` : ''}><span class="hh-diff-sign" aria-hidden="true">${sign}</span><span>${kind ? `<span class="hh-visually-hidden">${kind === 'add' ? 'Added: ' : 'Removed: '}</span>` : ''}${esc(text)}</span></li>` };
    });
    // Collapse long unchanged runs (8+ lines) to 2 lines either side behind "Show N unchanged lines".
    const out = [];
    for (let i = 0; i < rows.length;) {
      if (rows[i].kind) { out.push(rows[i++].html); continue; }
      let j = i;
      while (j < rows.length && !rows[j].kind) j++;
      const run = rows.slice(i, j);
      const key = `${scope}-${a.path}-${i}`;
      if (run.length >= 8 && !expandedRuns.has(key)) {
        out.push(...run.slice(0, 2).map((x) => x.html));
        out.push(`<li class="proto-diff-fold x-add"><button type="button" class="hh-button" data-variant="ghost" data-size="sm" data-action="diff-expand" data-run="${esc(key)}" aria-expanded="false">Show ${run.length - 4} unchanged lines</button></li>`);
        out.push(...run.slice(-2).map((x) => x.html));
      } else out.push(...run.map((x) => x.html));
      i = j;
    }
    const body = out.join('');
    return `<figure class="hh-attachment"><figcaption class="hh-attachment-head"><span class="hh-badge">${icon('diff')} Diff</span><span class="hh-attachment-title hh-mono">${esc(a.path)}</span><span class="hh-mono-sm hh-muted">+${add} −${rem}</span></figcaption>
      <div class="hh-attachment-body" tabindex="0" aria-label="Diff of ${esc(a.path)}"><ol class="hh-diff">${body}</ol></div></figure>`;
  }
  if (a.kind === 'markdown') {
    return `<figure class="hh-attachment"><figcaption class="hh-attachment-head"><span class="hh-badge x-add">${icon('file')} Markdown</span><span class="hh-attachment-title hh-mono">${esc(a.title ?? 'Markdown')}</span></figcaption>
      <div class="proto-md x-add">${md(a.content)}</div></figure>`;
  }
  if (a.kind === 'image') {
    const src = `data:${a.media_type};base64,${btoa(a.svg)}`;
    return `<figure class="hh-attachment"><figcaption class="hh-attachment-head"><span class="hh-badge x-add">${icon('image')} Image</span><span class="hh-attachment-title hh-mono">${esc(a.title)}</span><span class="hh-mono-sm hh-muted">${esc(a.media_type)}</span></figcaption>
      <div class="proto-image x-add"><img src="${src}" alt="${esc(a.alt)}" width="320" height="200"><p class="hh-body-sm">Alt text: ${esc(a.alt)}</p></div></figure>`;
  }
  return '';
}

// ---------- The open Round ----------

const recWord = (r, q) => (policyOf(r, q).on_timeout === 'apply_recommended' ? 'Recommended · applied if unanswered' : 'Recommended');

function optionRow({ type, name, checked, hint, recommended, recText, label, detail, choice, bind, disabled }) {
  return `<label class="hh-option"${recommended ? ' data-recommended="true"' : ''}${checked ? ' data-checked="true"' : ''}${choice ? ` data-choice="${choice}"` : ''}>
    ${hint ? `<span class="hh-kbd" aria-hidden="true">${hint}</span>` : '<span aria-hidden="true"></span>'}
    <input type="${type}" name="${name}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} ${bind}>
    <span class="hh-option-text">${recommended ? `<span class="hh-recommended">${icon('check')} ${recText}</span>` : ''}<span class="hh-option-label">${esc(label)}</span>${detail ? `<span class="hh-option-detail">${esc(detail)}</span>` : ''}</span></label>`;
}

function questionBlock(r, q, i, ctx) {
  const scope = `${ctx.scope}-${r.id}`;
  const ended = r.status !== 'pending';
  const locked = !!q.lock;
  const ro = ended || locked;
  const v = locked ? q.lock.value : r.draft.values[q.id];
  const name = `${scope}-${q.id}`;
  const promptId = `${name}-prompt`;
  const current = !ro && ctx.currentQ === i;
  const invalid = ctx.invalid?.includes(q.id);
  const sug = r.suggestions[q.id];
  const offer = r.offers[q.id];
  const hints = !ro && ctx.hints;
  const rp = policyOf(r, q);
  const overrides = q.policy && JSON.stringify(q.policy) !== JSON.stringify(r.policy);
  const dl = q.policy || r.policy.on_timeout !== 'wait' ? (rp.on_timeout === 'wait' ? null : r.receivedAt + rp.after_seconds * 1000) : null;
  const bind = (opt) => `data-bind="choice" data-round="${r.id}" data-q="${q.id}" data-opt="${opt}"`;

  let stateTxt;
  if (locked) stateTxt = `<span class="hh-badge x-add" data-tone="expired">${icon('lock')} Locked</span> <span class="hh-body-sm">${q.lock.how === 'applied' ? 'Policy applied recommended' : 'Policy cancelled'} · ${hhmm(q.lock.at)}</span>`;
  else if (isSet(q, v)) stateTxt = `${icon('check')} ${q.kind === 'approve' ? (v.decision === 'approve' ? 'Approved' : 'Rejected') : 'Answered'}`;
  else stateTxt = q.required === false ? 'Optional' : 'Not answered';

  const meta = `<div class="hh-question-meta"><span class="hh-mono-sm">Q${i + 1} of ${r.questions.length}</span><span class="hh-badge">${KIND_WORD[q.kind]}</span>
    ${overrides ? `<span class="hh-policy-badge"><span class="hh-badge" data-tone="${rp.on_timeout === 'cancel' ? 'warning' : ''}">${icon('clock')} Own policy</span><span class="hh-mono-sm">${policyWords(rp)}${dl && !locked && !ended ? ` · ${mmss(dl - state.now)} left` : ''}</span></span>` : ''}
    <span class="hh-answer-state" id="${name}-state">${stateTxt}</span></div>`;

  let advisorNote = '';
  if (!locked && sug && isSet(q, r.draft.values[q.id])) {
    const same = JSON.stringify(sug.value) === JSON.stringify(r.draft.values[q.id]);
    advisorNote = `<p class="proto-suggested x-add">${icon('spark')} <span>${same ? `Suggested by ${esc(sug.by)}` : `Changed from ${esc(sug.by)}’s suggestion`} · <span class="hh-muted-inline">${esc(sug.rationale)}</span></span></p>`;
  }
  if (!locked && offer && !ended) {
    advisorNote += `<div class="proto-offer x-add"><span>${icon('spark')} ${esc(offer.by)} suggests <strong>${esc(valueWords(q, offer.value))}</strong> · ${esc(offer.rationale)}</span>
      <button type="button" class="hh-button" data-size="sm" data-action="accept-offer" data-round="${r.id}" data-q="${q.id}">Accept</button></div>`;
  }
  const notSent = q.notSent ? `<div class="hh-alert x-add" data-tone="warning"><span class="hh-badge" data-tone="expired">Not sent</span><p class="hh-body-sm">Your draft was ${esc(valueWords(q, q.notSent))}. The policy locked this Question first.</p>
      <button type="button" class="hh-button" data-size="sm" data-action="copy-q-draft" data-round="${r.id}" data-q="${q.id}">Copy draft</button></div>` : '';

  let response = '';
  if (q.kind === 'single' || q.kind === 'multi') {
    const type = q.kind === 'multi' ? 'checkbox' : 'radio';
    response = `<fieldset class="hh-question-response" aria-labelledby="${promptId}" aria-describedby="${name}-state" ${ro ? 'disabled' : ''}>${q.options.map((o, oi) => {
      const checked = q.kind === 'multi' ? !!v?.selected?.includes(o.id) : v?.selected === o.id;
      const recommended = q.kind === 'multi' ? q.recommended?.includes(o.id) : q.recommended === o.id;
      return optionRow({ type, name, checked, hint: hints && oi < 9 ? String(oi + 1) : null, recommended, recText: recWord(r, q), label: o.label, detail: o.detail, bind: bind(o.id), disabled: ro });
    }).join('')}</fieldset>`;
  } else if (q.kind === 'approve') {
    const p = q.proposal;
    const editing = ctx.editProposal?.[q.id] && !ro;
    const edit = r.draft.proposals[q.id];
    const edited = edit != null && edit !== p.value;
    const proposal = p ? `<div class="hh-attachment proto-proposal x-add"><div class="hh-attachment-head"><span class="hh-badge">${icon('code')} Proposal · ${p.format}</span>${edited ? '<span class="hh-badge" data-tone="warning">Edited</span>' : ''}${p.editable ? '<span class="hh-mono-sm hh-muted">editable</span>' : ''}</div>
      ${editing ? `<label class="hh-visually-hidden" for="${name}-proposal">Edit the proposal</label><textarea id="${name}-proposal" class="hh-textarea hh-mono" data-bind="proposal" data-round="${r.id}" data-q="${q.id}" rows="2">${esc(edit ?? p.value)}</textarea>
        <div class="hh-row"><button type="button" class="hh-button" data-size="sm" data-action="proposal-done" data-round="${r.id}" data-q="${q.id}">Done editing</button><button type="button" class="hh-button" data-variant="ghost" data-size="sm" data-action="proposal-reset" data-round="${r.id}" data-q="${q.id}">Reset to Agent’s</button></div>`
        : `<pre class="hh-attachment-body"><code>${esc(locked ? p.value : edit ?? p.value)}</code></pre>${p.editable && !ro ? `<div class="hh-row"><button type="button" class="hh-button" data-size="sm" data-action="proposal-edit" data-round="${r.id}" data-q="${q.id}">Edit, then approve</button></div>` : ''}`}</div>` : '';
    response = `<fieldset class="hh-question-response" aria-labelledby="${promptId}" aria-describedby="${name}-state" ${ro ? 'disabled' : ''}>${proposal}<div class="hh-approve-pair">
      ${optionRow({ type: 'radio', name, checked: v?.decision === 'approve', hint: hints ? 'A' : null, recommended: q.recommended === 'approve', recText: recWord(r, q), label: edited ? `${q.approve_label ?? 'Approve'} (edited)` : q.approve_label ?? 'Approve', choice: 'approve', bind: bind('approve'), disabled: ro })}
      ${optionRow({ type: 'radio', name, checked: v?.decision === 'reject', hint: hints ? 'R' : null, recommended: q.recommended === 'reject', recText: recWord(r, q), label: q.reject_label ?? 'Reject', choice: 'reject', bind: bind('reject'), disabled: ro })}
      </div>${q.recommended ? '' : '<p class="hh-body-sm">No recommendation from the Agent.</p>'}</fieldset>`;
  } else {
    const val = v?.text ?? '';
    response = `<div class="hh-question-response"><div class="hh-field"><label class="hh-label" for="${name}-text">Answer${q.required === false ? ' (optional)' : ''}</label>
      <textarea id="${name}-text" class="hh-textarea" aria-describedby="${promptId}" placeholder="${esc(q.placeholder ?? '')}" ${ro ? 'readonly' : ''} data-bind="text" data-round="${r.id}" data-q="${q.id}" rows="${q.multiline === false ? 1 : 3}">${esc(val)}</textarea>
      ${q.recommended ? `<p class="hh-body-sm proto-rec-text"><span class="hh-recommended">${icon('check')} ${recWord(r, q)}</span> “${esc(q.recommended)}” ${ro ? '' : `<button type="button" class="hh-button x-add" data-variant="ghost" data-size="sm" data-action="use-rec" data-round="${r.id}" data-q="${q.id}">Use it</button>`}</p>` : ''}</div></div>`;
  }
  const err = invalid ? `<p class="hh-error"><span class="hh-badge" data-tone="destructive">Error</span>${q.kind === 'multi' ? 'Choose at least one option.' : q.kind === 'approve' ? 'Choose Approve or Reject.' : q.kind === 'text' ? 'Write an answer.' : 'Choose one option.'}</p>` : '';
  return `<li class="hh-question" id="${name}" data-key="q-${r.id}-${q.id}" data-qidx="${i}" data-round="${r.id}" ${current ? 'data-current="true"' : ''} ${invalid ? 'data-invalid="true"' : ''} ${locked ? 'data-locked="true"' : ''}>
    <div class="hh-question-call">${meta}<p id="${promptId}" class="hh-question-prompt">${esc(q.prompt)}</p>${(q.attachments ?? []).map((a) => attachment(a, scope)).join('')}${notSent}${advisorNote}</div>
    ${response}${err}</li>`;
}

function advisorBlock(r) {
  const a = r.advisor;
  if (!a) return '';
  const trig = a.trigger === 'rule' ? 'auto-ask rule' : 'you asked';
  if (a.status === 'working') {
    return `<div class="hh-alert proto-advisor x-add" data-tone="info"><span class="hh-badge" data-tone="info"><span class="hh-spinner" aria-hidden="true"></span> Advisor working</span>
      <p class="hh-body-sm"><span class="hh-mono-sm">${mmss(state.now - a.startedAt)}</span> · ${esc(a.name)} (${trig})${a.brief ? ` · brief: “${esc(a.brief)}”` : ''} · deadlines keep running</p>
      <button type="button" class="hh-button" data-size="sm" data-action="advisor-cancel" data-round="${r.id}">Cancel</button></div>`;
  }
  if (a.status === 'done') {
    const f = a.filled?.length ?? r.questions.length;
    return `<div class="hh-alert proto-advisor x-add" data-tone="info"><span class="hh-badge" data-tone="info">${icon('spark')} Suggestion</span>
      <p class="hh-body-sm">From ${esc(a.name)} (${trig}) · filled ${f} empty${a.offered?.length ? ` · ${a.offered.length} offered beside your choice` : ''}${a.ignored?.length ? ` · ${a.ignored.length} ignored (locked)` : ''}. ${esc(a.summary ?? '')} You still send.</p></div>`;
  }
  if (a.status === 'unparsed') {
    return `<div class="hh-alert proto-advisor x-add" data-tone="warning"><span class="hh-badge" data-tone="warning">Briefing only</span>
      <div class="hh-body-sm"><p>${esc(a.name)} returned no usable Suggestion, so nothing was filled. Its output:</p><pre class="proto-briefing">${esc(a.raw)}</pre></div></div>`;
  }
  return `<p class="hh-body-sm x-add">${esc(a.name)} run ${a.status === 'stopped' ? 'stopped when the Round ended' : 'cancelled'}.</p>`;
}

function panel(r, ctx) {
  const p = ctx.panel;
  const t = ctx.panelText ?? {};
  if (!p) return '';
  if (p === 'dismiss') {
    return `<div class="proto-panel x-add" data-key="panel-dismiss-${r.id}"><label class="hh-label" for="dismiss-${r.id}">Dismiss this Round · note for ${esc(callsign(sessionById(r.sessionId)))} (optional)</label>
      <textarea id="dismiss-${r.id}" class="hh-textarea" rows="2" data-bind="panel" data-field="dismiss" data-round="${r.id}" placeholder="Why not now">${esc(t.dismiss ?? '')}</textarea>
      <div class="hh-row"><button type="button" class="hh-button" data-variant="destructive" data-action="dismiss-confirm" data-round="${r.id}">Dismiss Round</button><button type="button" class="hh-button" data-variant="ghost" data-action="panel-close" data-round="${r.id}">Keep it</button></div>
      <p class="hh-body-sm">Open Questions go back empty (set by none). Locked ones keep their policy values.</p></div>`;
  }
  if (p === 'redirect') {
    return `<div class="proto-panel x-add" data-key="panel-redirect-${r.id}"><label class="hh-label" for="redirect-${r.id}">Redirect · tell ${esc(callsign(sessionById(r.sessionId)))} what to do instead (required)</label>
      <textarea id="redirect-${r.id}" class="hh-textarea" rows="2" data-bind="panel" data-field="redirect" data-round="${r.id}" placeholder="Do X instead">${esc(t.redirect ?? '')}</textarea>
      ${ctx.redirectError ? '<p class="hh-error"><span class="hh-badge" data-tone="destructive">Error</span>Write what to do instead.</p>' : ''}
      <div class="hh-row"><button type="button" class="hh-button" data-variant="primary" data-action="redirect-confirm" data-round="${r.id}">${icon('send')} Send redirect</button><button type="button" class="hh-button" data-variant="ghost" data-action="panel-close" data-round="${r.id}">Cancel</button></div></div>`;
  }
  if (p === 'advisor') {
    const chosen = t.advisor ?? 'claude';
    return `<div class="proto-panel x-add" data-key="panel-advisor-${r.id}"><fieldset class="proto-fieldset"><legend class="hh-label">Ask advisor · it suggests, you send</legend>
      ${state.advisors.map((a) => `<label class="proto-radio"><input type="radio" name="adv-${r.id}" ${chosen === a.id ? 'checked' : ''} data-bind="panel-radio" data-field="advisor" data-value="${a.id}" data-round="${r.id}"> ${esc(a.name)} <span class="hh-mono-sm hh-muted">${esc(a.command.join(' '))}</span></label>`).join('')}</fieldset>
      <label class="hh-label" for="brief-${r.id}">Brief (optional, never sent to the Agent)</label>
      <textarea id="brief-${r.id}" class="hh-textarea" rows="2" data-bind="panel" data-field="brief" data-round="${r.id}" placeholder="What should it weigh?">${esc(t.brief ?? '')}</textarea>
      <div class="hh-row"><button type="button" class="hh-button" data-variant="primary" data-action="advisor-start" data-round="${r.id}">${icon('spark')} Start advisor</button><button type="button" class="hh-button" data-variant="ghost" data-action="panel-close" data-round="${r.id}">Cancel</button></div>
      ${r.advisor?.status === 'working' ? '<p class="hh-body-sm">Starting a new run cancels the one in progress.</p>' : ''}</div>`;
  }
  return '';
}

function endedBar(r, ctx) {
  const a = r.answer;
  let line = outcomeWords(r);
  if (r.status === 'expired') line = `Expired ${hhmm(r.decidedAt)} · every Question locked by its policy`;
  const replaced = a?.superseded_by;
  const human = ['answered', 'dismissed', 'redirected'].includes(r.status);
  return `<div class="hh-alert" data-tone="${human ? 'info' : 'warning'}" role="alert"><span class="hh-badge" data-tone="${human ? 'answered' : 'expired'}">${human ? 'Sent' : 'Not sent'}</span>
      <p class="hh-body-sm">${esc(line)}.${replaced ? ' Your Draft carried over to the replacement.' : r.notSent ? ' Your draft is kept below and in the answered log.' : ''}</p></div>
    <div class="hh-answer-bar-row">${r.notSent ? `<button type="button" class="hh-button" data-action="copy-draft" data-round="${r.id}">${icon('file')} Copy draft</button>` : '<span></span>'}
      <span class="hh-row">${replaced ? `<button type="button" class="hh-button" data-variant="primary" data-action="open-replacement" data-round="${replaced}">${icon('arrow-right')} Open ${replaced}</button>` : ''}
      <button type="button" class="hh-button" ${replaced ? '' : 'data-variant="primary"'} data-action="${ctx.nextAction ?? 'back'}" data-round="${r.id}">${ctx.nextLabel ?? `${icon('arrow-left')} Back to pending`}</button></span></div>`;
}

/** The open Round as a form: head, Questions (the only scrolling part), Answer bar. */
export function roundForm(r, ctx) {
  const ended = r.status !== 'pending';
  const s = sessionById(r.sessionId);
  const t = timerReadout(r);
  const open = r.questions.filter(isOpenQ);
  const req = open.filter((q) => q.required !== false);
  const done = req.filter((q) => isSet(q, r.draft.values[q.id])).length;
  const approves = r.questions.filter((q) => q.kind === 'approve');
  const go = approves.filter((q) => (q.lock?.value ?? r.draft.values[q.id])?.decision === 'approve').length;
  const nogo = approves.filter((q) => (q.lock?.value ?? r.draft.values[q.id])?.decision === 'reject').length;
  const badge = ended ? `<span class="hh-badge" data-tone="${['answered', 'dismissed', 'redirected'].includes(r.status) ? 'answered' : 'expired'}">${r.status[0].toUpperCase() + r.status.slice(1)}</span>` : '<span class="hh-badge" data-tone="pending">Pending</span>';
  const locks = lockCount(r);
  const head = `<div class="hh-round-head">
      ${ctx.back ? `<button type="button" class="hh-button hh-round-back" data-variant="ghost" data-action="${ctx.back.action}" aria-keyshortcuts="Escape">${icon('arrow-left')} ${ctx.back.label}</button>` : ''}
      <div class="hh-row">${badge}${lockSoon(r) ? lockSoonBadge() : ''}${chip(r.sessionId)}<span class="hh-mono-sm">${r.id} · received ${hhmm(r.receivedAt)}</span>${r.supersedes ? `<span class="hh-badge x-add">Replaces ${r.supersedes}</span>` : ''}${liveness(s) === 'Gone' ? '<span class="hh-body-sm">Agent gone · Answer is kept for its next poll</span>' : ''}</div>
      <h2 class="hh-strip-header" tabindex="-1" id="${ctx.scope}-${r.id}-title">${esc(r.title)}</h2>
      ${ended ? '' : `<div class="proto-round-policy"><span class="hh-policy-badge"><span class="hh-badge" data-tone="${r.policy.on_timeout === 'cancel' ? 'warning' : ''}">${icon('clock')} Policy</span><span class="hh-mono-sm">Round ${policyWords(r.policy)} · next: ${esc(t.text)}${locks ? ` · ${locks} of ${r.questions.length} locked, Round stays pending` : ''}</span></span></div>`}
      ${r.context ? `<p class="hh-body-sm">${esc(r.context)}</p>` : ''}
      ${advisorBlock(r)}
    </div>`;
  const body = `<div class="hh-round-body"><div class="proto-round-attachments">${r.attachments.map((a) => attachment(a, ctx.scope)).join('')}</div>
      <ol class="hh-round-questions">${r.questions.map((q, i) => questionBlock(r, q, i, ctx)).join('')}</ol>
      <details class="hh-notes" ${ctx.notesOpen || r.draft.notes ? 'open' : ''} data-key="notes-${r.id}"><summary class="hh-notes-summary" data-action="notes-toggle" data-round="${r.id}">${ended ? `Notes for ${esc(callsign(s))} (not sent)` : `Add notes for ${esc(callsign(s))} (optional)`}${ctx.hints && !ended ? '<kbd class="hh-kbd" aria-hidden="true">N</kbd>' : ''}</summary>
        <label class="hh-visually-hidden" for="${ctx.scope}-${r.id}-notes">Notes for ${esc(callsign(s))}</label>
        <textarea id="${ctx.scope}-${r.id}-notes" class="hh-textarea" data-bind="notes" data-round="${r.id}" ${ended ? 'readonly' : ''}>${esc(r.draft.notes)}</textarea></details></div>`;
  const missingQ = req.find((q) => !isSet(q, r.draft.values[q.id]));
  const bar = ended ? endedBar(r, ctx) : `${panel(r, ctx)}
    <div class="hh-answer-bar-row"><span class="hh-answer-progress"><span class="hh-mono-sm">${done} of ${req.length} required answered${locks ? ` · ${locks} locked by policy` : ''}</span>
      ${approves.length > 1 ? `<span class="hh-answer-tally hh-mono-sm">Poll · ${go} approved · ${nogo} rejected · ${approves.length - go - nogo} open</span>` : ''}
      ${missingQ ? `<span class="hh-mono-sm" id="${ctx.scope}-${r.id}-reason">Answer Q${r.questions.indexOf(missingQ) + 1} to send</span>` : ''}</span>
      <button type="submit" class="hh-button" data-variant="primary" aria-keyshortcuts="Meta+Enter Control+Enter" ${missingQ ? `aria-disabled="true" aria-describedby="${ctx.scope}-${r.id}-reason"` : ''}>${icon('send')} Send Answer <kbd class="hh-kbd" aria-hidden="true">⌘↵</kbd></button></div>
    <div class="hh-answer-bar-row proto-secondary x-add">
      <span class="hh-row"><button type="button" class="hh-button" data-size="sm" data-action="panel" data-panel="advisor" data-round="${r.id}" aria-pressed="${ctx.panel === 'advisor'}">${icon('spark')} Ask advisor</button>
      <button type="button" class="hh-button" data-size="sm" data-action="panel" data-panel="redirect" data-round="${r.id}" aria-pressed="${ctx.panel === 'redirect'}">Redirect${ctx.hints ? ' <kbd class="hh-kbd" aria-hidden="true">E</kbd>' : ''}</button>
      <button type="button" class="hh-button" data-size="sm" data-action="panel" data-panel="dismiss" data-round="${r.id}" aria-pressed="${ctx.panel === 'dismiss'}">Dismiss${ctx.hints ? ' <kbd class="hh-kbd" aria-hidden="true">D</kbd>' : ''}</button></span>
      ${ctx.extraActions ?? ''}</div>`;
  return `<form class="hh-round" data-key="round-${ctx.scope}-${r.id}" data-round="${r.id}" ${ended ? 'data-state="ended"' : ''} aria-label="Round ${r.id}" data-form="round">
    ${head}${body}<div class="hh-answer-bar">${bar}${ctx.status ? `<p class="hh-body-sm" role="status">${esc(ctx.status)}</p>` : ''}</div></form>`;
}
