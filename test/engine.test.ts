import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../src/db/db.ts";
import { exitCodeFor, HubError } from "../src/errors.ts";
import { Engine, type Clock, type SessionRow } from "../src/hub/engine.ts";
import type { Round } from "../src/schema/types.ts";

/** A clock the test advances explicitly; Engine.schedule()'s real setTimeout is cancelled after every
 * call, so deadlines only fire when the test calls `engine.fireDue()` itself. */
class FakeClock implements Clock {
  private ms = Date.parse("2026-11-20T00:00:00.000Z");
  now(): number {
    return this.ms;
  }
  advance(seconds: number): void {
    this.ms += seconds * 1000;
  }
}

function newEngine(): { engine: Engine; clock: FakeClock } {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  const clock = new FakeClock();
  const engine = new Engine(db, "http://127.0.0.1:4747", clock);
  return { engine, clock };
}

function session(engine: Engine, label: string): SessionRow {
  const res = engine.upsertSession({ kind: "script", session_key: label, label });
  return engine.sessionFor(res.token);
}

function singleRound(overrides: Partial<Round> = {}): Round {
  return {
    schema: "hermes.round/v1",
    title: "Pick one",
    questions: [{ id: "q1", kind: "single", prompt: "Which?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], recommended: "a" }],
    ...overrides,
  };
}

/** Submits, then cancels Engine's real scheduling timer so the test drives time itself. */
function submit(engine: Engine, s: SessionRow, round: Round) {
  const res = engine.submit(s, round, Buffer.byteLength(JSON.stringify(round)));
  engine.stop();
  return res;
}

function end(fn: () => unknown) {
  const res = fn();
  return res;
}

describe("Round lifecycle", () => {
  test("a Question's policy locks it while the Round stays pending", () => {
    const { engine, clock } = newEngine();
    const s = session(engine, "a1");
    const { round_id } = submit(engine, s, {
      ...singleRound(),
      questions: [
        { id: "fast", kind: "single", prompt: "Fast?", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], recommended: "x", policy: { on_timeout: "apply_recommended", after_seconds: 10 } },
        { id: "slow", kind: "text", prompt: "Slow?" },
      ],
    });
    clock.advance(11);
    end(() => engine.fireDue());
    engine.stop();

    expect(engine.get(s, round_id)).toMatchObject({ status: "pending" });
    const [view] = engine.feed();
    expect(view!.locks).toEqual({ fast: { value: { selected: "x" }, locked_at: expect.any(String) } });
  });

  test("a Round expires when its last open Question locks", () => {
    const { engine, clock } = newEngine();
    const s = session(engine, "a2");
    const { round_id } = submit(engine, s, {
      ...singleRound(),
      policy: { on_timeout: "apply_recommended", after_seconds: 10 },
    });
    clock.advance(11);
    end(() => engine.fireDue());
    engine.stop();

    const answer = engine.get(s, round_id);
    expect(answer).toMatchObject({ outcome: "expired", questions: { q1: { value: { selected: "a" }, set_by: "policy" } } });
  });

  test("supersede keeps the queue position and carries a matching Draft", () => {
    const { engine, clock } = newEngine();
    const s = session(engine, "b1");
    const other = session(engine, "filler");
    const { round_id: first } = submit(engine, s, singleRound());
    engine.saveDraft(first, { questions: { q1: { value: { selected: "b" } } }, note: "keep me" });
    clock.advance(1);
    submit(engine, other, { ...singleRound(), title: "filler" }); // arrives after `first`, in its own session

    const { round_id: second } = submit(engine, s, { ...singleRound(), title: "v2", supersedes: first });

    expect(engine.get(s, first)).toMatchObject({ outcome: "cancelled", cancelled_by: "agent", superseded_by: second });
    const feed = engine.feed();
    const filler = feed.find((v) => v.round.title === "filler")!;
    const replaced = feed.find((v) => v.id === second)!;
    expect(replaced.position).toBeLessThan(filler.position); // v2 kept v1's earlier position
    expect(replaced.draft).toEqual({ questions: { q1: { value: { selected: "b" } } } }); // the lifecycle spec carries Question Drafts only, not the Round note
  });

  test("idempotency: same key and body replays; same key, different body conflicts", () => {
    const { engine } = newEngine();
    const s = session(engine, "c1");
    const round = { ...singleRound(), idempotency_key: "k1" };
    const first = submit(engine, s, round);
    const replay = submit(engine, s, round);
    expect(replay).toMatchObject({ round_id: first.round_id, replay: true });

    expect(() => submit(engine, s, { ...singleRound(), title: "different", idempotency_key: "k1" })).toThrow(HubError);
    try {
      submit(engine, s, { ...singleRound(), title: "different", idempotency_key: "k1" });
      throw new Error("expected a HubError");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).code).toBe("idempotency_conflict");
    }
  });

  test("the flood cap rejects an 11th pending Round for the same session", () => {
    const { engine } = newEngine();
    const s = session(engine, "d1");
    for (let i = 0; i < 10; i++) submit(engine, s, { ...singleRound(), title: `r${i}` });
    try {
      submit(engine, s, { ...singleRound(), title: "r10" });
      throw new Error("expected a HubError");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).code).toBe("flood_cap");
      expect((err as HubError).extra).toMatchObject({ limit: 10 });
    }
  });

  test("a superseding submission after the old Round ended is rejected with round_ended", () => {
    const { engine } = newEngine();
    const s = session(engine, "e1");
    const { round_id } = submit(engine, s, singleRound());
    engine.send(round_id, { questions: { q1: { value: { selected: "a" } } } });
    try {
      submit(engine, s, { ...singleRound(), supersedes: round_id });
      throw new Error("expected a HubError");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).code).toBe("round_ended");
      expect((err as HubError).extra).toMatchObject({ round_id, outcome: "answered" });
    }
  });

  test("dismiss and redirect leave open Questions unset but keep Locked values", () => {
    const { engine, clock } = newEngine();
    const s = session(engine, "f1");
    const { round_id } = submit(engine, s, {
      ...singleRound(),
      questions: [
        { id: "locked", kind: "single", prompt: "?", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], recommended: "x", policy: { on_timeout: "apply_recommended", after_seconds: 10 } },
        { id: "open", kind: "text", prompt: "?", required: false },
      ],
    });
    clock.advance(11);
    engine.fireDue();
    engine.stop();
    const answer = engine.dismiss(round_id, { note: "not now" });
    expect(answer).toMatchObject({
      outcome: "dismissed",
      note: "not now",
      questions: { locked: { value: { selected: "x" }, set_by: "policy" }, open: { value: null, set_by: "none" } },
    });
  });

  test("redirect requires a message and is delivered as the outcome's instruction", () => {
    const { engine } = newEngine();
    const s = session(engine, "f2");
    const { round_id } = submit(engine, s, singleRound());
    const answer = engine.redirect(round_id, { message: "ask again tomorrow" });
    expect(answer).toMatchObject({ outcome: "redirected", message: "ask again tomorrow" });
  });

  test("edit-then-approve marks the Question edited and keeps the Human's proposal value", () => {
    const { engine } = newEngine();
    const s = session(engine, "g1");
    const round: Round = {
      schema: "hermes.round/v1",
      title: "Run it?",
      questions: [{ id: "run", kind: "approve", prompt: "Run?", proposal: { format: "command", value: "deploy", editable: true } }],
    };
    const { round_id } = submit(engine, s, round);
    const answer = engine.send(round_id, { questions: { run: { value: { decision: "approve", edited: true, proposal: "deploy --dry-run" } } } });
    expect(answer.questions.run).toEqual({ value: { decision: "approve", edited: true, proposal: "deploy --dry-run" }, set_by: "human" });
  });

  test("apply_recommended with no recommended value is rejected at submit", () => {
    const { engine } = newEngine();
    const s = session(engine, "h1");
    const round: Round = {
      schema: "hermes.round/v1",
      title: "Bad policy",
      questions: [{ id: "q", kind: "text", prompt: "?", policy: { on_timeout: "apply_recommended", after_seconds: 10 } }],
    };
    try {
      submit(engine, s, round);
      throw new Error("expected a HubError");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).code).toBe("invalid_round");
    }
  });
});

describe("CLI exit codes (transports spec)", () => {
  test.each([
    ["hub_unavailable", 3],
    ["unknown_session", 5],
    ["forbidden", 5],
    ["invalid_round", 4],
    ["too_large", 4],
    ["unsupported_schema", 4],
    ["idempotency_conflict", 4],
    ["round_ended", 4],
    ["flood_cap", 4],
    ["not_found", 4],
    ["advisor_cannot_ask", 4],
  ] as const)("%s -> exit %i", (code, exit) => {
    expect(exitCodeFor(code)).toBe(exit);
  });
});

describe("Agent roster (agent-identity spec)", () => {
  test("two Live sessions with the same callsign both get a 4-character suffix", () => {
    const { engine } = newEngine();
    engine.upsertSession({ kind: "claude-code", session_key: "k1", label: "api" });
    engine.upsertSession({ kind: "claude-code", session_key: "k2", label: "api" });
    const roster = engine.roster();
    const callsigns = roster.map((a) => a.callsign).sort();
    expect(callsigns[0]).toMatch(/^CLAUDE·api·[0-9a-f]{4}$/);
    expect(callsigns[1]).toMatch(/^CLAUDE·api·[0-9a-f]{4}$/);
    expect(callsigns[0]).not.toBe(callsigns[1]);
  });

  test("one session with that callsign gets no suffix", () => {
    const { engine } = newEngine();
    engine.upsertSession({ kind: "claude-code", session_key: "k1", label: "api" });
    expect(engine.roster()[0]!.callsign).toBe("CLAUDE·api");
  });

  test("liveness: an open wait is Live regardless of last_seen", () => {
    const { engine, clock } = newEngine();
    const { token } = engine.upsertSession({ kind: "script", session_key: "w1" });
    const s = engine.sessionFor(token);
    const { round_id } = submit(engine, s, singleRound());
    clock.advance(40 * 60); // past the Idle threshold
    const waiting = engine.wait(s, round_id, 10);
    expect(engine.roster().find((a) => a.id === s.id)!.liveness).toBe("live");
    engine.send(round_id, { questions: { q1: { value: { selected: "a" } } } });
    void waiting;
  });

  test("liveness buckets by last_seen without an open wait", () => {
    const { engine, clock } = newEngine();
    engine.upsertSession({ kind: "script", session_key: "oldest" }); // ages the most
    clock.advance(1400); // 23m20s
    engine.upsertSession({ kind: "script", session_key: "middle" });
    clock.advance(540); // 9m
    engine.upsertSession({ kind: "script", session_key: "freshest" }); // ages the least
    clock.advance(60); // 1m
    const byKey = (key: string) => engine.roster().find((a) => a.session_key === key)!.liveness;
    expect(byKey("oldest")).toBe("gone"); // 2000s old, over the 1800s Idle threshold
    expect(byKey("middle")).toBe("idle"); // 600s old
    expect(byKey("freshest")).toBe("live"); // 60s old
  });

  test("Forget: the session disappears from the roster, cancels its pending Rounds, and a later contact brings it back", () => {
    const { engine } = newEngine();
    const res = engine.upsertSession({ kind: "script", session_key: "f2" });
    const s = engine.sessionFor(res.token);
    const { round_id } = submit(engine, s, singleRound());
    engine.forget(res.session_id);
    expect(engine.roster().some((a) => a.id === res.session_id)).toBe(false);
    expect(engine.get(s, round_id)).toMatchObject({ outcome: "cancelled", cancelled_by: "human" });
    engine.upsertSession({ kind: "script", session_key: "f2" });
    expect(engine.roster().some((a) => a.id === res.session_id)).toBe(true);
  });

  test("resume handles are derived from kind and session key", () => {
    const { engine } = newEngine();
    engine.upsertSession({ kind: "claude-code", session_key: "sess-abc" });
    engine.upsertSession({ kind: "script", session_key: "sess-xyz" });
    const byKey = (key: string) => engine.roster().find((a) => a.session_key === key)!.resume;
    expect(byKey("sess-abc")).toBe("claude --resume sess-abc");
    expect(byKey("sess-xyz")).toBeNull();
  });
});
