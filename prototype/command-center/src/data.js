// PROTOTYPE, throwaway. Mock Agent sessions, Rounds and Advisors for the Command Center flow prototype.
// Times are offsets in seconds from page load (negative = already waiting when the page opened).

const svg = (body, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" role="img" aria-label="${label}">${body}</svg>`;

export const IMAGE_A = svg(
  '<rect width="160" height="100" fill="#f3e6c8"/><circle cx="118" cy="34" r="16" fill="#e2a65c"/><path d="M0 80 Q40 50 80 72 T160 64 V100 H0Z" fill="#468a58"/><path d="M0 90 Q50 70 100 86 T160 84 V100 H0Z" fill="#2f5d3c"/>',
  'Option A: sunrise over green hills',
);
export const IMAGE_B = svg(
  '<rect width="160" height="100" fill="#dfe8ee"/><rect x="58" y="12" width="44" height="78" rx="7" fill="#1a2228"/><rect x="62" y="20" width="36" height="60" rx="3" fill="#ebe3cd"/><path d="M70 50 l7 7 l14 -16" stroke="#468a58" stroke-width="5" fill="none" stroke-linecap="round"/>',
  'Option B: phone showing a green check mark',
);

export const SESSIONS = [
  {
    id: 's_9c41e2', kind: 'claude-code', KIND: 'CLAUDE', label: 'api-refactor', declared: true,
    key: '6f1c2e0a-91d4-4c3b-a0e2-5d7f1b2c9e44', slot: 1,
    cwd: '~/Git/api-refactor', git: { root: '~/Git/api-refactor', branch: 'feat/orders-split', head: 'a1b2c3d4' },
    host: 'studio-mac', client: 'Claude Code', version: '2.1.231',
    detection: { step: 3, source: 'CLAUDE_CODE_SESSION_ID', documented: true },
    resume: 'claude --resume 6f1c2e0a-91d4-4c3b-a0e2-5d7f1b2c9e44', seenOffset: -4,
  },
  {
    id: 's_2b7f90', kind: 'codex', KIND: 'CODEX', label: 'billing-ui', declared: false,
    key: '019a7c2e-5b1f-7d40-9e3a-c4b2f1e08d77', slot: 2,
    cwd: '~/Git/billing-ui', git: { root: '~/Git/billing-ui', branch: 'main', head: '7e0d55aa' },
    host: 'studio-mac', client: 'Codex CLI', version: '0.61.0',
    detection: { step: 3, source: 'CODEX_THREAD_ID', documented: true },
    resume: 'codex resume 019a7c2e-5b1f-7d40-9e3a-c4b2f1e08d77', seenOffset: -2,
  },
  {
    id: 's_71d0aa', kind: 'cursor-ide', KIND: 'CURSOR', label: 'docs-site', declared: false,
    key: 'c0nv-5521-ab8e-44f1', slot: 3,
    cwd: '~/Git/docs-site', git: { root: '~/Git/docs-site', branch: 'release/4.2', head: '3be19c02' },
    host: 'studio-mac', client: 'Cursor (IDE)', version: '2.3.4',
    detection: { step: 3, source: 'CURSOR_CONVERSATION_ID', documented: false },
    resume: null, seenOffset: -420, noWait: true,
  },
  {
    id: 's_e4a913', kind: 'omp', KIND: 'OMP', label: 'hermes-hub', declared: true,
    key: 'pi-2f8a61c7', slot: 4,
    cwd: '~/Git/AI/hermes-hub', git: { root: '~/Git/AI/hermes-hub', branch: 'spec/command-center', head: 'f00dbabe' },
    host: 'studio-mac', client: 'omp', version: '14.2.0',
    detection: { step: 3, source: 'PI_SESSION_ID', documented: true },
    resume: 'omp --resume pi-2f8a61c7', seenOffset: -1,
  },
  {
    id: 's_5530fc', kind: 'vscode-copilot', KIND: 'COPILOT', label: 'mobile-app', declared: false,
    key: 'vscode.conversationId 3be1d0c4', slot: 5,
    cwd: '~/Git/mobile-app', git: { root: '~/Git/mobile-app', branch: 'onboarding-v2', head: '0c4ffe21' },
    host: 'studio-mac', client: 'VS Code Copilot', version: '1.106',
    detection: { step: 2, source: '_meta["vscode.conversationId"]', documented: false },
    resume: null, seenOffset: -41 * 60, noWait: true,
  },
  {
    id: 's_3f9a06', kind: 'claude-code', KIND: 'CLAUDE', label: 'api', declared: true,
    key: '3f9a0b17-2c44-4e1d-9a0f-0b6e77d1c3a2', slot: 6,
    cwd: '~/Git/api', git: { root: '~/Git/api', branch: 'main', head: '9d2e4410' },
    host: 'studio-mac', client: 'Claude Code', version: '2.1.231',
    detection: { step: 3, source: 'CLAUDE_CODE_SESSION_ID', documented: true },
    resume: 'claude --resume 3f9a0b17-2c44-4e1d-9a0f-0b6e77d1c3a2', seenOffset: -3,
  },
  {
    id: 's_c210b8', kind: 'claude-code', KIND: 'CLAUDE', label: 'api', declared: true,
    key: 'c2107d55-8a1e-4f60-b3c9-71e2a0d4f5b6', slot: 1,
    cwd: '~/Git/api-worktrees/hotfix', git: { root: '~/Git/api', branch: 'hotfix/rate-limit', head: '41aa07e3' },
    host: 'studio-mac', client: 'Claude Code', version: '2.1.231',
    detection: { step: 3, source: 'CLAUDE_CODE_SESSION_ID', documented: true },
    resume: 'claude --resume c2107d55-8a1e-4f60-b3c9-71e2a0d4f5b6', seenOffset: -6,
  },
];

export const ADVISORS = [
  { id: 'claude', name: 'Claude · read-only', command: ['claude', '-p', '--permission-mode', 'plan', '--output-format', 'text'], timeout: 300 },
  { id: 'codex', name: 'Codex · read-only', command: ['codex', 'exec', '--sandbox', 'read-only', '-'], timeout: 300 },
];

export const AUTO_ASK = [
  { kind: 'codex', project: '~/Git/billing-ui', label: null, advisor: 'claude', brief: 'Prefer what the billing design doc says; flag anything that touches money.' },
];

const DIFF_ORDERS = `--- a/db/schema/orders.sql
+++ b/db/schema/orders.sql
@@ -12,9 +12,14 @@ CREATE TABLE orders (
   id             uuid PRIMARY KEY,
   customer_id    uuid NOT NULL REFERENCES customers(id),
-  total_cents    integer NOT NULL,
-  currency       char(3) NOT NULL DEFAULT 'USD',
+  subtotal_cents integer NOT NULL,
+  tax_cents      integer NOT NULL DEFAULT 0,
+  total_cents    integer GENERATED ALWAYS AS (subtotal_cents + tax_cents) STORED,
+  currency       char(3) NOT NULL DEFAULT 'USD',
   status         order_status NOT NULL,
   created_at     timestamptz NOT NULL DEFAULT now()
 );
+
+CREATE INDEX CONCURRENTLY orders_customer_created_idx
+  ON orders (customer_id, created_at DESC);`;

const MD_INTRO = `## Getting started (current)

Hermes Hub is a **local** service. Install it, then run:

\`\`\`
hermes hub
\`\`\`

- Agents find the Hub through \`~/.hermes/hub.json\`.
- Open the Command Center at \`http://127.0.0.1:4747/\`.

The intro is 140 words and repeats the install step twice.`;

const MD_RELEASE = (extra) => `## Hermes Hub 0.3.0

- Rounds: per-Question Lock when an Unanswered Policy fires.
- Advisors: **Ask advisor** on any pending Round; auto-ask rules in Settings.
- Agent roster: Detection details with the source signal.${extra ? `\n- ${extra}` : ''}`;

/** Rounds pending when the page opens. */
export const SEED_ROUNDS = [
  {
    key: 'r1', session: 's_9c41e2', at: -30, title: 'Choose a migration strategy for orders',
    context: 'The orders table is 41 GB. Splitting `total_cents` needs a rewrite; I can do it in place or blue/green.',
    policy: { on_timeout: 'apply_recommended', after_seconds: 210 },
    questions: [
      {
        id: 'strategy', kind: 'single', prompt: 'Which migration strategy should I use?',
        options: [
          { id: 'in_place', label: 'In place', detail: 'ALTER TABLE in one transaction; locks orders for about 6 min.' },
          { id: 'blue_green', label: 'Blue/green', detail: 'Copy to orders_v2, dual-write, swap; no long lock.' },
          { id: 'defer', label: 'Defer to next sprint' },
        ],
        recommended: 'blue_green',
        attachments: [{ kind: 'diff', path: 'db/schema/orders.sql', content: DIFF_ORDERS }],
        advice: { value: { selected: 'blue_green' }, rationale: 'The diff rewrites orders; in place would lock it for minutes.' },
      },
      {
        id: 'run_migration', kind: 'approve', prompt: 'Run the migration on staging now?',
        policy: { on_timeout: 'cancel', after_seconds: 90 },
        proposal: { format: 'command', value: 'bun run db:migrate --env=staging --plan=blue-green', editable: true },
        recommended: 'approve', approve_label: 'Approve: run on staging', reject_label: 'Reject',
        advice: { value: { decision: 'approve', edited: false }, rationale: 'Staging only; reversible.' },
      },
    ],
  },
  {
    key: 'r2', session: 's_2b7f90', at: -95, title: 'Which invoice states get a badge?',
    context: 'The invoice list shows a status column. Design wants a badge for the states that need action.',
    policy: { on_timeout: 'wait' }, autoAskDone: true,
    questions: [
      {
        id: 'states', kind: 'multi', prompt: 'Show a badge for which states?',
        options: [
          { id: 'draft', label: 'Draft' }, { id: 'open', label: 'Open' }, { id: 'overdue', label: 'Overdue' },
          { id: 'failed', label: 'Payment failed' }, { id: 'paid', label: 'Paid' },
        ],
        recommended: ['overdue', 'failed'],
        advice: { value: { selected: ['overdue', 'failed'] }, rationale: 'Only these two need the customer to act.' },
      },
      {
        id: 'placement', kind: 'single', prompt: 'Where does the badge sit?',
        options: [{ id: 'before', label: 'Before the amount' }, { id: 'after', label: 'After the amount' }, { id: 'own_col', label: 'Own column' }],
        advice: { value: { selected: 'own_col' }, rationale: 'An own column keeps amounts aligned for scanning.' },
      },
    ],
  },
  {
    key: 'r3', session: 's_71d0aa', at: -40, title: 'Rewrite the getting-started intro',
    policy: { on_timeout: 'cancel', after_seconds: 150 },
    attachments: [{ kind: 'markdown', title: 'docs/getting-started.md (current)', content: MD_INTRO }],
    questions: [
      {
        id: 'intro', kind: 'text', prompt: 'What should the first paragraph say?', placeholder: 'One or two sentences',
        recommended: 'Hermes Hub runs on your Mac and collects questions from your coding agents in one place.',
        advice: { value: { text: 'Hermes Hub runs on your Mac. Your coding agents ask it questions; you answer them from one page.' }, rationale: 'Shorter; drops the repeated install step.' },
      },
    ],
  },
  {
    key: 'r4', session: 's_e4a913', at: -50, title: 'Approve the 0.3.0 release notes',
    policy: { on_timeout: 'wait' },
    questions: [
      {
        id: 'notes_ok', kind: 'approve', prompt: 'Publish these release notes?',
        attachments: [{ kind: 'markdown', title: 'CHANGELOG excerpt', content: MD_RELEASE() }],
        proposal: { format: 'text', value: 'Publish CHANGELOG 0.3.0 to the GitHub release', editable: false },
        recommended: 'approve',
        advice: { value: { decision: 'approve', edited: false }, rationale: 'Matches the merged PRs.' },
      },
      {
        id: 'tag', kind: 'single', prompt: 'Which tag?',
        options: [{ id: 'v0_3_0', label: 'v0.3.0' }, { id: 'v0_3_0_rc1', label: 'v0.3.0-rc.1' }],
        recommended: 'v0_3_0', advice: { value: { selected: 'v0_3_0' }, rationale: 'No open blockers.' },
      },
    ],
  },
  {
    key: 'r5', session: 's_3f9a06', at: -20, title: 'Delete stale feature branches',
    policy: { on_timeout: 'apply_recommended', after_seconds: 75 },
    questions: [
      {
        id: 'delete', kind: 'approve', prompt: 'Delete these two remote branches?',
        proposal: { format: 'command', value: 'git push origin --delete feat/old-auth feat/legacy-export', editable: true },
        recommended: 'reject', approve_label: 'Approve: delete', reject_label: 'Reject: keep them',
        advice: { value: { decision: 'reject', edited: false }, rationale: 'feat/legacy-export has an open PR (#212).' },
      },
    ],
  },
  {
    key: 'r6', session: 's_c210b8', at: -10, title: 'Rate-limit hotfix: test plan',
    policy: { on_timeout: 'wait' },
    questions: [
      {
        id: 'runner', kind: 'single', prompt: 'Which test run before merging?',
        policy: { on_timeout: 'apply_recommended', after_seconds: 55 },
        options: [{ id: 'unit', label: 'Unit only', detail: '40 s' }, { id: 'unit_int', label: 'Unit and integration', detail: '6 min' }, { id: 'full', label: 'Full suite', detail: '22 min' }],
        recommended: 'unit_int', advice: { value: { selected: 'unit_int' }, rationale: 'The limiter touches Redis; integration covers it.' },
      },
      {
        id: 'anything_else', kind: 'text', prompt: 'Anything else to check before merging?', required: false, placeholder: 'Optional',
        advice: { value: { text: 'Check the 429 response still carries Retry-After.' }, rationale: 'Clients back off on it.' },
      },
    ],
  },
  {
    key: 'r7', session: 's_5530fc', at: -300, title: 'Pick the onboarding illustration', advisorUnparsed: true,
    policy: { on_timeout: 'wait' },
    questions: [
      {
        id: 'art', kind: 'single', prompt: 'Which illustration goes on the first onboarding screen?',
        attachments: [
          { kind: 'image', media_type: 'image/svg+xml', svg: IMAGE_A, alt: 'Option A: sunrise over green hills', title: 'option-a' },
          { kind: 'image', media_type: 'image/svg+xml', svg: IMAGE_B, alt: 'Option B: phone showing a green check mark', title: 'option-b' },
        ],
        options: [{ id: 'a', label: 'A · Sunrise' }, { id: 'b', label: 'B · Phone with check' }],
        recommended: 'b', advice: { value: { selected: 'b' }, rationale: 'B says what the app does.' },
      },
    ],
  },
];

/** The scripted Supersede: OMP·hermes-hub replaces r4 about 60 s in. */
export const SUPERSEDE = {
  at: 60, replaces: 'r4',
  round: {
    key: 'r4b', session: 's_e4a913', title: 'Approve the 0.3.0 release notes (adds MCP Tasks line)',
    policy: { on_timeout: 'wait' },
    questions: [
      {
        id: 'notes_ok', kind: 'approve', prompt: 'Publish these release notes?',
        attachments: [{ kind: 'markdown', title: 'CHANGELOG excerpt', content: MD_RELEASE('Transports: MCP Tasks for long waits.') }],
        proposal: { format: 'text', value: 'Publish CHANGELOG 0.3.0 to the GitHub release', editable: false },
        recommended: 'approve', advice: { value: { decision: 'approve', edited: false }, rationale: 'Matches the merged PRs.' },
      },
      {
        id: 'tag', kind: 'single', prompt: 'Which tag?',
        options: [{ id: 'v0_3_0', label: 'v0.3.0' }, { id: 'v0_3_0_rc1', label: 'v0.3.0-rc.1' }],
        recommended: 'v0_3_0', advice: { value: { selected: 'v0_3_0' }, rationale: 'No open blockers.' },
      },
      {
        id: 'announce', kind: 'approve', prompt: 'Also post the announcement in #hermes?',
        proposal: { format: 'text', value: 'Hermes Hub 0.3.0 is out: per-Question Locks, Advisors, Detection details.', editable: true },
        recommended: 'approve', advice: { value: { decision: 'approve', edited: false }, rationale: 'Short and accurate.' },
      },
    ],
  },
};

/** New Rounds arrive from this pool, one about every 40 s, cycling. */
export const ARRIVALS = [
  {
    session: 's_2b7f90', title: 'Confirm the currency rounding rule',
    policy: { on_timeout: 'apply_recommended', after_seconds: 120 },
    questions: [
      {
        id: 'rounding', kind: 'single', prompt: 'How should line totals round?',
        options: [{ id: 'half_even', label: 'Half to even (banker’s)' }, { id: 'half_up', label: 'Half up' }, { id: 'truncate', label: 'Truncate' }],
        recommended: 'half_even', advice: { value: { selected: 'half_even' }, rationale: 'The billing design doc specifies banker’s rounding.' },
      },
      {
        id: 'backfill', kind: 'approve', prompt: 'Recompute totals for open invoices?',
        proposal: { format: 'command', value: 'bun run invoices:recompute --status=open --dry-run=false', editable: true },
        recommended: 'reject', advice: { value: { decision: 'reject', edited: false }, rationale: 'Touches money; run with --dry-run first.' },
      },
    ],
  },
  {
    session: 's_9c41e2', title: 'Run the API contract tests?',
    policy: { on_timeout: 'cancel', after_seconds: 100 },
    questions: [
      {
        id: 'run', kind: 'approve', prompt: 'Run the contract tests against staging?',
        proposal: { format: 'command', value: 'bun test contracts --env=staging', editable: false },
        recommended: 'approve', advice: { value: { decision: 'approve', edited: false }, rationale: 'Read-only against staging.' },
      },
    ],
  },
  {
    session: 's_71d0aa', title: 'Which pages go in the sidebar?',
    policy: { on_timeout: 'wait' },
    questions: [
      {
        id: 'pages', kind: 'multi', prompt: 'Keep which pages in the sidebar?',
        options: [{ id: 'start', label: 'Getting started' }, { id: 'skill', label: 'Hub Skill' }, { id: 'cli', label: 'CLI reference' }, { id: 'faq', label: 'FAQ' }],
        recommended: ['start', 'skill', 'cli'], advice: { value: { selected: ['start', 'skill', 'cli'] }, rationale: 'FAQ has two entries; fold it into Getting started.' },
      },
    ],
  },
  {
    session: 's_e4a913', title: 'Name the CLI subcommand for Advisors',
    policy: { on_timeout: 'apply_recommended', after_seconds: 90 },
    questions: [
      {
        id: 'name', kind: 'text', prompt: 'What should the subcommand be called?', multiline: false, placeholder: 'hermes …',
        recommended: 'hermes advisor', advice: { value: { text: 'hermes advisor' }, rationale: 'Matches the glossary term.' },
      },
    ],
  },
];

/** Ended Rounds already in the answered log when the page opens. */
export const SEED_LOG = [
  {
    session: 's_9c41e2', at: -1800, endedAt: -1740, title: 'Pick a cache eviction policy', outcome: 'answered', delivered: true,
    questions: [{ id: 'policy', kind: 'single', prompt: 'Eviction policy?', options: [{ id: 'lru', label: 'LRU' }, { id: 'lfu', label: 'LFU' }], answer: { value: { selected: 'lru' }, set_by: 'human' } }],
  },
  {
    session: 's_2b7f90', at: -1500, endedAt: -1380, title: 'Bump Node to 22 in CI', outcome: 'expired', delivered: true,
    questions: [{ id: 'bump', kind: 'approve', prompt: 'Bump Node to 22?', recommended: 'approve', answer: { value: { decision: 'approve', edited: false }, set_by: 'policy' } }],
  },
  {
    session: 's_e4a913', at: -1300, endedAt: -1200, title: 'Callsign suffix length', outcome: 'answered', delivered: true,
    questions: [{ id: 'len', kind: 'single', prompt: 'Suffix length?', options: [{ id: 'four', label: '4 characters' }, { id: 'six', label: '6 characters' }], answer: { value: { selected: 'four' }, set_by: 'human', suggested_by: 'Claude · read-only' } }],
  },
  {
    session: 's_5530fc', at: -2700, endedAt: -2640, title: 'Ship the dark launch screen?', outcome: 'dismissed', delivered: false, note: 'Not this release.',
    questions: [{ id: 'ship', kind: 'approve', prompt: 'Ship it?', answer: { value: null, set_by: 'none' } }],
  },
];
