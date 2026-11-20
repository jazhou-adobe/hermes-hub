// Toggles static states in the preview. No network, no inline script, no eval: it only flips hidden/aria attributes.
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const surfaces = $$('.pv-surface');
const navLinks = $$('.pv-nav a');

// ---- Surface routing by hash (Feed, Round detail, Answered log, Agents, Settings) ----
const TITLES = { feed: 'Feed', detail: 'Round detail', log: 'Answered log', agents: 'Agents', settings: 'Settings' };

function selectTab(id) {
  $$('.hh-tab').forEach((tab) => {
    const on = tab.id === id;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
  });
}

function route() {
  const id = decodeURIComponent(location.hash.slice(1)) || 'feed';
  const target = document.getElementById(id === 'lanes' ? 'agents' : id);
  if (!target) return;
  const current = target.closest('.pv-surface');
  if (!current) return;
  surfaces.forEach((el) => (el.hidden = el !== current));
  navLinks.forEach((link) => (link.getAttribute('href') === `#${current.id}` ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current')));
  if (current.id === 'agents') selectTab(id === 'lanes' ? 'tab-lanes' : 'tab-roster');
  document.title = `${current.id === "feed" ? "(5) " : ""}${TITLES[current.id]} · Hermes Hub design preview`;
  if (target !== current) target.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();

// ---- Tabs in Agents (Roster, Lanes) ----
$$('.hh-tab').forEach((tab, index, tabs) => {
  tab.addEventListener('click', () => selectTab(tab.id));
  tab.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + step + tabs.length) % tabs.length];
    selectTab(next.id);
    next.focus();
  });
});

// ---- Switches ----
$$('[role="switch"]').forEach((control) =>
  control.addEventListener('click', () => {
    const on = control.getAttribute('aria-checked') !== 'true';
    control.setAttribute('aria-checked', String(on));
    const word = control.querySelector('.pv-switch-state');
    if (word) word.textContent = on ? 'On' : 'Off';
  }),
);

// ---- Disclosure buttons: Dismiss / Redirect / Ask advisor panels and popovers ----
document.addEventListener('click', (event) => {
  const button = event.target.closest('button[aria-controls][aria-expanded]');
  if (!button || button.closest('[role="tablist"]') || button.classList.contains('hh-strip-head')) return;
  const panel = document.getElementById(button.getAttribute('aria-controls'));
  if (!panel) return;
  const open = panel.hidden;
  const round = button.closest('form');
  if (round && panel.classList.contains('pv-inline-panel')) {
    $$('.pv-inline-panel', round).forEach((other) => (other.hidden = true));
    $$('button[aria-controls][aria-expanded]', round).forEach((other) => other.setAttribute('aria-expanded', 'false'));
  }
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open) panel.querySelector('textarea, input')?.focus({ preventScroll: true });
});

// ---- Forget confirmation (alert dialog) ----
const dialog = document.getElementById('forget-dialog');
document.addEventListener('click', (event) => {
  const forget = event.target.closest('[data-forget]');
  if (forget && dialog) {
    $$('[data-forget-name]', dialog).forEach((el) => (el.textContent = forget.dataset.forget));
    const n = Number(forget.dataset.pending);
    $$('[data-forget-pending]', dialog).forEach((el) => (el.textContent = n === 1 ? '1 pending Round' : `${n} pending Rounds`));
    dialog.showModal();
    dialog.querySelector('[data-close]:not(.hh-icon-button)').focus();
    return;
  }
  if (event.target.closest('[data-close]')) event.target.closest('dialog')?.close();
});

// ---- Filter chips (Feed: callsign and project; log: Outcome, callsign, project). OR inside a kind, AND across kinds ----
function activeFilters(root) {
  const filters = {};
  $$('.hh-chip[data-filter][aria-pressed="true"]', root).forEach((chip) => {
    const [kind, value] = chip.dataset.filter.split(':');
    (filters[kind] ??= new Set()).add(value);
  });
  return filters;
}
const matches = (el, filters) => Object.entries(filters).every(([kind, values]) => values.has(el.dataset[kind]));

function applyFeed() {
  const filters = activeFilters(document.querySelector('.pv-index'));
  const items = $$('.pv-feed-item');
  let shown = 0;
  items.forEach((item) => {
    const show = matches(item, filters);
    item.hidden = !show;
    document.querySelector(`.pv-index-link[href="#${item.id}"]`).closest('li').hidden = !show;
    if (show) shown += 1;
  });
  const empty = Object.keys(filters).length > 0 && shown === 0;
  document.getElementById('feed-count').textContent = empty ? 'No Rounds match · Clear filters' : `Showing ${shown} of ${items.length}`;
}

function applyLog() {
  const log = document.getElementById('log');
  const filters = activeFilters(log);
  const rows = $$('section[aria-label] tbody tr', log);
  let shown = 0;
  rows.forEach((row) => {
    const show = matches(row, filters);
    row.hidden = !show;
    if (show) shown += 1;
  });
  $$('section[aria-label]', log).forEach((group) => (group.hidden = !$$('tbody tr:not([hidden])', group).length));
  document.getElementById('log-count').textContent = shown ? `Showing ${shown} of ${rows.length}` : 'No Rounds match · Clear filters';
}

$$('.hh-chip').forEach((chip) =>
  chip.addEventListener('click', () => {
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    if (chip.dataset.filter) (chip.closest('#log') ? applyLog : applyFeed)();
  }),
);
$$('button').forEach((button) => {
  if (!/Clear filters$/.test(button.textContent.trim())) return;
  button.addEventListener('click', () => {
    const scope = button.closest('#log, .pv-index');
    if (!scope) return;
    $$('.hh-chip[data-filter]', scope).forEach((chip) => chip.setAttribute('aria-pressed', 'false'));
    (scope.id === 'log' ? applyLog : applyFeed)();
  });
});

// ---- Feed index: mark the Round in view ----
const links = new Map($$('.pv-index-link').map((link) => [link.getAttribute('href').slice(1), link]));
const visible = new Set();
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id)));
    const first = $$('.pv-feed-item').find((item) => visible.has(item.id));
    if (!first) return;
    links.forEach((link, id) => (id === first.id ? link.setAttribute('aria-current', 'location') : link.removeAttribute('aria-current')));
  },
  { rootMargin: '-30% 0px -65% 0px' },
);
$$('.pv-feed-item').forEach((item) => observer.observe(item));

// ---- Appearance: theme and colour option, live ----
const theme = document.getElementById('theme-select');
const palette = document.getElementById('palette-select');
function applyAppearance() {
  const root = document.documentElement;
  root.dataset.theme = theme.value;
  if (theme.value === 'hermes-flight-director' && palette.value) root.dataset.palette = palette.value;
  else delete root.dataset.palette;
  palette.disabled = theme.value !== 'hermes-flight-director';
}
theme.addEventListener('change', applyAppearance);
palette.addEventListener('change', applyAppearance);
