import { computeAccessibleName } from '../../audit/accessibility/accname';
import { effectiveRole, headingLevel } from '../../audit/accessibility/roles';
import { stableAttributeOf, structuralPath } from '../../audit/element/identity';
import type { AccessibleName, ElementSnapshot, FormFieldSnapshot, Rect } from '../../shared/types';
import { measureAll, toStyleSnapshot, type Measured } from './measure';
import { words } from '../../audit/measure/text';
import { formSnapshot, isSensitiveField, sanitize, sanitizeHref } from './redact';
import { isFocusable, isInteractive, isInViewport } from './visibility';

/**
 * The single-element mapping, shared by full-page collection and by picking one
 * element by hand. One implementation so the two paths cannot drift: a finding
 * about a selected element must be built from exactly the same facts as a
 * finding about that element during a page audit.
 */

export type BuildContext = {
  index: number;
  parent: number | null;
  landmark: number | null;
  precedingHeading: number | null;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  /** False once the snapshot's text budget is spent. */
  allowText: boolean;
};

/**
 * Uses getAttributeNames + getAttribute rather than iterating attribute nodes,
 * because `attribute.value` would trip the content-script guard that bans
 * reading `.value` anywhere in this directory. The guard is deliberately blunt:
 * an absolute rule with no exemptions is worth more than a clever one, and
 * this spelling is no less clear.
 */
function ariaAttributes(element: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of element.getAttributeNames()) {
    if (!name.startsWith('aria-')) continue;
    if (name === 'aria-label' || name === 'aria-labelledby') continue;
    out[name] = (element.getAttribute(name) ?? '').slice(0, 120);
  }
  return out;
}

function labelSource(name: AccessibleName): FormFieldSnapshot['labelledBy'] {
  switch (name.source) {
    case 'label-for':
      return 'label-for';
    case 'label-wrapped':
      return 'label-wrapped';
    case 'aria-label':
    case 'aria-labelledby':
      return 'aria';
    case 'placeholder':
      return 'placeholder';
    default:
      return 'none';
  }
}

/** Own text only: a section's snapshot should not repeat every descendant. */
export function ownText(element: Element): string {
  let out = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) out += node.nodeValue ?? '';
  }
  return out;
}

export function buildElementSnapshot(measured: Measured, context: BuildContext): ElementSnapshot {
  const { element, rect, style } = measured;
  const tagName = element.tagName.toLowerCase();
  const { role, implicit } = effectiveRole(element);
  const level = headingLevel(element);
  const sensitive = isSensitiveField(element);
  const inputType = tagName === 'input' ? (element.getAttribute('type') ?? 'text').toLowerCase() : undefined;
  const tabIndexAttribute = element.getAttribute('tabindex');
  const tabIndex = tabIndexAttribute === null ? -1 : Number.parseInt(tabIndexAttribute, 10) || 0;
  const disabled = element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';

  const facts = {
    tagName,
    hasHref: element.hasAttribute('href'),
    hasClickAttribute: element.hasAttribute('onclick'),
    tabIndex,
    ...(role !== undefined ? { role } : {}),
    ...(inputType !== undefined ? { inputType } : {}),
  };

  const documentRect: Rect = {
    x: rect.x + context.scrollX,
    y: rect.y + context.scrollY,
    width: rect.width,
    height: rect.height,
  };

  const snapshot: ElementSnapshot = {
    index: context.index,
    parent: context.parent,
    landmark: context.landmark,
    precedingHeading: context.precedingHeading,
    tagName,
    classNames: sensitive ? [] : [...element.classList].slice(0, 12),
    accessibleName: sensitive ? { name: '', source: 'none', weak: false } : computeAccessibleName(element),
    aria: sensitive ? {} : ariaAttributes(element),
    textLength: 0,
    wordCount: 0,
    rect,
    documentRect,
    inViewport: isInViewport(rect, context.viewportWidth, context.viewportHeight),
    interactive: isInteractive(facts),
    focusable: isFocusable({ ...facts, disabled }),
    tabIndex,
    disabled,
    ariaHidden: element.getAttribute('aria-hidden') === 'true',
    styles: toStyleSnapshot(style),
    structuralPath: structuralPath(element),
    redacted: sensitive,
  };

  const handle = stableAttributeOf(element);
  if (handle) snapshot.stableAttribute = handle;

  if (level !== undefined) snapshot.headingLevel = level;
  if (role) snapshot.role = role;
  if (implicit) snapshot.implicitRole = implicit;

  if (sensitive) {
    // Type and presence only. Nothing about the field's contents exists here.
    snapshot.form = formSnapshot(element, 'none');
    return snapshot;
  }

  const id = element.getAttribute('id');
  if (id) snapshot.id = id;

  const raw = ownText(element);
  if (raw.trim()) {
    snapshot.textLength = raw.trim().length;
    snapshot.wordCount = words(raw).length;
    if (context.allowText) snapshot.text = sanitize(raw);
  }

  const alt = element.getAttribute('alt');
  if (alt !== null) snapshot.alt = sanitize(alt);
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) snapshot.placeholder = sanitize(placeholder);
  const title = element.getAttribute('title');
  if (title) snapshot.title = sanitize(title);
  const href = sanitizeHref(element.getAttribute('href'), location.href);
  if (href) snapshot.href = href;

  if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
    snapshot.form = formSnapshot(element, labelSource(snapshot.accessibleName));
  }

  return snapshot;
}

/** Snapshot one hand-picked element, with no page context around it. */
export function snapshotSingleElement(element: Element): ElementSnapshot {
  const [measured] = measureAll([element]);
  if (!measured) throw new Error('element could not be measured');
  return buildElementSnapshot(measured, {
    index: 0,
    parent: null,
    landmark: null,
    precedingHeading: null,
    scrollX: Math.round(window.scrollX),
    scrollY: Math.round(window.scrollY),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    allowText: true,
  });
}
