import type { ElementReference, Rect, ResolutionLevel } from '../../shared/types';
import { computeAccessibleName, normalizeText } from '../accessibility/accname';
import { effectiveRole, LANDMARK_TAGS } from '../accessibility/roles';

/**
 * Element identity and re-resolution (PLAN.md section 2.5).
 *
 * Selectors are treated as unstable. A reference carries several independent
 * handles on the same element, and resolution walks them from most to least
 * trustworthy, reporting which level succeeded so the UI can say "this pin is
 * approximate" instead of quietly pointing at the wrong thing.
 */

const TEST_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-test-id'] as const;

/** Ids that frameworks generate per render, so they mean nothing tomorrow. */
const GENERATED_ID = [
  /^:r/i, // React useId
  /^ember\d/i,
  /^(mui|radix|headlessui|reach|chakra|mantine)-/i,
  /^__/,
  /\d{4,}/, // long digit runs
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, // uuid
] as const;

const PATH_DEPTH_LIMIT = 6;
const TEXT_SNIPPET_LIMIT = 80;
/** How far a geometrically-resolved element may differ in size and still count. */
const GEOMETRY_TOLERANCE = 0.15;

export const isStableId = (id: string): boolean =>
  id.length > 0 && id.length < 60 && !GENERATED_ID.some((pattern) => pattern.test(id));

const escapeAttr = (value: string): string => value.replace(/(["\\])/g, '\\$1');

export function stableAttributeOf(element: Element): { name: string; value: string } | undefined {
  for (const name of TEST_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value && value.length < 100) return { name, value };
  }
  const id = element.getAttribute('id');
  if (id && isStableId(id)) return { name: 'id', value: id };
  return undefined;
}

const nthOfType = (element: Element): number => {
  let index = 1;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === element.tagName) index += 1;
    sibling = sibling.previousElementSibling;
  }
  return index;
};

/** Anchors the path at the nearest landmark so unrelated page changes above it
 *  do not invalidate the reference. */
export function structuralPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < PATH_DEPTH_LIMIT) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') break;
    segments.unshift(`${tag}:nth-of-type(${nthOfType(current)})`);
    if (LANDMARK_TAGS.has(tag)) break;
    current = current.parentElement;
    depth += 1;
  }
  return segments.join(' > ');
}

export function ancestry(element: Element): string[] {
  const out: string[] = [];
  let current = element.parentElement;
  while (current && out.length < 8) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'html') break;
    const id = current.getAttribute('id');
    out.unshift(id && isStableId(id) ? `${tag}#${id}` : tag);
    current = current.parentElement;
  }
  return out;
}

export function textSnippet(element: Element): string | undefined {
  const text = normalizeText(element.textContent ?? '');
  if (!text) return undefined;
  return text.length > TEXT_SNIPPET_LIMIT ? text.slice(0, TEXT_SNIPPET_LIMIT) : text;
}

export function describeElement(element: Element, rect: Rect): ElementReference {
  const { role } = effectiveRole(element);
  const name = computeAccessibleName(element);
  const attribute = stableAttributeOf(element);
  const snippet = textSnippet(element);

  const reference: ElementReference = {
    tagName: element.tagName.toLowerCase(),
    structuralPath: structuralPath(element),
    ancestry: ancestry(element),
    rect,
    centroid: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
  };
  if (role) reference.role = role;
  if (name.name) reference.accessibleName = name.name;
  if (snippet) reference.textSnippet = snippet;
  if (attribute) reference.stableAttribute = attribute;
  return reference;
}

export type Resolution = { element: Element | null; level: ResolutionLevel | null };

const single = (matches: Element[]): Element | null => (matches.length === 1 ? matches[0] ?? null : null);

const sizeMatches = (a: Rect, b: Rect): boolean => {
  const width = Math.max(a.width, 1);
  const height = Math.max(a.height, 1);
  return (
    Math.abs(a.width - b.width) / width <= GEOMETRY_TOLERANCE &&
    Math.abs(a.height - b.height) / height <= GEOMETRY_TOLERANCE
  );
};

/** Corroboration for the positional rungs: same text, name, or size. */
function looksLikeSame(
  reference: ElementReference,
  candidate: Element,
  rectOf: (element: Element) => Rect,
): boolean {
  if (reference.textSnippet && textSnippet(candidate) === reference.textSnippet) return true;
  if (reference.accessibleName && computeAccessibleName(candidate).name === reference.accessibleName) return true;
  return sizeMatches(reference.rect, rectOf(candidate));
}

/**
 * Walks the resolution ladder. `rectOf` is injected rather than defaulted --
 * the positional rungs verify size, so a caller that cannot measure would
 * silently get different answers.
 */
export function resolveReference(
  reference: ElementReference,
  doc: Document,
  rectOf: (element: Element) => Rect,
): Resolution {
  const tag = reference.tagName;

  // 1. a stable id
  if (reference.stableAttribute?.name === 'id') {
    const byId = doc.getElementById(reference.stableAttribute.value);
    if (byId && byId.tagName.toLowerCase() === tag) return { element: byId, level: 1 };
  }

  // 2. a test attribute
  if (reference.stableAttribute && reference.stableAttribute.name !== 'id') {
    const { name, value } = reference.stableAttribute;
    const match = single([...doc.querySelectorAll(`[${name}="${escapeAttr(value)}"]`)]);
    if (match) return { element: match, level: 2 };
  }

  // 3. role plus accessible name, when that pair is unique
  if (reference.role && reference.accessibleName) {
    const candidates = [...doc.querySelectorAll<Element>('*')].filter((element) => {
      if (effectiveRole(element).role !== reference.role) return false;
      return computeAccessibleName(element).name === reference.accessibleName;
    });
    const match = single(candidates);
    if (match) return { element: match, level: 3 };
  }

  // 4. tag plus text, when unique
  if (reference.textSnippet) {
    const candidates = [...doc.querySelectorAll(tag)].filter(
      (element) => textSnippet(element) === reference.textSnippet,
    );
    const match = single(candidates);
    if (match) return { element: match, level: 4 };
  }

  // 5. the structural path, but only if the element there still looks like the
  //    one we stored. A path alone is not evidence: delete an element and its
  //    next sibling inherits the path, so an unverified match would confidently
  //    point at the wrong thing.
  if (reference.structuralPath) {
    try {
      const matches = [...doc.querySelectorAll(reference.structuralPath)].filter(
        (element) => element.tagName.toLowerCase() === tag,
      );
      const match = matches[0] ?? null;
      if (match && looksLikeSame(reference, match, rectOf)) return { element: match, level: 5 };
    } catch {
      /* a path the browser will not parse is simply not a match */
    }
  }

  // 6. geometry: whatever is now at the remembered centre, if it looks the same
  const fromPoint = doc.elementFromPoint?.(reference.centroid.x, reference.centroid.y) ?? null;
  if (fromPoint && fromPoint.tagName.toLowerCase() === tag && sizeMatches(reference.rect, rectOf(fromPoint))) {
    return { element: fromPoint, level: 6 };
  }

  return { element: null, level: null };
}

/** Levels 5 and 6 are guesses, and the UI must say so. */
export const isApproximate = (level: ResolutionLevel | null): boolean => level === null || level >= 5;
