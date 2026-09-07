import { PRODUCT_CREDIT, PRODUCT_NAME } from '../../shared/constants/product';
import type { ToolbarAction } from '../../shared/messaging/protocol';
import { createIcon, TOOLBAR_ICONS } from './icons';

export type ToolbarOptions = {
  onAction(action: ToolbarAction): void;
  onMoved(position: { x: number; y: number }): void;
  initialPosition: { x: number; y: number } | null;
};

export type Toolbar = {
  element: HTMLElement;
  setPressed(action: ToolbarAction, pressed: boolean): void;
  /**
   * Turns a button on or off, with a reason when turning it off.
   *
   * The reason is not optional decoration. A greyed-out button with a tooltip
   * that only repeats its own name tells the user nothing about what to do --
   * it is the same dead end as a button that leads nowhere, reached from the
   * other side. Whatever disables a button knows why, and this is where that
   * gets said.
   */
  setEnabled(action: ToolbarAction, enabled: boolean, reason?: string): void;
  announce(text: string): void;
  /**
   * Centres the toolbar on the viewport.
   *
   * Separate from construction because it has to measure, and an element that
   * is not in a document yet has no width. Called only when there is no
   * remembered position to honour.
   */
  centre(): void;
  destroy(): void;
};

type ButtonSpec = {
  action: ToolbarAction;
  /**
   * The accessible name, and the words the tooltip shows.
   *
   * One string for both, so a button can never be labelled one thing for a
   * screen reader and another for the pointer.
   */
  label: string;
  enabled: boolean;
  /** True for the two buttons that are modes rather than one-off actions. */
  toggle?: boolean;
};

/** The actions. Enabled once the page has answered. */
const BUTTONS: ButtonSpec[] = [
  { action: 'audit', label: 'Audit', enabled: false },
  { action: 'select', label: 'Select', enabled: false, toggle: true },
  { action: 'comment', label: 'Comment', enabled: false, toggle: true },
  { action: 'inspect', label: 'Inspect', enabled: false },
];

/** Utilities, always available, kept behind a separator. */
const UTILITY_BUTTONS: ButtonSpec[] = [
  { action: 'close', label: `Close ${PRODUCT_NAME}`, enabled: true },
];

const MARGIN = 12;

/** How close a tooltip may come to the window edge. */
const EDGE = 6;

export function createToolbar(options: ToolbarOptions): Toolbar {
  const controller = new AbortController();
  const { signal } = controller;

  const element = document.createElement('div');
  element.className = 'toolbar';
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', PRODUCT_NAME);
  element.setAttribute('aria-orientation', 'horizontal');

  const grip = document.createElement('div');
  grip.className = 'grip';
  grip.title = `Drag to move ${PRODUCT_NAME}`;
  for (let i = 0; i < 6; i += 1) grip.append(document.createElement('span'));

  /*
   * The brandmark, with its credit under it.
   *
   * Two elements rather than one string with a line break: the name and the
   * credit are set differently -- weight, size, colour -- and the difference
   * is what stops the credit competing with the product name.
   */
  const brand = document.createElement('div');
  brand.className = 'brand';
  const brandName = document.createElement('span');
  brandName.className = 'brand-name';
  brandName.textContent = PRODUCT_NAME;
  const brandCredit = document.createElement('span');
  brandCredit.className = 'brand-credit';
  brandCredit.textContent = PRODUCT_CREDIT;
  brand.append(brandName, brandCredit);

  const live = document.createElement('div');
  live.className = 'sr';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');

  element.append(grip, brand, separator());

  const buttons = new Map<ToolbarAction, HTMLButtonElement>();
  /** The plain label, so a reason can be appended to it and removed again. */
  const labels = new Map<ToolbarAction, string>();

  /**
   * One icon button.
   *
   * The name lives in `aria-label` and the tooltip is `aria-hidden`, rather
   * than the other way round. It matters: the tooltip is only visible on hover
   * or focus, so if the accessible name came from it, the name would blink in
   * and out of existence with the pointer. This way the label is constant and
   * the tooltip is decoration that happens to say the same thing.
   */
  const addButton = (spec: ButtonSpec): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tb-btn';
    button.dataset['action'] = spec.action;
    button.disabled = !spec.enabled;
    button.tabIndex = -1; // roving tabindex, set below
    button.setAttribute('aria-label', spec.label);
    // Only on the buttons that really are modes. A pressed state on a button
    // that just does a thing tells a screen-reader user it toggles when it
    // does not.
    if (spec.toggle) button.setAttribute('aria-pressed', 'false');

    labels.set(spec.action, spec.label);
    button.append(createIcon(TOOLBAR_ICONS[spec.action]));
    const tip = document.createElement('span');
    tip.className = 'tb-tip';
    tip.setAttribute('aria-hidden', 'true');
    tip.textContent = spec.label;
    // Carries the reason for a disabled button to assistive technology. Empty
    // and referenced by nothing until setEnabled fills it in.
    const why = document.createElement('span');
    why.className = 'sr tb-why';
    why.id = `why-${spec.action}`;
    button.append(tip, why);

    /*
     * Keeps the tip on screen.
     *
     * It is centred on its button by CSS, which is right until the toolbar is
     * near an edge -- and the toolbar is draggable, so it often is. Then half
     * the tip is outside the window and simply not there. "Close Thursday" was
     * already wide enough for this to bite; adding a reason to a disabled
     * button's tip made it certain.
     *
     * Measured on the way in rather than on a timer, because the text changes:
     * a button can be disabled with a reason and enabled again, and the width
     * that needs clamping is whatever it says right now.
     */
    const clampTip = (): void => {
      tip.style.setProperty('--tb-shift', '0px');
      const box = tip.getBoundingClientRect();
      const overflowRight = box.right - (window.innerWidth - EDGE);
      const overflowLeft = EDGE - box.left;
      const shift = overflowRight > 0 ? -overflowRight : overflowLeft > 0 ? overflowLeft : 0;
      if (shift !== 0) tip.style.setProperty('--tb-shift', `${Math.round(shift)}px`);
    };
    button.addEventListener('pointerenter', clampTip, { signal });
    button.addEventListener('focus', clampTip, { signal });

    button.addEventListener('click', () => options.onAction(spec.action), { signal });
    buttons.set(spec.action, button);
    element.append(button);
  };

  for (const spec of BUTTONS) addButton(spec);
  element.append(separator());
  for (const spec of UTILITY_BUTTONS) addButton(spec);
  element.append(live);

  // --- roving tabindex (WAI-ARIA toolbar pattern) ---------------------------
  const focusables = (): HTMLButtonElement[] => [...buttons.values()].filter((b) => !b.disabled);
  const setRoving = (target: HTMLButtonElement | undefined): void => {
    for (const button of buttons.values()) button.tabIndex = button === target ? 0 : -1;
  };
  setRoving(focusables()[0]);

  element.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      const items = focusables();
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement === element ? items[0]! : (event.target as HTMLButtonElement));
      let next = -1;
      if (event.key === 'ArrowRight') next = (current + 1) % items.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + items.length) % items.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else if (event.key === 'Escape' && element.dataset['dragging'] === 'true') {
        cancelDrag();
        return;
      } else return;
      event.preventDefault();
      const target = items[next];
      if (!target) return;
      setRoving(target);
      target.focus();
    },
    { signal },
  );

  // --- dragging -------------------------------------------------------------
  let position = options.initialPosition ?? { x: MARGIN, y: MARGIN };
  let dragStart: { pointerX: number; pointerY: number; originX: number; originY: number } | null = null;
  let frame = 0;

  const apply = (): void => {
    element.style.transform = `translate3d(${Math.round(position.x)}px, ${Math.round(position.y)}px, 0)`;
  };
  apply();

  const clamp = (next: { x: number; y: number }): { x: number; y: number } => {
    const rect = element.getBoundingClientRect();
    const maxX = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
    return {
      x: Math.min(Math.max(next.x, MARGIN), maxX),
      y: Math.min(Math.max(next.y, MARGIN), maxY),
    };
  };

  function cancelDrag(): void {
    dragStart = null;
    element.dataset['dragging'] = 'false';
  }

  grip.addEventListener(
    'pointerdown',
    (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      dragStart = { pointerX: event.clientX, pointerY: event.clientY, originX: position.x, originY: position.y };
      element.dataset['dragging'] = 'true';
    },
    { signal },
  );

  grip.addEventListener(
    'pointermove',
    (event: PointerEvent) => {
      if (!dragStart) return;
      const next = {
        x: dragStart.originX + (event.clientX - dragStart.pointerX),
        y: dragStart.originY + (event.clientY - dragStart.pointerY),
      };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        position = clamp(next);
        apply();
      });
    },
    { signal },
  );

  const endDrag = (event: PointerEvent): void => {
    if (!dragStart) return;
    cancelDrag();
    grip.releasePointerCapture?.(event.pointerId);
    position = clamp(position);
    apply();
    options.onMoved(position);
  };
  grip.addEventListener('pointerup', endDrag, { signal });
  grip.addEventListener('pointercancel', endDrag, { signal });

  // Keep the toolbar on screen when the window changes size.
  window.addEventListener(
    'resize',
    () => {
      position = clamp(position);
      apply();
    },
    { signal, passive: true },
  );

  return {
    element,
    setPressed(action, pressed) {
      const button = buttons.get(action);
      // Guarded, so a caller cannot invent a pressed state on a button that
      // was never declared a toggle.
      if (button?.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', String(pressed));
    },
    setEnabled(action, enabled, reason) {
      const button = buttons.get(action);
      if (!button) return;
      button.disabled = !enabled;
      const label = labels.get(action) ?? '';
      const tip = button.querySelector('.tb-tip');
      if (tip) tip.textContent = !enabled && reason ? `${label} — ${reason}` : label;
      /*
       * The reason is a description, not part of the name.
       *
       * Putting it in the aria-label was the first attempt and it was wrong
       * twice over: a control's name should not change under the user, and
       * "Comment - run an audit first" contains the word "audit", which made
       * every query for the Audit button ambiguous. A description says the
       * same thing to a screen reader without renaming anything.
       */
      const because = button.querySelector('.tb-why');
      if (because) because.textContent = !enabled && reason ? reason : '';
      if (!enabled && reason) button.setAttribute('aria-describedby', `why-${action}`);
      else button.removeAttribute('aria-describedby');
      if (!focusables().some((b) => b.tabIndex === 0)) setRoving(focusables()[0]);
    },
    announce(text) {
      live.textContent = text;
    },
    centre() {
      position = clamp({ x: Math.round((window.innerWidth - element.offsetWidth) / 2), y: MARGIN });
      apply();
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      controller.abort();
      element.remove();
    },
  };
}

function separator(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'sep';
  return element;
}
