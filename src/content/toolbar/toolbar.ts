import { PRODUCT_NAME } from '../../shared/constants/product';
import type { ToolbarAction } from '../../shared/messaging/protocol';

export type ToolbarOptions = {
  onAction(action: ToolbarAction): void;
  onMoved(position: { x: number; y: number }): void;
  initialPosition: { x: number; y: number } | null;
};

export type Toolbar = {
  element: HTMLElement;
  setPressed(action: ToolbarAction, pressed: boolean): void;
  setEnabled(action: ToolbarAction, enabled: boolean): void;
  announce(text: string): void;
  destroy(): void;
};

type ButtonSpec = {
  action: ToolbarAction;
  label: string;
  /** Icon-only buttons get an aria-label instead of visible text. */
  icon?: string;
  enabled: boolean;
};

const BUTTONS: ButtonSpec[] = [
  { action: 'audit', label: 'Audit', enabled: false },
  { action: 'select', label: 'Select', enabled: false },
  { action: 'inspect', label: 'Inspect', enabled: false },
  { action: 'report', label: 'Report', enabled: false },
];

const ICON_BUTTONS: ButtonSpec[] = [
  { action: 'settings', label: 'Settings', icon: '⚙', enabled: true },
  { action: 'close', label: `Close ${PRODUCT_NAME}`, icon: '✕', enabled: true },
];

const MARGIN = 12;

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

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.textContent = PRODUCT_NAME;

  const live = document.createElement('div');
  live.className = 'sr';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');

  element.append(grip, brand, separator());

  const buttons = new Map<ToolbarAction, HTMLButtonElement>();
  const addButton = (spec: ButtonSpec): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset['action'] = spec.action;
    button.disabled = !spec.enabled;
    button.tabIndex = -1; // roving tabindex, set below
    if (spec.icon) {
      button.className = 'icon-btn';
      button.textContent = spec.icon;
      button.setAttribute('aria-label', spec.label);
    } else {
      button.textContent = spec.label;
      button.setAttribute('aria-pressed', 'false');
    }
    button.addEventListener('click', () => options.onAction(spec.action), { signal });
    buttons.set(spec.action, button);
    element.append(button);
  };

  for (const spec of BUTTONS) addButton(spec);
  element.append(separator());
  for (const spec of ICON_BUTTONS) addButton(spec);
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
  let position = options.initialPosition ?? defaultPosition();
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
      buttons.get(action)?.setAttribute('aria-pressed', String(pressed));
    },
    setEnabled(action, enabled) {
      const button = buttons.get(action);
      if (!button) return;
      button.disabled = !enabled;
      if (!focusables().some((b) => b.tabIndex === 0)) setRoving(focusables()[0]);
    },
    announce(text) {
      live.textContent = text;
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

function defaultPosition(): { x: number; y: number } {
  return { x: Math.max(MARGIN, Math.round(window.innerWidth / 2) - 180), y: MARGIN };
}
