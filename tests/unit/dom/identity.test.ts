import { beforeEach, describe, expect, it } from 'vitest';
import {
  ancestry,
  describeElement,
  isApproximate,
  isStableId,
  resolveReference,
  structuralPath,
} from '../../../src/audit/element/identity';
import type { Rect } from '../../../src/shared/types';

const RECT: Rect = { x: 10, y: 20, width: 100, height: 40 };

/** Stand-in for getBoundingClientRect: these cases are about identity, not size. */
const sameSize = () => RECT;

const html = (markup: string): void => {
  document.body.innerHTML = markup;
};

const target = (selector = '[data-target]'): Element => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`no element for ${selector}`);
  return element;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isStableId', () => {
  it('accepts author-written ids', () => {
    for (const id of ['main-nav', 'signup', 'hero_cta']) expect(isStableId(id), id).toBe(true);
  });

  it('rejects ids frameworks regenerate every render', () => {
    for (const id of [':r3:', 'ember1234', 'mui-42931', 'radix-:r1:', '__next-a', 'field-98213', 'a3f9b8c1-1234-4bcd-9999-x']) {
      expect(isStableId(id), id).toBe(false);
    }
  });
});

describe('structuralPath', () => {
  it('anchors at the nearest landmark and uses nth-of-type', () => {
    html(`
      <main>
        <section>
          <p>one</p>
          <p data-target>two</p>
        </section>
      </main>
    `);
    expect(structuralPath(target())).toBe('section:nth-of-type(1) > p:nth-of-type(2)');
  });

  it('stops at the body when there is no landmark', () => {
    html('<div><span data-target>x</span></div>');
    expect(structuralPath(target())).toBe('div:nth-of-type(1) > span:nth-of-type(1)');
  });

  it('records ancestry with stable ids only', () => {
    html('<main id="content"><div id=":r9:"><button data-target>Go</button></div></main>');
    expect(ancestry(target())).toEqual(['body', 'main#content', 'div']);
  });
});

describe('describeElement', () => {
  it('captures several independent handles on the same element', () => {
    html('<main><button data-target data-testid="cta" class="primary">Start free trial</button></main>');
    const reference = describeElement(target(), RECT);
    expect(reference).toMatchObject({
      tagName: 'button',
      role: 'button',
      accessibleName: 'Start free trial',
      textSnippet: 'Start free trial',
      stableAttribute: { name: 'data-testid', value: 'cta' },
    });
    expect(reference.centroid).toEqual({ x: 60, y: 40 });
  });

  it('prefers a test attribute over an id', () => {
    html('<button data-target id="go" data-qa="submit">Go</button>');
    expect(describeElement(target(), RECT).stableAttribute).toEqual({ name: 'data-qa', value: 'submit' });
  });

  it('ignores a framework-generated id as a handle', () => {
    html('<button data-target id=":r1:">Go</button>');
    expect(describeElement(target(), RECT).stableAttribute).toBeUndefined();
  });
});

describe('resolveReference walks the ladder in order', () => {
  it('level 1: a stable id', () => {
    html('<button id="go">Go</button>');
    const reference = describeElement(target('#go'), RECT);
    html('<div><p>page changed</p><button id="go">Go now</button></div>');
    expect(resolveReference(reference, document, sameSize).level).toBe(1);
  });

  it('level 2: a test attribute when the id is gone', () => {
    html('<button data-testid="cta">Go</button>');
    const reference = describeElement(target('[data-testid]'), RECT);
    html('<section><button data-testid="cta">Go</button></section>');
    const resolved = resolveReference(reference, document, sameSize);
    expect(resolved.level).toBe(2);
    expect(resolved.element?.textContent).toBe('Go');
  });

  it('level 3: role plus accessible name', () => {
    html('<button>Start free trial</button>');
    const reference = describeElement(target('button'), RECT);
    html('<main><div><button class="renamed-class">Start free trial</button></div></main>');
    expect(resolveReference(reference, document, sameSize).level).toBe(3);
  });

  it('level 4: tag plus text, when role and name are not unique', () => {
    html('<span>Only me</span>');
    const reference = describeElement(target('span'), RECT);
    html('<div><span>Only me</span></div>');
    expect(resolveReference(reference, document, sameSize).level).toBe(4);
  });

  it('level 5: structural path when nothing identifying survives', () => {
    html('<main><section><p>one</p><p>two</p></section></main>');
    const reference = describeElement(document.querySelectorAll('p')[1]!, RECT);
    html('<main><section><p>changed one</p><p>changed two</p></section></main>');
    const resolved = resolveReference(reference, document, sameSize);
    expect(resolved.level).toBe(5);
    expect(resolved.element?.textContent).toBe('changed two');
  });

  it('will not accept a structural match that looks nothing like the original', () => {
    // Deleting an element hands its position to the next sibling. A path match
    // alone must not be enough, or the UI points confidently at the wrong node.
    document.body.innerHTML = '<main><button id="a">Start free trial</button><button id="b">×</button></main>';
    const reference = describeElement(target('#a'), { x: 0, y: 0, width: 148, height: 44 });
    document.querySelector('#a')!.remove();
    const resolved = resolveReference(reference, document, () => ({ x: 0, y: 0, width: 20, height: 20 }));
    expect(resolved.element).toBeNull();
  });

  it('accepts a structural match that still looks the same', () => {
    document.body.innerHTML = '<main><section><p>one</p><p>two</p></section></main>';
    const reference = describeElement(document.querySelectorAll('p')[1]!, { x: 0, y: 0, width: 300, height: 20 });
    document.body.innerHTML = '<main><section><p>changed</p><p>also changed</p></section></main>';
    const resolved = resolveReference(reference, document, () => ({ x: 0, y: 0, width: 300, height: 20 }));
    expect(resolved.level).toBe(5);
    expect(resolved.element?.textContent).toBe('also changed');
  });

  it('reports null when the element is genuinely gone', () => {
    html('<main><section><button id="gone">Gone</button></section></main>');
    const reference = describeElement(target('#gone'), RECT);
    html('<main><p>nothing like it here</p></main>');
    expect(resolveReference(reference, document, sameSize)).toEqual({ element: null, level: null });
  });

  it('never resolves to an element of a different tag', () => {
    html('<button id="go">Go</button>');
    const reference = describeElement(target('#go'), RECT);
    html('<a id="go">Go</a>');
    expect(resolveReference(reference, document, sameSize).element).toBeNull();
  });
});

describe('isApproximate', () => {
  it('treats structural and geometric hits as approximate, and says so', () => {
    expect(isApproximate(1)).toBe(false);
    expect(isApproximate(4)).toBe(false);
    expect(isApproximate(5)).toBe(true);
    expect(isApproximate(6)).toBe(true);
    expect(isApproximate(null)).toBe(true);
  });
});
