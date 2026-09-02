import type { AccessibleName, NameSource } from '../../shared/types';

/**
 * A documented subset of the accessible-name computation.
 *
 * The full accname spec is a recursive algorithm with CSS-generated content and
 * cross-referencing; the browser only exposes its real answer through DevTools
 * (PLAN.md section 2.4). Rather than pretend, this implements the branches that
 * cover real pages and reports which source won, so callers can tell a proper
 * label from a fallback.
 *
 * DOM structure and attributes only -- no computed styles -- so it is testable
 * in jsdom and cannot force a layout during collection.
 */

const TEXT_LIMIT = 200;

/** Sources assistive tech treats as a last resort. */
const WEAK: ReadonlySet<NameSource> = new Set<NameSource>(['title', 'placeholder']);

const EMBEDDED_CONTROL = new Set(['input', 'select', 'textarea']);

const NAME_FROM_CONTENT = new Set([
  'a',
  'button',
  'summary',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'label',
  'legend',
  'caption',
  'td',
  'th',
  'option',
  'li',
]);

const NAME_FROM_CONTENT_ROLES = new Set([
  'button',
  'link',
  'heading',
  'menuitem',
  'option',
  'tab',
  'treeitem',
  'cell',
  'columnheader',
  'rowheader',
  'listitem',
]);

export const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const clamp = (value: string): string =>
  value.length > TEXT_LIMIT ? `${value.slice(0, TEXT_LIMIT).trimEnd()}…` : value;

const isHiddenForNaming = (element: Element): boolean => {
  if (element.getAttribute('aria-hidden') === 'true') return true;
  if (element.hasAttribute('hidden')) return true;
  const style = element.getAttribute('style');
  return style !== null && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
};

/** Visible text of a subtree, skipping hidden branches and embedded controls. */
export function textFromSubtree(element: Element, depth = 0): string {
  if (depth > 12) return '';
  let out = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3 /* text */) {
      out += node.nodeValue ?? '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    if (isHiddenForNaming(child)) continue;
    const tag = child.tagName.toLowerCase();
    if (EMBEDDED_CONTROL.has(tag)) continue;
    // An image inside a link or button contributes its alt text.
    if (tag === 'img') {
      out += ` ${child.getAttribute('alt') ?? ''} `;
      continue;
    }
    const label = child.getAttribute('aria-label');
    if (label) {
      out += ` ${label} `;
      continue;
    }
    out += ` ${textFromSubtree(child, depth + 1)} `;
  }
  return normalizeText(out);
}

function fromLabelledBy(element: Element): string | null {
  const ids = element.getAttribute('aria-labelledby');
  if (!ids) return null;
  const root = element.getRootNode() as Document | ShadowRoot;
  const parts: string[] = [];
  for (const id of ids.trim().split(/\s+/)) {
    const target = root.getElementById?.(id) ?? null;
    if (!target) continue;
    const own = target.getAttribute('aria-label');
    parts.push(own ? normalizeText(own) : textFromSubtree(target));
  }
  const name = normalizeText(parts.join(' '));
  return name.length > 0 ? name : null;
}

function associatedLabel(element: Element): { name: string; source: NameSource } | null {
  const id = element.getAttribute('id');
  if (id) {
    const root = element.getRootNode() as Document | ShadowRoot;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
    const explicit = root.querySelector?.(`label[for="${escaped}"]`);
    if (explicit) {
      const name = textFromSubtree(explicit);
      if (name) return { name, source: 'label-for' };
    }
  }
  const wrapping = element.closest?.('label');
  if (wrapping) {
    const name = textFromSubtree(wrapping);
    if (name) return { name, source: 'label-wrapped' };
  }
  return null;
}

const none = (): AccessibleName => ({ name: '', source: 'none', weak: false });

const named = (name: string, source: NameSource): AccessibleName => ({
  name: clamp(normalizeText(name)),
  source,
  weak: WEAK.has(source),
});

export function computeAccessibleName(element: Element): AccessibleName {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role') ?? undefined;

  if (element.getAttribute('aria-hidden') === 'true') return none();

  // 1. aria-labelledby
  const labelledBy = fromLabelledBy(element);
  if (labelledBy) return named(labelledBy, 'aria-labelledby');

  // 2. aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && normalizeText(ariaLabel)) return named(ariaLabel, 'aria-label');

  // 3. native mechanisms, per element type
  if (tag === 'img' || tag === 'area') {
    const alt = element.getAttribute('alt');
    // alt="" is a deliberate "decorative", not a missing name.
    if (alt !== null) return alt === '' ? none() : named(alt, 'alt');
  }

  if (tag === 'input') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'reset' || type === 'button') {
      const value = element.getAttribute('value');
      if (value && normalizeText(value)) return named(value, 'value');
      // Submit and reset have browser default labels.
      if (type === 'submit') return named('Submit', 'value');
      if (type === 'reset') return named('Reset', 'value');
    }
    if (type === 'image') {
      const alt = element.getAttribute('alt');
      if (alt && normalizeText(alt)) return named(alt, 'alt');
    }
  }

  if (EMBEDDED_CONTROL.has(tag) || role === 'textbox' || role === 'combobox') {
    const label = associatedLabel(element);
    if (label) return named(label.name, label.source);
  }

  if (tag === 'fieldset') {
    const legend = element.querySelector(':scope > legend');
    if (legend) {
      const name = textFromSubtree(legend);
      if (name) return named(name, 'legend');
    }
  }

  if (tag === 'table') {
    const caption = element.querySelector(':scope > caption');
    if (caption) {
      const name = textFromSubtree(caption);
      if (name) return named(name, 'caption');
    }
  }

  // 4. name from content, for the roles that allow it
  if (NAME_FROM_CONTENT.has(tag) || (role !== undefined && NAME_FROM_CONTENT_ROLES.has(role))) {
    const text = textFromSubtree(element);
    if (text) return named(text, 'text');
  }

  // 5. title
  const title = element.getAttribute('title');
  if (title && normalizeText(title)) return named(title, 'title');

  // 6. placeholder: a name only in the loosest sense, and flagged weak
  const placeholder = element.getAttribute('placeholder');
  if (placeholder && normalizeText(placeholder)) return named(placeholder, 'placeholder');

  return none();
}
