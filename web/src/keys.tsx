import { useEffect, useRef } from "react";
import { Icon } from "./icons.tsx";
import { useStore } from "./store.ts";

/** The key map (command-center spec: Keys). */
export const KEY_MAP: [string, string][] = [
  ["j / k", "Next / previous Round in the Feed"],
  ["1–9", "Choose an option in the current Question"],
  ["a / r", "Approve / reject the current approve/reject Question"],
  ["Tab / Shift+Tab", "Move between Questions and controls"],
  ["n", "Notes for the Round in view"],
  ["⌘↵ / Ctrl↵", "Send the Round in view"],
  ["d", "Dismiss"],
  ["e", "Redirect"],
  ["v", "Ask advisor"],
  ["[", "Show / hide the side navigation"],
  ["?", "Key map"],
];

const TEXT_INPUTS: Record<string, true> = {
  text: true,
  search: true,
  email: true,
  url: true,
  tel: true,
  password: true,
  number: true,
  time: true,
  date: true,
  "datetime-local": true,
  month: true,
  week: true,
};

/** Keys never fire while focus is in a text field (except ⌘↵). */
export function isTextField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUTS[el.type] === true;
}

/** The compact hint list under the Feed index. */
export function KeyList() {
  return (
    <ul className="hh-kbd-hints" aria-label="Keyboard shortcuts">
      <li>
        <kbd className="hh-kbd">j</kbd>
        <kbd className="hh-kbd">k</kbd>
        <span>next, previous</span>
      </li>
      <li>
        <kbd className="hh-kbd">1</kbd>–<kbd className="hh-kbd">9</kbd>
        <span>choose</span>
      </li>
      <li>
        <kbd className="hh-kbd">a</kbd>
        <kbd className="hh-kbd">r</kbd>
        <span>approve, reject</span>
      </li>
      <li>
        <kbd className="hh-kbd">n</kbd>
        <span>notes</span>
      </li>
      <li>
        <kbd className="hh-kbd">d</kbd>
        <span>dismiss</span>
      </li>
      <li>
        <kbd className="hh-kbd">e</kbd>
        <span>redirect</span>
      </li>
      <li>
        <kbd className="hh-kbd">v</kbd>
        <span>ask advisor</span>
      </li>
      <li>
        <kbd className="hh-kbd">⌘↵</kbd>
        <span>send</span>
      </li>
      <li>
        <kbd className="hh-kbd">?</kbd>
        <span>all keys</span>
      </li>
    </ul>
  );
}

export function KeyMapTable({ caption }: { caption: string }) {
  return (
    <div className="hh-table-wrap" data-density="compact" role="region" tabIndex={0} aria-label={caption}>
      <table className="hh-table">
        <caption className="hh-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {KEY_MAP.map(([key, action]) => (
            <tr key={key}>
              <td>
                <kbd className="hh-kbd">{key}</kbd>
              </td>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

let openKeyMap: (() => void) | null = null;

export function showKeyMap(): void {
  openKeyMap?.();
}

/** The `?` dialog. `?` opens it from anywhere outside a text field while single keys are on. */
export function KeyMapDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const shortcuts = useStore((s) => s.settings.shortcuts);

  useEffect(() => {
    openKeyMap = () => {
      if (!ref.current?.open) ref.current?.showModal();
    };
    return () => {
      openKeyMap = null;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "?" || !shortcuts || e.metaKey || e.ctrlKey || e.altKey || isTextField(e.target as Element)) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      ref.current?.showModal();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcuts]);

  return (
    <dialog ref={ref} className="hh-dialog" aria-labelledby="keymap-h">
      <div className="hh-overlay-head">
        <h2 className="hh-heading-md" id="keymap-h">
          Keyboard shortcuts
        </h2>
        <button type="button" className="hh-icon-button" data-variant="ghost" aria-label="Close" onClick={() => ref.current?.close()}>
          <Icon name="x" />
        </button>
      </div>
      <div className="hh-overlay-body hh-stack">
        <p className="hh-body-sm">
          {shortcuts ? "Keys never fire inside a text field, except ⌘↵." : "Single-key shortcuts are off (Settings → Notifications and keys). ⌘↵ still sends."}
        </p>
        <KeyMapTable caption="Key map" />
      </div>
      <div className="hh-overlay-foot">
        <button type="button" className="hh-button" onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}
