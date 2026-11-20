import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Server } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdvisorConfig, AutoAskRule } from "../src/config.ts";
import { migrate } from "../src/db/db.ts";
import { Engine, type Clock, type HubEvent, type SessionRow } from "../src/hub/engine.ts";
import { startServer } from "../src/hub/server.ts";
import type { Round } from "../src/schema/types.ts";

/** A clock the test advances explicitly; real wall-clock time still governs the spawned processes. */
class FakeClock implements Clock {
  private ms = Date.parse("2026-11-20T00:00:00.000Z");
  now(): number {
    return this.ms;
  }
  advance(seconds: number): void {
    this.ms += seconds * 1000;
  }
}

function newEngine(config: { advisors: AdvisorConfig[]; autoAsk?: AutoAskRule[] }): { engine: Engine; db: Database; clock: FakeClock } {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  const clock = new FakeClock();
  const engine = new Engine(db, "http://127.0.0.1:4747", clock, { advisors: config.advisors, autoAsk: config.autoAsk ?? [] });
  return { engine, db, clock };
}

function session(engine: Engine, label: string, cwd?: string): SessionRow {
  const res = engine.upsertSession({ kind: "script", session_key: label, label, ...(cwd ? { cwd } : {}) });
  return engine.sessionFor(res.token);
}

function submit(engine: Engine, s: SessionRow, round: Round) {
  const res = engine.submit(s, round, Buffer.byteLength(JSON.stringify(round)));
  engine.stop();
  return res;
}

const textRound: Round = {
  schema: "hermes.round/v1",
  title: "Two Questions",
  questions: [
    { id: "empty_q", kind: "text", prompt: "Empty?" },
    { id: "set_q", kind: "text", prompt: "Already set?" },
  ],
};

/** A throwaway Advisor script run by `bun <path>`; writes it under a fresh temp dir and cleans it up. */
function stub(body: string): { dir: string; advisor: AdvisorConfig; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "hermes-advisor-stub-"));
  const path = join(dir, "advisor.mjs");
  writeFileSync(path, body);
  return {
    dir,
    advisor: { name: "stub", command: [process.execPath, path], timeout_seconds: 300 },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Waits for the next event of `type` whose `view.id` (if any) matches `roundId`. Advisor runs are real
 * OS processes (the whole point of this spec), so there is no fake clock to drive here; `ms` is only a
 * watchdog backstop against a genuinely hung test, not a stand-in for the awaited condition itself.
 */
function waitFor<T extends HubEvent["type"]>(engine: Engine, type: T, roundId: string, ms = 4000): Promise<Extract<HubEvent, { type: T }>> {
  type Matched = Extract<HubEvent, { type: T }>;
  const { promise, resolve, reject } = Promise.withResolvers<Matched>();
  const timer = setTimeout(() => {
    off();
    reject(new Error(`timed out waiting for ${type} on ${roundId}`));
  }, ms);
  const off = engine.subscribe((e) => {
    if (e.type !== type) return;
    const id = "view" in e ? e.view?.id : "round_id" in e ? e.round_id : undefined;
    if (id !== roundId) return;
    clearTimeout(timer);
    off();
    resolve(e as Matched);
  });
  return promise;
}

describe("Advisors and auto-ask (delegation spec)", () => {
  test("only an empty, open Question is filled from the Suggestion; an already-set one is untouched", async () => {
    const { advisor, cleanup } = stub(`
      console.log(JSON.stringify({
        schema: "hermes.suggestion/v1",
        summary: "test",
        questions: {
          empty_q: { value: { text: "from advisor" }, rationale: "because" },
          set_q: { value: { text: "should not appear" }, rationale: "nope" },
        },
      }));
    `);
    try {
      const { engine } = newEngine({ advisors: [advisor] });
      const s = session(engine, "a1");
      const { round_id } = submit(engine, s, textRound);
      engine.saveDraft(round_id, { questions: { set_q: { value: { text: "human's own answer" } } } });

      engine.askAdvisor(round_id, "stub", undefined, "manual");
      const ended = await waitFor(engine, "advisor.ended", round_id);

      expect(ended.view.advisor_runs[0]).toMatchObject({ status: "succeeded", advisor_name: "stub" });
      expect(ended.view.draft?.questions?.empty_q).toEqual({ value: { text: "from advisor" } });
      expect(ended.view.draft?.questions?.set_q).toEqual({ value: { text: "human's own answer" } });
      expect(ended.view.suggestion?.questions.set_q).toEqual({ value: { text: "should not appear" }, rationale: "nope" });
    } finally {
      cleanup();
    }
  });

  test("a value sent unchanged from the Suggestion carries suggested_by; an edited one does not", async () => {
    const { advisor, cleanup } = stub(`
      console.log(JSON.stringify({
        schema: "hermes.suggestion/v1",
        questions: { empty_q: { value: { text: "from advisor" } }, set_q: { value: { text: "also suggested" } } },
      }));
    `);
    try {
      const { engine } = newEngine({ advisors: [advisor] });
      const s = session(engine, "b1");
      const { round_id } = submit(engine, s, textRound);

      engine.askAdvisor(round_id, "stub", undefined, "manual");
      await waitFor(engine, "advisor.ended", round_id);

      const answer = engine.send(round_id, {
        questions: {
          empty_q: { value: { text: "from advisor" } }, // unchanged
          set_q: { value: { text: "human edited this" } }, // edited
        },
      });
      expect(answer.questions.empty_q).toMatchObject({ value: { text: "from advisor" }, set_by: "human", suggested_by: "stub" });
      expect(answer.questions.set_q).toMatchObject({ value: { text: "human edited this" }, set_by: "human" });
      expect(answer.questions.set_q?.suggested_by).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("starting a second Advisor run on the same Round cancels the first", async () => {
    // Runs as a separate OS process; a real delay is the point (it must still be running when the
    // second Advisor is asked, below), not a stand-in for a condition this test could await instead.
    const { advisor: slow, cleanup: cleanupSlow } = stub(`
      await new Promise((r) => setTimeout(r, 3000));
      console.log(JSON.stringify({ schema: "hermes.suggestion/v1", questions: { empty_q: { value: { text: "slow" } } } }));
    `);
    const { advisor: fast, cleanup: cleanupFast } = stub(`
      console.log(JSON.stringify({ schema: "hermes.suggestion/v1", questions: { empty_q: { value: { text: "fast" } } } }));
    `);
    try {
      const { engine } = newEngine({ advisors: [{ ...slow, name: "slow" }, { ...fast, name: "fast" }] });
      const s = session(engine, "c1");
      const { round_id } = submit(engine, s, textRound);

      engine.askAdvisor(round_id, "slow", undefined, "manual");
      engine.askAdvisor(round_id, "fast", undefined, "manual");
      // Both runs settle independently (the slow one is cancelled almost at once, the fast one exits on
      // its own); wait until neither advisor_runs entry is still "running".
      let ended = await waitFor(engine, "advisor.ended", round_id);
      while (ended.view.advisor_runs.some((r) => r.status === "running")) {
        ended = await waitFor(engine, "advisor.ended", round_id);
      }

      expect(ended.view.advisor_runs).toHaveLength(2);
      const fastRun = ended.view.advisor_runs.find((r) => r.advisor_name === "fast");
      const slowRun = ended.view.advisor_runs.find((r) => r.advisor_name === "slow");
      expect(fastRun).toMatchObject({ status: "succeeded" });
      expect(slowRun).toMatchObject({ status: "cancelled" });
    } finally {
      cleanupSlow();
      cleanupFast();
    }
  });

  test("a Round ending stops its running Advisor process", async () => {
    // Runs as a separate OS process; real (not faked) because it must still be running when the
    // Round ends, below, so the Hub actually has something live to kill.
    const { advisor, cleanup } = stub(`
      await new Promise((r) => setTimeout(r, 3000));
      console.log(JSON.stringify({ schema: "hermes.suggestion/v1", questions: { empty_q: { value: { text: "too late" } } } }));
    `);
    try {
      const { engine } = newEngine({ advisors: [advisor] });
      const s = session(engine, "d1");
      const { round_id } = submit(engine, s, textRound);

      engine.askAdvisor(round_id, "stub", undefined, "manual");
      const endedPromise = waitFor(engine, "advisor.ended", round_id);
      engine.dismiss(round_id, {});
      const ended = await endedPromise;
      expect(ended.view.advisor_runs[0]).toMatchObject({ status: "cancelled" });
    } finally {
      cleanup();
    }
  });

  test("an invalid or missing Suggestion is recorded as failed, with the raw output kept for the unparsed briefing", async () => {
    const { advisor, cleanup } = stub(`console.log("not a suggestion, just prose.");`);
    try {
      const { engine } = newEngine({ advisors: [advisor] });
      const s = session(engine, "e1");
      const { round_id } = submit(engine, s, textRound);

      engine.askAdvisor(round_id, "stub", undefined, "manual");
      const ended = await waitFor(engine, "advisor.ended", round_id);

      expect(ended.view.advisor_runs[0]).toMatchObject({ status: "failed", suggestion: null });
      expect(ended.view.advisor_runs[0]!.raw_output).toContain("not a suggestion");
      expect(ended.view.suggestion).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("a run that outlives its timeout is SIGTERMed and recorded as timed_out", async () => {
    // Runs as a separate OS process; real because the subject under test is the Hub's own
    // `timeout_seconds` timer actually firing and SIGTERM reaching a live process.
    const { advisor, cleanup } = stub(`
      await new Promise((r) => setTimeout(r, 5000));
      console.log(JSON.stringify({ schema: "hermes.suggestion/v1", questions: {} }));
    `);
    try {
      const { engine } = newEngine({ advisors: [{ ...advisor, timeout_seconds: 1 }] });
      const s = session(engine, "f1");
      const { round_id } = submit(engine, s, textRound);

      engine.askAdvisor(round_id, "stub", undefined, "manual");
      const ended = await waitFor(engine, "advisor.ended", round_id, 8000);
      expect(ended.view.advisor_runs[0]).toMatchObject({ status: "timed_out" });
    } finally {
      cleanup();
    }
  }, 10000);

  test("auto-ask starts the configured Advisor as soon as a matching Round arrives", async () => {
    const { advisor, cleanup } = stub(`
      console.log(JSON.stringify({ schema: "hermes.suggestion/v1", questions: { empty_q: { value: { text: "auto" } } } }));
    `);
    try {
      const { engine } = newEngine({
        advisors: [advisor],
        autoAsk: [{ kind: "script", project: "/some/project", advisor: "stub" }],
      });
      const s = session(engine, "g1", "/some/project");
      const { round_id } = submit(engine, s, textRound);
      const ended = await waitFor(engine, "advisor.ended", round_id);
      expect(ended.view.advisor_runs[0]).toMatchObject({ advisor_name: "stub", trigger: "auto", status: "succeeded" });
    } finally {
      cleanup();
    }
  });

  test("Locked Questions ignore the Suggestion", async () => {
    const { advisor, cleanup } = stub(`
      console.log(JSON.stringify({ schema: "hermes.suggestion/v1", questions: { fast: { value: { selected: "x" } }, open: { value: { text: "hi" } } } }));
    `);
    try {
      const { engine, clock } = newEngine({ advisors: [advisor] });
      const s = session(engine, "h1");
      const round: Round = {
        schema: "hermes.round/v1",
        title: "Locked",
        questions: [
          {
            id: "fast",
            kind: "single",
            prompt: "Fast?",
            options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }],
            recommended: "y",
            policy: { on_timeout: "apply_recommended", after_seconds: 10 },
          },
          { id: "open", kind: "text", prompt: "Open?", required: false },
        ],
      };
      const { round_id } = submit(engine, s, round);
      clock.advance(11);
      engine.fireDue(); // locks "fast"
      engine.stop();

      engine.askAdvisor(round_id, "stub", undefined, "manual");
      const ended = await waitFor(engine, "advisor.ended", round_id);
      expect(ended.view.draft?.questions?.fast).toBeUndefined();
      expect(ended.view.draft?.questions?.open).toEqual({ value: { text: "hi" } });
    } finally {
      cleanup();
    }
  });
});

describe("no loops: an Advisor process cannot ask the Human (delegation spec)", () => {
  function freePort(): number {
    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const { port } = probe;
    probe.stop(true);
    return port;
  }

  test("the Hub's own spawned Advisor, with HERMES_ADVISOR set, gets advisor_cannot_ask calling back in", async () => {
    const { advisor, cleanup } = stub(`
      const res = await fetch(process.env.HERMES_TEST_HUB_URL + "/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Hermes-Advisor": process.env.HERMES_ADVISOR },
        body: JSON.stringify({ kind: "script", session_key: "selfcheck" }),
      });
      const body = await res.json();
      console.log(JSON.stringify({
        schema: "hermes.suggestion/v1",
        summary: \`selfcheck:\${res.status}:\${body.code}\`,
        questions: { q: { value: { text: "ok" } } },
      }));
    `);
    let server: Server<undefined> | undefined;
    try {
      const db = new Database(":memory:", { strict: true });
      migrate(db);
      const port = freePort();
      const url = `http://127.0.0.1:${port}`;
      const engine = new Engine(db, url, undefined, { advisors: [advisor], autoAsk: [] });
      server = await startServer(engine, port);

      const s = session(engine, "selfcheck-session");
      const round: Round = { schema: "hermes.round/v1", title: "T", questions: [{ id: "q", kind: "text", prompt: "?" }] };
      const { round_id } = submit(engine, s, round);

      process.env.HERMES_TEST_HUB_URL = url;
      engine.askAdvisor(round_id, "stub", undefined, "manual");
      const ended = await waitFor(engine, "advisor.ended", round_id);
      expect(ended.view.advisor_runs[0]?.suggestion?.summary).toBe("selfcheck:403:advisor_cannot_ask");
    } finally {
      delete process.env.HERMES_TEST_HUB_URL;
      server?.stop(true);
      cleanup();
    }
  });
});
