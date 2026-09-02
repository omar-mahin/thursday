import { beforeEach, describe, expect, it } from 'vitest';
import { computeAccessibleName, normalizeText, textFromSubtree } from '../../../src/audit/accessibility/accname';

const mount = (html: string): Element => {
  document.body.innerHTML = html;
  const element = document.querySelector('[data-target]');
  if (!element) throw new Error('fixture needs a [data-target] element');
  return element;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('computeAccessibleName precedence', () => {
  it('prefers aria-labelledby over everything else', () => {
    const element = mount(`
      <span id="lbl">From labelledby</span>
      <button data-target aria-labelledby="lbl" aria-label="From label" title="From title">Content</button>
    `);
    expect(computeAccessibleName(element)).toEqual({
      name: 'From labelledby',
      source: 'aria-labelledby',
      weak: false,
    });
  });

  it('joins multiple labelledby targets in reference order', () => {
    const element = mount(`
      <span id="a">Delete</span><span id="b">invoice</span>
      <button data-target aria-labelledby="b a">x</button>
    `);
    expect(computeAccessibleName(element).name).toBe('invoice Delete');
  });

  it('falls back to aria-label, then content, then title', () => {
    expect(computeAccessibleName(mount('<button data-target aria-label="Label">Text</button>')).source).toBe(
      'aria-label',
    );
    expect(computeAccessibleName(mount('<button data-target>Text</button>')).source).toBe('text');
    expect(computeAccessibleName(mount('<div data-target role="button" title="T"></div>')).source).toBe('title');
  });

  it('treats title and placeholder as weak names, not proper labels', () => {
    expect(computeAccessibleName(mount('<input data-target title="Search">'))).toEqual({
      name: 'Search',
      source: 'title',
      weak: true,
    });
    expect(computeAccessibleName(mount('<input data-target placeholder="Email">'))).toEqual({
      name: 'Email',
      source: 'placeholder',
      weak: true,
    });
  });
});

describe('native labelling mechanisms', () => {
  it('uses label[for] and wrapping labels', () => {
    expect(
      computeAccessibleName(mount('<label for="e">Email</label><input id="e" data-target>')),
    ).toEqual({ name: 'Email', source: 'label-for', weak: false });

    expect(
      computeAccessibleName(mount('<label>Phone <input data-target></label>')),
    ).toEqual({ name: 'Phone', source: 'label-wrapped', weak: false });
  });

  it('reads alt text, and treats alt="" as decorative rather than unnamed', () => {
    expect(computeAccessibleName(mount('<img data-target alt="A cat">')).source).toBe('alt');
    expect(computeAccessibleName(mount('<img data-target alt="">'))).toEqual({
      name: '',
      source: 'none',
      weak: false,
    });
    // No alt attribute at all is a different problem, reported by A11Y-001.
    expect(computeAccessibleName(mount('<img data-target>')).source).toBe('none');
  });

  it('uses the value attribute of submit-like inputs, including browser defaults', () => {
    expect(computeAccessibleName(mount('<input data-target type="submit" value="Go">')).name).toBe('Go');
    expect(computeAccessibleName(mount('<input data-target type="submit">')).name).toBe('Submit');
    expect(computeAccessibleName(mount('<input data-target type="reset">')).name).toBe('Reset');
  });

  it('uses legend for fieldsets and caption for tables', () => {
    expect(
      computeAccessibleName(mount('<fieldset data-target><legend>Address</legend><input></fieldset>')).source,
    ).toBe('legend');
    expect(
      computeAccessibleName(mount('<table data-target><caption>Q3</caption></table>')).source,
    ).toBe('caption');
  });

  it('takes the name from content only for roles that allow it', () => {
    expect(computeAccessibleName(mount('<a data-target href="/x">Pricing</a>')).name).toBe('Pricing');
    // A plain div is not named by its content.
    expect(computeAccessibleName(mount('<div data-target>Some copy</div>')).source).toBe('none');
  });
});

describe('subtree text', () => {
  it('skips hidden branches and embedded controls', () => {
    const element = mount(`
      <button data-target>
        Save
        <span aria-hidden="true">✓</span>
        <span hidden>hidden</span>
        <span style="display:none">gone</span>
        <input value="ignored">
      </button>
    `);
    expect(computeAccessibleName(element).name).toBe('Save');
  });

  it('uses alt text of images inside a link', () => {
    expect(computeAccessibleName(mount('<a data-target href="/"><img alt="Home"></a>')).name).toBe('Home');
  });

  it('prefers a descendant aria-label over its text', () => {
    expect(
      computeAccessibleName(mount('<button data-target><span aria-label="Close dialog">×</span></button>')).name,
    ).toBe('Close dialog');
  });

  it('returns nothing for an aria-hidden element', () => {
    expect(computeAccessibleName(mount('<button data-target aria-hidden="true">Hi</button>')).source).toBe('none');
  });

  it('collapses whitespace and stops runaway nesting', () => {
    expect(normalizeText('  a \n  b  ')).toBe('a b');
    let html = '<button data-target>';
    for (let i = 0; i < 20; i += 1) html += '<span>';
    html += 'deep';
    expect(() => textFromSubtree(mount(`${html}</button>`))).not.toThrow();
  });

  it('truncates very long names instead of carrying a page of text', () => {
    const long = 'word '.repeat(80);
    const name = computeAccessibleName(mount(`<button data-target>${long}</button>`)).name;
    expect(name.length).toBeLessThanOrEqual(201);
    expect(name.endsWith('…')).toBe(true);
  });
});
