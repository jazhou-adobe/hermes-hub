import { useEffect, useState, type CSSProperties } from "react";
import { callsignTone, countdown, hhmmss, plural } from "../format.ts";
import { linkClick } from "../router.ts";
import { useNow, useStore } from "../store.ts";

/** Mission-control chatter for a quiet Feed: station, line. Decorative, so hidden from assistive tech. */
const CHATTER: [string, string][] = [
  ["CAPCOM", "Agents are thinking. Allegedly."],
  ["FIDO", "Trajectory nominal. Nobody needs you."],
  ["COMMS", "Subspace array listening on every band."],
  ["NAV", "Hyperlane clear all the way to the next Round."],
  ["OPS", "Coffee synthesiser status: GO."],
  ["SCIENCE", "Zero anomalies detected. Suspicious."],
  ["RETRO", "Nothing to abort. Yet."],
  ["SURGEON", "Flight director heart rate nominal."],
  ["HELM", "Holding orbit. Hands off the big red button."],
  ["FLIGHT", "Houston, we have no problems."],
];
const CHATTER_MS = 8000;

/** Craft on the scope: up to six live or idle Agents, one per agent colour. */
const MAX_CRAFT = 6;
const RINGS = 3;

interface Craft {
  callsign: string;
  tone: string;
  idle: boolean;
}

function phase(callsign: string): number {
  let h = 7;
  for (const ch of callsign) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return (h % 360) / 360;
}

/** A seeded generator, so the sky is the same on every visit. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Star = [x: number, y: number, r: number, twinkle: boolean];

function stars(seed: number, count: number, w: number, h: number, size: [number, number]): Star[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => [rand() * w, rand() * h, size[0] + rand() * (size[1] - size[0]), rand() < 0.22]);
}

/** Stars inside the chart's -100..100 space. */
const CHART_STARS = stars(11, 24, 200, 200, [0.4, 0.9]).map(([x, y, r, t]): Star => [x - 100, y - 100, r, t]);
/** The open sky behind the full scene, three depths drifting at their own pace (1600 × 1000, sliced to fit). */
const SKY: Star[][] = [stars(3, 140, 1600, 1000, [0.5, 1]), stars(5, 60, 1600, 1000, [0.9, 1.6]), stars(9, 16, 1600, 1000, [1.6, 2.4])];

/** Bearing ticks round the bezel: a long one every 30°, a short one every 10°. */
const TICKS = Array.from({ length: 36 }, (_, i) => i * 10);

function Scope({ craft, full }: { craft: Craft[]; full: boolean }) {
  return (
    <div className="hh-standby-scope" aria-hidden="true">
      <div className="hh-standby-well">
        <svg className="hh-standby-chart" viewBox="-100 -100 200 200" focusable="false">
          {CHART_STARS.map(([x, y, r, twinkle], i) => (
            <circle key={i} className="hh-standby-star" data-twinkle={twinkle || undefined} cx={x} cy={y} r={r} />
          ))}
          <g className="hh-standby-grid">
            <circle className="hh-standby-track" r="34" />
            <circle className="hh-standby-track" r="56" />
            <circle className="hh-standby-track" r="78" />
            <circle r="92" />
            <line x1="-92" y1="0" x2="92" y2="0" />
            <line x1="0" y1="-92" x2="0" y2="92" />
          </g>
          <g className="hh-standby-ticks">
            {TICKS.map((deg) => (
              <line key={deg} x1="0" y1={-92} x2="0" y2={deg % 30 === 0 ? -86 : -89} transform={`rotate(${deg})`} />
            ))}
          </g>
          {full ? (
            <g className="hh-standby-bearings">
              {TICKS.filter((deg) => deg % 30 === 0).map((deg) => {
                const a = ((deg - 90) * Math.PI) / 180;
                return (
                  <text key={deg} x={Math.cos(a) * 96.5} y={Math.sin(a) * 96.5}>
                    {String(deg).padStart(3, "0")}
                  </text>
                );
              })}
            </g>
          ) : null}
          <g className="hh-standby-planet">
            <circle className="hh-standby-atmosphere" r="19" />
            <ellipse className="hh-standby-ring" data-half="back" rx="25" ry="6.5" transform="rotate(-18)" />
            <circle className="hh-standby-globe" r="14" />
            {full ? (
              <g className="hh-standby-bands">
                <path d="M -13.2 -4.5 Q 0 -2 13.2 -4.5" />
                <path d="M -14 1 Q 0 3.5 14 1" />
                <path d="M -11.5 7.5 Q 0 9.5 11.5 7.5" />
              </g>
            ) : null}
            <path d="M 0 -14 A 14 14 0 0 1 0 14 A 6 14 0 0 1 0 -14 Z" className="hh-standby-terminator" />
            <path className="hh-standby-ring" d="M -23.8 7.7 A 25 6.5 -18 0 0 23.8 -7.7" />
          </g>
        </svg>
        <span className="hh-standby-sweep"></span>
        <span className="hh-standby-sky">
          <span className="hh-standby-meteor"></span>
        </span>
        <span className="hh-standby-orbit" data-ring="3" style={{ "--phase": 0.58 } as CSSProperties}>
          <span className="hh-standby-craft" data-relay="true">
            <span className="hh-standby-craft-mark"></span>
            <span className="hh-standby-craft-label">HUB</span>
          </span>
        </span>
        {craft.map((c, i) => (
          <span
            key={c.callsign}
            className="hh-standby-orbit"
            data-ring={(i % RINGS) + 1}
            style={{ "--phase": phase(c.callsign), "--ping-delay": `${i * 0.7}s` } as CSSProperties}
          >
            <span className="hh-standby-craft" data-agent={c.tone} data-idle={c.idle || undefined}>
              <span className="hh-standby-craft-mark"></span>
              <span className="hh-standby-craft-label">{c.callsign}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The open sky of the full scene: three star depths over a faint nebula. */
function Space() {
  return (
    <div className="hh-standby-space" aria-hidden="true">
      {SKY.map((layer, depth) => (
        <svg key={depth} className="hh-standby-depth" data-depth={depth + 1} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
          {layer.map(([x, y, r, twinkle], i) => (
            <circle key={i} className="hh-standby-star" data-twinkle={twinkle || undefined} cx={x} cy={y} r={r} />
          ))}
        </svg>
      ))}
    </div>
  );
}

function Chatter() {
  const [line, setLine] = useState(() => Math.floor(Date.now() / CHATTER_MS) % CHATTER.length);
  useEffect(() => {
    const id = setInterval(() => setLine((n) => (n + 1) % CHATTER.length), CHATTER_MS);
    return () => clearInterval(id);
  }, []);
  const [station, words] = CHATTER[line]!;
  return (
    <p className="hh-standby-chatter" aria-hidden="true">
      <span key={line} className="hh-standby-chatter-line">
        <span className="hh-standby-station">{station}</span> {words}
      </span>
    </p>
  );
}

/**
 * The Feed with nothing pending: a deep-space tracking scope with the session's Agents in orbit, how long the Feed has been
 * quiet, and rotating loop chatter. The full scene is a cinematic backdrop behind the whole shell for an empty Feed;
 * `compact` is a strip above Rounds that ended in place.
 */
export function Standby({ compact }: { compact: boolean }) {
  const agents = useStore((s) => s.agents);
  const rounds = useStore((s) => s.rounds);
  const liveSince = useStore((s) => s.liveSince);
  const now = useNow();

  const onLoop = agents.filter((a) => a.liveness !== "gone");
  const live = onLoop.filter((a) => a.liveness === "live").length;
  const craft = onLoop.slice(0, MAX_CRAFT).map((a) => ({ callsign: a.callsign, tone: callsignTone(a.callsign), idle: a.liveness === "idle" }));
  // Quiet since the last Round ended, or since this tab went Live, whichever is later.
  const quietSince = Math.max(
    liveSince ? Date.parse(liveSince) : 0,
    ...rounds.map((r) => (r.answer?.decided_at ? Date.parse(r.answer.decided_at) : 0)),
  );

  const readouts = (
    <dl className="hh-standby-readouts">
      {quietSince > 0 ? (
        <div>
          <dt>Quiet for</dt>
          <dd className="hh-mono">{countdown(now - quietSince)}</dd>
        </div>
      ) : null}
      <div>
        <dt>On the loop</dt>
        <dd className="hh-mono">
          {plural(onLoop.length, "Agent")} · {live} live
        </dd>
      </div>
    </dl>
  );

  if (compact) {
    return (
      <section className="hh-standby" data-size="compact" aria-labelledby="standby-h">
        <Scope craft={craft} full={false} />
        <div className="hh-standby-copy">
          <h2 className="hh-heading-md" id="standby-h">
            No pending Rounds. Holding orbit.
          </h2>
          {readouts}
          <Chatter />
        </div>
      </section>
    );
  }

  return (
    <section className="hh-standby" data-size="full" aria-labelledby="standby-h">
      <Space />
      <div className="hh-standby-stage">
        <div className="hh-standby-drift">
          <Scope craft={craft} full={true} />
        </div>
      </div>
      <div className="hh-standby-hud" aria-hidden="true">
        <span className="hh-standby-corner" data-corner="tl"></span>
        <span className="hh-standby-corner" data-corner="tr"></span>
        <span className="hh-standby-corner" data-corner="bl"></span>
        <span className="hh-standby-corner" data-corner="br"></span>
        <span className="hh-standby-hud-legend">
          <span>Deep space track</span>
          <span className="hh-mono">{plural(craft.length + 1, "craft", "craft")} · {hhmmss(new Date(now).toISOString())}</span>
        </span>
      </div>
      <span className="hh-standby-letterbox" data-edge="top" aria-hidden="true"></span>
      <span className="hh-standby-letterbox" data-edge="bottom" aria-hidden="true"></span>
      <div className="hh-standby-caption">
        <div className="hh-standby-copy">
          <h2 className="hh-standby-title" id="standby-h">
            <span>Holding</span> <span>orbit</span>
          </h2>
          <p className="hh-standby-lead">No pending Rounds. Agents ask through the Hub Skill; a new Round lands here the moment it is sent.</p>
          {readouts}
          <a className="hh-link" href="/log" onClick={linkClick("/log")}>
            Open answered log
          </a>
        </div>
        <Chatter />
      </div>
    </section>
  );
}
