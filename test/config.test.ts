import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfigDetailed } from "../src/config.ts";
import { reloadConfig, watchConfig } from "../src/hub/configWatcher.ts";

function tmpConfig(contents?: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "hermes-config-test-"));
  const path = join(dir, "config.toml");
  if (contents !== undefined) writeFileSync(path, contents);
  return { dir, path };
}

describe("config", () => {
  test("a missing file is every default", () => {
    const { dir, path } = tmpConfig();
    try {
      const { config, sources } = loadConfigDetailed(path);
      expect(config).toEqual(DEFAULT_CONFIG);
      expect(sources.port).toBe("default");
      expect(sources.log_level).toBe("default");
      expect(sources.limits.live_ms).toBe("default");
      expect(sources.backups.keep).toBe("default");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the file overrides only the fields it sets; the rest default", () => {
    const { dir, path } = tmpConfig(`port = 5050\nlog_level = "debug"\n\n[limits]\nlive_ms = 60000\n`);
    try {
      const { config, sources } = loadConfigDetailed(path);
      expect(config.port).toBe(5050);
      expect(config.log_level).toBe("debug");
      expect(config.limits.live_ms).toBe(60000);
      expect(config.limits.idle_ms).toBe(DEFAULT_CONFIG.limits.idle_ms);
      expect(config.backups.keep).toBe(DEFAULT_CONFIG.backups.keep);
      expect(sources.port).toBe("file");
      expect(sources.log_level).toBe("file");
      expect(sources.limits.live_ms).toBe("file");
      expect(sources.limits.idle_ms).toBe("default");
      expect(sources.backups.keep).toBe("default");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an invalid value throws, naming the path and the field", () => {
    const { dir, path } = tmpConfig(`port = 999999\n`);
    try {
      expect(() => loadConfigDetailed(path)).toThrow(/port/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("malformed TOML throws", () => {
    const { dir, path } = tmpConfig(`this is not = = toml [[[`);
    try {
      expect(() => loadConfigDetailed(path)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reloadConfig: a non-port change applies live", () => {
    const { dir, path } = tmpConfig(`port = 4747\nlog_level = "info"\n`);
    try {
      const previous = loadConfigDetailed(path).config;
      writeFileSync(path, `port = 4747\nlog_level = "debug"\n`);
      const reload = reloadConfig(path, previous);
      expect(reload.restartNeeded).toBe(false);
      expect(reload.config.log_level).toBe("debug");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reloadConfig: a port change is held back (restartNeeded), everything else still applies", () => {
    const { dir, path } = tmpConfig(`port = 4747\n`);
    try {
      const previous = loadConfigDetailed(path).config;
      writeFileSync(path, `port = 5000\nlog_level = "debug"\n`);
      const reload = reloadConfig(path, previous);
      expect(reload.restartNeeded).toBe(true);
      expect(reload.config.port).toBe(4747);
      expect(reload.config.log_level).toBe("debug");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reloadConfig: an invalid edit throws instead of returning a partial config", () => {
    const { dir, path } = tmpConfig(`port = 4747\n`);
    try {
      const previous = loadConfigDetailed(path).config;
      writeFileSync(path, `port = "not a number"\n`);
      expect(() => reloadConfig(path, previous)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(
    "watchConfig: a live edit applies without restarting; an invalid edit reports an error and keeps the old config",
    async () => {
      const { dir, path } = tmpConfig(`port = 4747\nlog_level = "info"\n`);
      let current = loadConfigDetailed(path).config;
      const errors: string[] = [];
      const stop = watchConfig(
        path,
        () => current,
        (reload) => {
          current = reload.config;
        },
        (err) => {
          errors.push(err.message);
        },
      );
      // fs.watch is a real OS-level, async filesystem event with no clock to fake; poll tightly
      // (20ms, capped at 5s) rather than guess a fixed sleep. reloadConfig() above is the
      // deterministic test for the reload logic itself; this just exercises the real wiring.
      try {
        writeFileSync(path, `port = 4747\nlog_level = "debug"\n`);
        const applyDeadline = Date.now() + 5000;
        while (current.log_level !== "debug" && Date.now() < applyDeadline) await Bun.sleep(20);
        expect(current.log_level).toBe("debug");

        writeFileSync(path, `port = "nope"\n`);
        const errorDeadline = Date.now() + 5000;
        while (errors.length === 0 && Date.now() < errorDeadline) await Bun.sleep(20);
        expect(errors.length).toBeGreaterThan(0);
        expect(current.log_level).toBe("debug"); // the watcher never applied the invalid edit
      } finally {
        stop();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    15_000,
  );
});
