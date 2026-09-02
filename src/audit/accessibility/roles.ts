/** Implicit ARIA roles for the tags this tool cares about. Not exhaustive by
 *  design: an unmapped tag reports no role rather than a guessed one. */
const BY_TAG: Record<string, string> = {
  a: 'link', // only with href; handled below
  article: 'article',
  aside: 'complementary',
  button: 'button',
  dialog: 'dialog',
  fieldset: 'group',
  figure: 'figure',
  footer: 'contentinfo', // only when not inside article/section
  form: 'form',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  header: 'banner', // only when not inside article/section
  hr: 'separator',
  img: 'img', // alt="" makes it presentational; handled below
  input: 'textbox', // refined by type below
  li: 'listitem',
  main: 'main',
  nav: 'navigation',
  ol: 'list',
  option: 'option',
  output: 'status',
  progress: 'progressbar',
  section: 'region', // only with an accessible name
  select: 'combobox',
  summary: 'button',
  table: 'table',
  tbody: 'rowgroup',
  td: 'cell',
  textarea: 'textbox',
  th: 'columnheader',
  tr: 'row',
  ul: 'list',
};

const BY_INPUT_TYPE: Record<string, string> = {
  button: 'button',
  checkbox: 'checkbox',
  color: 'textbox',
  date: 'textbox',
  'datetime-local': 'textbox',
  email: 'textbox',
  file: 'button',
  image: 'button',
  month: 'textbox',
  number: 'spinbutton',
  password: 'textbox',
  radio: 'radio',
  range: 'slider',
  reset: 'button',
  search: 'searchbox',
  submit: 'button',
  tel: 'textbox',
  text: 'textbox',
  time: 'textbox',
  url: 'textbox',
  week: 'textbox',
};

const SECTIONING = new Set(['article', 'aside', 'main', 'nav', 'section']);

export const LANDMARK_TAGS = new Set(['header', 'nav', 'main', 'aside', 'footer', 'section', 'form']);

export const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function implicitRole(element: Element): string | undefined {
  const tag = element.tagName.toLowerCase();

  if (tag === 'a' || tag === 'area') return element.hasAttribute('href') ? 'link' : undefined;
  if (tag === 'img') {
    // alt="" is an explicit claim that the image is decorative.
    return element.getAttribute('alt') === '' ? 'presentation' : 'img';
  }
  if (tag === 'input') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'hidden') return undefined;
    return BY_INPUT_TYPE[type] ?? 'textbox';
  }
  if (tag === 'header' || tag === 'footer') {
    // banner/contentinfo only apply at the top level of the document.
    let parent = element.parentElement;
    while (parent) {
      if (SECTIONING.has(parent.tagName.toLowerCase())) return 'generic';
      parent = parent.parentElement;
    }
    return BY_TAG[tag];
  }
  if (tag === 'section') {
    const named =
      element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby');
    return named ? 'region' : undefined;
  }
  return BY_TAG[tag];
}

export function effectiveRole(element: Element): { role?: string; implicit?: string } {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0];
  const implicit = implicitRole(element);
  const result: { role?: string; implicit?: string } = {};
  if (explicit) result.role = explicit;
  else if (implicit) result.role = implicit;
  if (implicit) result.implicit = implicit;
  return result;
}

export function headingLevel(element: Element): number | undefined {
  const tag = element.tagName.toLowerCase();
  if (HEADING_TAGS.has(tag)) return Number(tag.slice(1));
  if (element.getAttribute('role') === 'heading') {
    const level = Number(element.getAttribute('aria-level'));
    return Number.isFinite(level) && level > 0 ? level : undefined;
  }
  return undefined;
}
