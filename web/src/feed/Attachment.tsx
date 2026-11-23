import type { Attachment as AttachmentDoc } from "../../../src/schema/types.ts";
import { Icon, type IconName } from "../icons.tsx";
import { Markdown } from "../markdown.tsx";

/** Diffs fold only runs of this many or more unchanged lines (command-center spec). */
const FOLD_MIN = 8;

const KIND: Record<AttachmentDoc["kind"], { word: string; icon: IconName }> = {
  markdown: { word: "Markdown", icon: "file" },
  diff: { word: "Diff", icon: "diff" },
  code: { word: "Code", icon: "code" },
  image: { word: "Image", icon: "file" },
  file: { word: "File", icon: "file" },
  link: { word: "Link", icon: "link" },
};

function bytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

function lineCount(text: string): number {
  return text.replace(/\n$/, "").split("\n").length;
}

/** One Attachment at full height (no inner scroll except the design's code-plane cap). */
export function Attachment({ attachment: a }: { attachment: AttachmentDoc }) {
  const { word, icon } = KIND[a.kind];
  const title = a.title ?? ("path" in a && a.path ? a.path : a.kind === "link" ? a.url : word);
  return (
    <figure className="hh-attachment">
      <figcaption className="hh-attachment-head">
        <span className="hh-badge">
          <Icon name={icon} /> {word}
        </span>
        <span className="hh-attachment-title hh-mono">{title}</span>
        <span className="hh-mono-sm">{summary(a)}</span>
      </figcaption>
      <AttachmentBody attachment={a} title={title} />
    </figure>
  );
}

function summary(a: AttachmentDoc): string {
  switch (a.kind) {
    case "markdown":
      return `Markdown · ${bytes(new TextEncoder().encode(a.content).length)}`;
    case "diff": {
      const lines = diffLines(a.content);
      const add = lines.filter((l) => l.kind === "add").length;
      const remove = lines.filter((l) => l.kind === "remove").length;
      const folded = groups(lines).reduce((n, g) => n + (g.fold ? g.lines.length : 0), 0);
      return `+${add} −${remove}${folded ? ` · ${folded} unchanged lines folded` : ""}`;
    }
    case "code":
      return `${a.language ?? "Code"} · ${lineCount(a.content)} lines`;
    case "file":
      return `${lineCount(a.content)} lines`;
    case "image":
      return `${a.media_type.replace("image/", "").toUpperCase()} · ${bytes(Math.floor((a.data.length * 3) / 4))}`;
    case "link":
      return linkHost(a.url);
  }
}

function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function AttachmentBody({ attachment: a, title }: { attachment: AttachmentDoc; title: string }) {
  switch (a.kind) {
    case "markdown":
      return <Markdown className="pv-prose" text={a.content} />;
    case "diff":
      return (
        <div className="hh-attachment-body" role="region" tabIndex={0} aria-label={`Diff of ${title}`}>
          <Diff content={a.content} />
        </div>
      );
    case "code":
    case "file":
      return (
        <pre className="hh-attachment-body" tabIndex={0} aria-label={`${a.kind === "code" ? "Code" : "File"}: ${title}`}>
          <code>{a.content}</code>
        </pre>
      );
    case "image":
      return (
        <div className="pv-image-plane">
          <img className="pv-image" src={`data:${a.media_type};base64,${a.data}`} alt={a.alt} />
        </div>
      );
    case "link":
      return (
        <div className="pv-prose">
          <p>
            <a className="hh-link" href={a.url} target="_blank" rel="noreferrer">
              {a.title ?? a.url} ({linkHost(a.url)})<span className="hh-visually-hidden"> opens in a new tab</span>
            </a>
          </p>
          {a.description ? <p>{a.description}</p> : null}
        </div>
      );
  }
}

interface DiffLine {
  kind: "add" | "remove" | "context";
  text: string;
}

function diffLines(content: string): DiffLine[] {
  return content
    .replace(/\n$/, "")
    .split("\n")
    .filter((l) => !/^(diff --git |index |--- |\+\+\+ )/.test(l))
    .map((l): DiffLine => {
      if (l.startsWith("+")) return { kind: "add", text: l.slice(1) };
      if (l.startsWith("-")) return { kind: "remove", text: l.slice(1) };
      return { kind: "context", text: l.startsWith(" ") ? l.slice(1) : l };
    });
}

/** Runs of unchanged lines; runs of FOLD_MIN or more are folded. */
function groups(lines: DiffLine[]): { fold: boolean; lines: DiffLine[] }[] {
  const out: { fold: boolean; lines: DiffLine[] }[] = [];
  for (const line of lines) {
    const last = out.at(-1);
    const context = line.kind === "context";
    if (last && context && last.lines[0]!.kind === "context") last.lines.push(line);
    else if (last && !context && last.lines[0]!.kind !== "context") last.lines.push(line);
    else out.push({ fold: false, lines: [line] });
  }
  for (const g of out) g.fold = g.lines[0]!.kind === "context" && g.lines.length >= FOLD_MIN;
  return out;
}

function DiffRow({ line }: { line: DiffLine }) {
  return (
    <li className="hh-diff-line" data-kind={line.kind === "context" ? undefined : line.kind}>
      <span className="hh-diff-sign" aria-hidden="true">
        {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
      </span>
      <span>
        {line.kind === "add" ? <span className="hh-visually-hidden">Added: </span> : null}
        {line.kind === "remove" ? <span className="hh-visually-hidden">Removed: </span> : null}
        {line.text}
      </span>
    </li>
  );
}

function Diff({ content }: { content: string }) {
  const parts = groups(diffLines(content));
  let key = 0;
  return (
    <ol className="hh-diff">
      {parts.flatMap((g) =>
        g.fold
          ? [
              <li className="pv-diff-fold" key={key++}>
                <details>
                  <summary className="pv-fold-summary">Show {g.lines.length} unchanged lines</summary>
                  <ol className="hh-diff">
                    {g.lines.map((line, i) => (
                      <DiffRow key={i} line={line} />
                    ))}
                  </ol>
                </details>
              </li>,
            ]
          : g.lines.map((line) => <DiffRow key={key++} line={line} />),
      )}
    </ol>
  );
}
