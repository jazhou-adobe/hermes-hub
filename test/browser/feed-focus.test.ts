/**
 * Browser checks of the Command Center against a real Hub (in-memory database, production bundle),
 * driven through the installed Chrome with puppeteer-core. Opt-in: `bun run test:browser`
 * (HERMES_BROWSER_TESTS=1). Plain `bun test` skips them, so machines without a browser stay green.
 * Chrome is found at CHROME_PATH, else the default macOS install.
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type AxeCore from "axe-core";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { migrate } from "../../src/db/db.ts";
import { Engine } from "../../src/hub/engine.ts";
import { startServer } from "../../src/hub/server.ts";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const enabled = process.env.HERMES_BROWSER_TESTS === "1" && existsSync(CHROME);

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  return port;
}

let url = "";
let engine: Engine | undefined;
let token = "";
let stopServer: () => void = () => {};
let browser: Browser | undefined;

async function ask(round: object): Promise<string> {
  const res = await fetch(`${url}/v1/rounds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Hermes-Session": token },
    body: JSON.stringify({ schema: "hermes.round/v1", ...round }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).round_id;
}

function textRound(title: string) {
  return {
    title,
    context: "A Round with enough content to make the Feed scroll.",
    questions: [
      { id: "pick", kind: "single", prompt: `Pick one for ${title}`, options: [{ id: "a", label: "Option A" }, { id: "b", label: "Option B" }, { id: "c", label: "Option C" }] },
      { id: "why", kind: "text", prompt: `Why, for ${title}?` },
    ],
  };
}

async function openFeed(width: number, height: number): Promise<Page> {
  const page = await browser!.newPage();
  await page.setViewport({ width, height });
  await page.goto(`${url}/`, { waitUntil: "load" });
  await page.waitForSelector(".hh-feed-item");
  return page;
}

describe.skipIf(!enabled)("Command Center in Chrome", () => {
  beforeAll(async () => {
    const db = new Database(":memory:", { strict: true });
    migrate(db);
    const port = freePort();
    url = `http://127.0.0.1:${port}`;
    engine = new Engine(db, url);
    const server = await startServer(engine, port);
    stopServer = () => void server.stop(true);
    token = engine.upsertSession({ kind: "claude-code", session_key: "focus-test", label: "api", cwd: "/tmp/api" }).token;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    stopServer();
  });

  test("a live Round arriving while the Human types never moves focus or scroll", async () => {
    const first = await ask(textRound("First Round"));
    const second = await ask(textRound("Second Round"));
    const page = await openFeed(1440, 900);
    await page.waitForSelector(`#${second}`);

    // Type into the second Round's free-text field, scrolled into the middle of the page.
    const field = `#${second}-why-t`;
    await page.$eval(field, (el) => el.scrollIntoView({ block: "center" }));
    await page.click(field);
    await page.keyboard.type("hello");
    const before = await page.evaluate(() => ({ active: document.activeElement?.id, scrollY: window.scrollY, scrollX: window.scrollX }));
    expect(before.active).toBe(`${second}-why-t`);
    expect(before.scrollY).toBeGreaterThan(0);

    // A new Round arrives through the Agent API while the Human keeps typing.
    const third = await ask(textRound("Third Round"));
    await page.waitForSelector(`#${third}`);
    await page.waitForFunction((t) => document.querySelector('[role="status"][aria-live="polite"]')?.textContent?.includes(t), {}, "Third Round");
    await page.keyboard.type(" world");

    const after = await page.evaluate((f) => ({
      active: document.activeElement?.id,
      scrollY: window.scrollY,
      scrollX: window.scrollX,
      value: (document.querySelector(f) as HTMLTextAreaElement).value,
      order: [...document.querySelectorAll(".hh-feed-list > .hh-feed-item")].map((el) => el.id),
      toast: document.querySelector(".hh-toast-region")?.textContent ?? "",
    }), field);
    expect(after.active).toBe(before.active);
    expect(after.scrollY).toBe(before.scrollY);
    expect(after.scrollX).toBe(before.scrollX);
    expect(after.value).toBe("hello world");
    expect(after.order).toEqual([first, second, third]); // appended at the end, arrival order
    expect(after.toast).toContain("Third Round");
    await page.close();
  });

  test("keys answer and send the Round in view; focus then advances to the next Pending Round", async () => {
    for (const view of engine!.feed()) if (view.status === "pending") engine!.dismiss(view.id, {});
    const a = await ask({ title: "Keys A", questions: [{ id: "q", kind: "single", prompt: "A?", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] }] });
    const b = await ask({ title: "Keys B", questions: [{ id: "q", kind: "approve", prompt: "B?" }] });
    const page = await openFeed(1440, 900);
    await page.waitForSelector(`#${b}`);
    await page.click("#feed-h");
    await page.keyboard.press("2"); // option 2 of the current Question of the Round in view
    expect(await page.$eval(`#${a} input[value="y"]`, (el) => (el as HTMLInputElement).checked)).toBe(true);
    await page.click("#feed-h");
    await page.keyboard.down("Meta");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Meta");
    await page.waitForFunction((id) => !document.getElementById(id), {}, a);
    await page.waitForFunction((id) => document.activeElement?.id === `${id}-h`, {}, b);
    expect(engine!.roundDetail(a).view.answer).toMatchObject({ outcome: "answered", questions: { q: { value: { selected: "y" } } } });

    // Single keys never fire inside a text field; `r` rejects the approve Question once focus leaves it.
    await page.click(`#${b} .hh-notes-summary`);
    await page.click(`#${b}-notes`);
    await page.keyboard.type("r");
    expect(await page.$eval(`#${b} input[value="reject"]`, (el) => (el as HTMLInputElement).checked)).toBe(false);
    await page.click(`#${b}-h`);
    await page.keyboard.press("r");
    expect(await page.$eval(`#${b} input[value="reject"]`, (el) => (el as HTMLInputElement).checked)).toBe(true);
    await page.close();
  });

  test("reduced motion collapses every --hh-motion-* token", async () => {
    const page = await openFeed(1440, 900);
    const read = () =>
      page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return Object.fromEntries(
          ["fast", "standard", "panel", "signature", "pulse", "stagger"].map((n) => [n, style.getPropertyValue(`--hh-motion-${n}`).trim()]),
        );
      });
    const normal = await read();
    expect(normal.panel).toBe(".24s"); // 240ms in themes.css, as the minified bundle writes it
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    const reduced = await read();
    for (const value of Object.values(reduced)) expect(value).toBe("1ms");
    await page.close();
  });

  test("axe-core (WCAG 2.2 AA tags) reports no violations on any surface", async () => {
    const pending = await ask({
      title: "Axe Round",
      context: "Checks **every** Question kind with `code`, [a link](https://example.com) and Attachments.",
      policy: { on_timeout: "apply_recommended", after_seconds: 45 },
      questions: [
        { id: "one", kind: "single", prompt: "One?", recommended: "a", allow_other: true, options: [{ id: "a", label: "A", detail: "The *first*" }, { id: "b", label: "B" }] },
        { id: "many", kind: "multi", prompt: "Many?", recommended: ["a"], options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
        { id: "text", kind: "text", prompt: "Text?", recommended: "Use this", required: false, policy: { on_timeout: "wait" } },
        {
          id: "ok",
          kind: "approve",
          prompt: "Run it?",
          recommended: "approve",
          proposal: { format: "command", value: "make deploy", editable: true },
          attachments: [{ kind: "diff", path: "a.txt", content: [" a", ...Array.from({ length: 9 }, (_, i) => ` same ${i}`), "-old", "+new"].join("\n") }],
        },
      ],
    });
    const axeSource = await Bun.file(require.resolve("axe-core/axe.min.js")).text();
    const answered = engine!.log()[0]!.meta.round_id;
    for (const path of ["/", `/rounds/${pending}`, `/rounds/${answered}`, "/log", "/agents", "/settings"]) {
      const page = await browser!.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${url}${path}`, { waitUntil: "load" });
      await page.waitForSelector("main section");
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), { timeout: 10_000 }).catch(async () => {
        throw new Error(`${path} still loading: ${await page.$eval("main", (m) => m.textContent)}`);
      });
      await page.evaluate(axeSource);
      const violations = await page.evaluate(async () => {
        // axe-core was injected as a page global just above; the page has no types for it.
        const injected = window as unknown as { axe: typeof AxeCore };
        const result = await injected.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
        return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
      });
      expect({ path, violations }).toEqual({ path, violations: [] });
      await page.close();
    }
  }, 60_000);
});
