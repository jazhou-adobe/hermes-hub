import type { ReactNode } from "react";

/**
 * A small Markdown renderer for Round context, Question details and markdown Attachments. It builds
 * React nodes, never HTML, so Agent-supplied text stays escaped. Supported: paragraphs, headings
 * (rendered as bold paragraphs so they never join the page outline), lists, block quotes, fenced
 * code, and inline `code`, **bold**, *emphasis* and [links](https://…).
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{blocks(text)}</div>;
}

/** Inline Markdown only, for short fields such as option details. */
export function InlineMarkdown({ text }: { text: string }) {
  return <>{inline(text.replace(/\s*\n\s*/g, " "), "i")}</>;
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!)) body.push(lines[i++]!);
      i++;
      out.push(
        <pre key={key++}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push(
        <p key={key++}>
          <strong>{inline(heading[1]!, `h${key}`)}</strong>
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        i++;
      }
      const children = items.map((item, n) => <li key={n}>{inline(item, `l${key}-${n}`)}</li>);
      out.push(ordered ? <ol key={key++}>{children}</ol> : <ul key={key++}>{children}</ul>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={key++}>{blocks(quoted.join("\n"))}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^\s*(```|~~~|#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(lines[i]!)) para.push(lines[i++]!.trim());
    if (para.length === 0) para.push(lines[i++]!.trim());
    out.push(<p key={key++}>{inline(para.join(" "), `p${key}`)}</p>);
  }
  return out;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${prefix}-${n++}`;
    if (m[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      out.push(
        /^https?:\/\//i.test(url!) ? (
          <a key={key} className="hh-link" href={url} target="_blank" rel="noreferrer">
            {label}
            <span className="hh-visually-hidden"> opens in a new tab</span>
          </a>
        ) : (
          label
        ),
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
