import { useState } from "react";
import type { AgentView } from "../../../src/hub/engine.ts";
import { forgetAgent } from "../api.ts";
import { useStore } from "../store.ts";

/** Roster and Lanes (agent-identity + command-center specs). Plain functional UI; S4 designs the Feed only. */
export function Agents() {
  const agents = useStore((s) => s.agents);
  const rounds = useStore((s) => s.rounds);
  return (
    <main>
      <h1>Agents</h1>
      <table className="roster">
        <thead>
          <tr>
            <th>Callsign</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Pending</th>
            <th>Resume</th>
            <th>Detection</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} />
          ))}
        </tbody>
      </table>

      <h2>Lanes</h2>
      {agents.map((a) => {
        const lane = rounds.filter((r) => r.session.id === a.id && r.status === "pending");
        return lane.length === 0 ? null : (
          <section key={a.id} className="lane">
            <h3>{a.callsign}</h3>
            <ul>
              {lane.map((r) => (
                <li key={r.id}>
                  <a href={`/rounds/${r.id}`}>{r.round.title}</a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}

function AgentRow({ agent }: { agent: AgentView }) {
  const [forgetting, setForgetting] = useState(false);
  const mismatch = agent.detection && !agent.detection.documented;
  return (
    <tr className={`liveness-${agent.liveness}`}>
      <td>{agent.callsign}</td>
      <td>{agent.kind}</td>
      <td>{agent.liveness}</td>
      <td>{agent.pending_count}</td>
      <td>{agent.resume ? <code>{agent.resume}</code> : "—"}</td>
      <td>
        {agent.detection ? (
          <span title={`source: ${agent.detection.source}`}>
            step {agent.detection.step}
            {mismatch ? <em className="undocumented"> (undocumented)</em> : null}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td>
        <button type="button" disabled={forgetting} onClick={() => (setForgetting(true), forgetAgent(agent.id))}>
          Forget
        </button>
      </td>
    </tr>
  );
}
