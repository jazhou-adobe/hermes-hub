// PROTOTYPE, throwaway. A tiny DOM morph so the whole page can re-render from state every tick without losing focus,
// caret position, scroll or in-flight typing. Elements with data-key are matched by key; others by position and tag.

export function morph(from, to) {
  if (from.nodeType !== 1) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  // Attributes
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  // Live properties the attribute does not drive after first paint
  if (from.tagName === 'INPUT') {
    const checked = to.hasAttribute('checked');
    if (from.checked !== checked) from.checked = checked;
    if (from.type !== 'radio' && from.type !== 'checkbox') {
      const v = to.getAttribute('value') ?? '';
      if (from.value !== v) from.value = v;
    }
  }
  if (from.tagName === 'TEXTAREA') {
    const v = to.textContent;
    if (from.value !== v) from.value = v;
    return;
  }
  if (from.tagName === 'DETAILS') from.open = to.hasAttribute('open');
  morphChildren(from, to);
}

function sameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  return a.tagName === b.tagName && !a.getAttribute('data-key') && !b.getAttribute('data-key');
}

export function morphChildren(from, to) {
  const next = [...to.childNodes];
  const keyed = new Map();
  for (const c of from.childNodes) if (c.nodeType === 1 && c.getAttribute('data-key')) keyed.set(c.getAttribute('data-key'), c);
  let i = 0;
  for (const n of next) {
    const cur = from.childNodes[i] ?? null;
    const key = n.nodeType === 1 ? n.getAttribute('data-key') : null;
    let match = null;
    if (key) {
      const k = keyed.get(key);
      if (k && k.tagName === n.tagName) match = k;
    } else if (cur && sameKind(cur, n)) match = cur;
    if (match) {
      if (match !== cur) from.insertBefore(match, cur);
      morph(match, n);
    } else {
      from.insertBefore(n, cur);
    }
    i++;
  }
  while (from.childNodes.length > next.length) from.lastChild.remove();
}

export function patch(root, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  morphChildren(root, tpl.content);
}
