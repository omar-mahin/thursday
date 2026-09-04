import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLBAR_ICONS } from '../../src/content/toolbar/icons';
import type { ToolbarAction } from '../../src/shared/messaging/protocol';

/**
 * The icons in the bundle are the icons in design/icons/.
 *
 * The artwork is drawn in a design tool and exported as SVG; the content
 * script cannot read those files, so their geometry is inlined in icons.ts.
 * Two copies of the same thing drift, and the way they drift is silent: the
 * SVG gets redrawn, the export lands in the repo, the toolbar keeps shipping
 * last month's shape and every existing test still passes because the shapes
 * are only ever compared with each other.
 *
 * So this compares them with the source. It also refuses the export's own
 * colour and weight attributes, which is the other half of the same mistake --
 * pasting an exported `stroke="#16181E"` into the module would nail the icons
 * to near-black inside somebody else's page and stop them turning white when
 * a mode is switched on.
 */

/** The drawing each action uses. Only `close` differs from its action name. */
const SOURCES: Record<ToolbarAction, string> = {
  audit: 'audit.svg',
  select: 'select.svg',
  comment: 'comment.svg',
  inspect: 'inspect.svg',
  report: 'report.svg',
  settings: 'settings.svg',
  close: 'cancel.svg',
};

const read = (file: string): string => readFileSync(resolve('design/icons', file), 'utf8');

/** Every `d`, in document order -- which is paint order, so it has to match. */
const pathsOf = (svg: string): string[] => [...svg.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]!);

/**
 * The one deliberate difference, kept here rather than as a silent exception.
 *
 * audit.svg draws the magnifier's handle as a filled outline of a 1.5-wide
 * line. Filled shapes hold their width while stroked ones follow stroke-width,
 * so that one path would have stayed put while the other six icons re-weighted
 * around it. icons.ts draws the same line as a stroke instead.
 *
 * If the source handle is ever redrawn as something other than that outline,
 * this stops matching and the substitution has to be re-decided rather than
 * inherited.
 */
const AUDIT_HANDLE_OUTLINE =
  'M20.4697 21.5303C20.7626 21.8232 21.2374 21.8232 21.5303 21.5303C21.8232 21.2374 21.8232 20.7626 21.5303 20.4697L21 21L20.4697 21.5303ZM15 15L14.4697 15.5303L20.4697 21.5303L21 21L21.5303 20.4697L15.5303 14.4697L15 15Z';
const AUDIT_HANDLE_STROKED = 'M15 15 21 21';

describe('the toolbar icons', () => {
  it('covers every action exactly once, with no shape shared between two', () => {
    expect(Object.keys(TOOLBAR_ICONS).sort()).toEqual(Object.keys(SOURCES).sort());

    const drawings = Object.values(TOOLBAR_ICONS).map((paths) => paths.join('|'));
    expect(new Set(drawings).size, 'two actions are drawn with the same icon').toBe(drawings.length);

    for (const [action, paths] of Object.entries(TOOLBAR_ICONS)) {
      expect(paths.length, `${action} has no geometry`).toBeGreaterThan(0);
      for (const d of paths) expect(d.trim(), `${action} has an empty path`).not.toBe('');
    }
  });

  it('matches the SVG each one was drawn from', () => {
    for (const [action, file] of Object.entries(SOURCES) as [ToolbarAction, string][]) {
      const svg = read(file);
      // The whole set shares one 24x24 grid; one icon on a different grid would
      // render at a different apparent size with nothing else looking wrong.
      expect(svg, `${file} is not on the 24x24 grid`).toContain('viewBox="0 0 24 24"');

      const expected = pathsOf(svg);
      if (action === 'audit') {
        expect(expected[1], 'the audit handle is no longer the outline icons.ts replaces').toBe(
          AUDIT_HANDLE_OUTLINE,
        );
        expected[1] = AUDIT_HANDLE_STROKED;
      }
      expect([...TOOLBAR_ICONS[action]], `${action} has drifted from ${file}`).toEqual(expected);
    }
  });

  it('is geometry and nothing else', () => {
    /*
     * The type already makes colour un-expressible: an icon is a list of path
     * strings, so there is nowhere to put a `stroke` or a `fill`. What is still
     * possible is an attribute landing *inside* a path string -- a sloppy paste
     * from an exporter, which renders as an invisible icon rather than an
     * error, because an unparseable `d` draws nothing at all.
     *
     * So every path is checked against the SVG path grammar's alphabet:
     * commands, numbers, and the separators between them.
     */
    for (const [action, paths] of Object.entries(TOOLBAR_ICONS)) {
      for (const d of paths) {
        expect(d, `${action} has something other than path data in it`).toMatch(
          /^[MmZzLlHhVvCcSsQqTtAa0-9.,\-+eE\s]+$/,
        );
      }
    }
  });
});
