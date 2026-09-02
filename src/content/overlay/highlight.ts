import type { Rect } from '../../shared/types';

export type HighlightLabel = {
  /** Short human-readable identity, e.g. `button.primary`. */
  selector: string;
  role?: string;
};

export type HighlightTone = 'hover' | 'selected';

export type Highlight = {
  show(rect: Rect, label: HighlightLabel, tone?: HighlightTone): void;
  /** Brief pulse used when jumping to an element from the panel. */
  flash(rect: Rect, label: HighlightLabel): void;
  hide(): void;
  destroy(): void;
};

const LABEL_HEIGHT = 22;
const GAP = 4;

export function createHighlight(layer: HTMLElement): Highlight {
  const box = document.createElement('div');
  box.className = 'hl-box';
  box.setAttribute('aria-hidden', 'true');

  const label = document.createElement('div');
  label.className = 'hl-label';
  label.setAttribute('aria-hidden', 'true');

  const identity = document.createElement('span');
  identity.className = 'hl-identity';
  const size = document.createElement('span');
  size.className = 'hl-size';
  label.append(identity, size);

  layer.append(box, label);

  let flashTimer = 0;

  const place = (rect: Rect, text: HighlightLabel, tone: HighlightTone): void => {
    box.dataset['tone'] = tone;
    box.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.display = 'block';

    identity.textContent = text.role ? `${text.selector} · ${text.role}` : text.selector;
    size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;

    // Prefer above the element; fall back to inside-top when there is no room.
    const above = rect.y - LABEL_HEIGHT - GAP;
    const top = above >= 0 ? above : Math.min(rect.y + GAP, window.innerHeight - LABEL_HEIGHT - GAP);
    const left = Math.max(0, Math.min(rect.x, window.innerWidth - 240));
    label.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    label.style.display = 'flex';
  };

  return {
    show(rect, text, tone = 'hover') {
      if (flashTimer) {
        clearTimeout(flashTimer);
        flashTimer = 0;
      }
      place(rect, text, tone);
    },
    flash(rect, text) {
      place(rect, text, 'selected');
      box.dataset['flash'] = 'true';
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        delete box.dataset['flash'];
        box.style.display = 'none';
        label.style.display = 'none';
        flashTimer = 0;
      }, 1400);
    },
    hide() {
      if (flashTimer) return; // let a flash finish
      box.style.display = 'none';
      label.style.display = 'none';
    },
    destroy() {
      if (flashTimer) clearTimeout(flashTimer);
      box.remove();
      label.remove();
    },
  };
}

/** Short identity string for the overlay label and the panel header. */
export function describeForLabel(element: Element): HighlightLabel {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute('id');
  if (id) return { selector: `${tag}#${id}` };
  const first = element.classList.item(0);
  return { selector: first ? `${tag}.${first}` : tag };
}
