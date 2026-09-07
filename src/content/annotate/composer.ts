import { ANNOTATION_PRIORITIES, PRIORITY_LABELS } from '../../shared/constants/priority';
import type { AnnotationPriority } from '../../shared/types';

/**
 * Writing a comment on the page, where the thing being commented on is.
 *
 * This used to happen in the side panel: you clicked an element, then looked
 * away to a box somewhere else to say what you thought about it. Composing next
 * to the subject is the whole point of an on-page annotation tool, and it means
 * the element, the marker and the words are all in view at once.
 *
 * The panel keeps everything else about comments -- the list, editing, deleting,
 * adding more images later -- so there is exactly one place to write one and
 * exactly one place to manage them.
 *
 * Note what this does *not* do: store anything. It gathers what the user typed
 * and hands it over. Storage belongs to the panel, which owns the database, and
 * duplicating that here would be a second implementation of attachments,
 * refusals and the rest.
 */

export type ComposerSubmission = {
  body: string;
  priority: AnnotationPriority;
  files: File[];
};

export type ComposerCallbacks = {
  onSubmit(submission: ComposerSubmission): void;
  onCancel(): void;
  /** The user edited their name. Persisted by the caller. */
  onRename(name: string): void;
};

export type Composer = {
  /** Opens the card near a point in the viewport, over a given element rect. */
  open(anchor: { x: number; y: number; width: number; height: number }): void;
  close(): void;
  isOpen(): boolean;
  /** The name shown in the header. */
  setAuthor(name: string): void;
  /** Shown in place of the buttons while the panel is storing the comment. */
  setBusy(busy: boolean): void;
  fail(message: string): void;
  destroy(): void;
};

const GAP = 12;
const WIDTH = 320;

/** How many images one comment can carry from here. Matches the panel's own cap. */
const MAX_FILES = 6;

export function createComposer(layer: HTMLElement, callbacks: ComposerCallbacks): Composer {
  const card = document.createElement('div');
  card.className = 'cm-card';
  // A dialog, so a screen reader announces it as one and the name inside it is
  // read as the card's own label rather than as loose text on the page.
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Add a comment');

  // -- header: who is writing, and a way to change it ----------------------
  const head = document.createElement('div');
  head.className = 'cm-head';
  const who = document.createElement('span');
  who.className = 'cm-who';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'cm-name';
  nameInput.setAttribute('aria-label', 'Your name');
  nameInput.placeholder = 'Your name';
  nameInput.hidden = true;
  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'cm-edit';
  rename.textContent = 'Edit';
  head.append(who, nameInput, rename);

  // -- priority -------------------------------------------------------------
  const priorities = document.createElement('div');
  priorities.className = 'cm-priorities';
  // A radio group, not three buttons: they are one choice with one answer, and
  // arrow-key navigation between them comes free from the role.
  priorities.setAttribute('role', 'radiogroup');
  priorities.setAttribute('aria-label', 'Priority');
  const priorityButtons = new Map<AnnotationPriority, HTMLButtonElement>();
  for (const level of ANNOTATION_PRIORITIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-priority';
    button.dataset['level'] = level;
    button.setAttribute('role', 'radio');
    button.textContent = PRIORITY_LABELS[level];
    priorityButtons.set(level, button);
    priorities.append(button);
  }

  const body = document.createElement('textarea');
  body.className = 'cm-body';
  body.rows = 4;
  body.placeholder = 'Add a comment…';
  body.setAttribute('aria-label', 'Comment');

  const queue = document.createElement('ul');
  queue.className = 'cm-queue';

  const error = document.createElement('p');
  error.className = 'cm-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  // -- footer ---------------------------------------------------------------
  const foot = document.createElement('div');
  foot.className = 'cm-foot';
  const attach = document.createElement('button');
  attach.type = 'button';
  attach.className = 'cm-attach';
  // The button and the input it proxies for get different names. Sharing one
  // makes two controls answer to the same label, which is ambiguous for a
  // screen reader and for anything driving the card.
  attach.setAttribute('aria-label', 'Attach an image');
  attach.append(paperclip());
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/png,image/jpeg,image/webp';
  picker.multiple = true;
  picker.hidden = true;
  picker.setAttribute('aria-label', 'Attach images to this comment');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'cm-cancel';
  cancel.textContent = 'Cancel';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'cm-add';
  add.textContent = 'Add';
  const spacer = document.createElement('span');
  spacer.className = 'cm-spacer';
  foot.append(attach, picker, spacer, cancel, add);

  card.append(head, priorities, body, queue, error, foot);
  card.hidden = true;
  layer.append(card);

  let priority: AnnotationPriority = 'normal';
  let files: File[] = [];
  let visible = false;

  const paintPriority = (): void => {
    for (const [level, button] of priorityButtons) {
      const on = level === priority;
      button.dataset['on'] = on ? 'true' : 'false';
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      // Only the selected radio is in the tab order; the group is one stop and
      // the arrow keys move within it.
      button.tabIndex = on ? 0 : -1;
    }
  };

  const paintQueue = (): void => {
    queue.replaceChildren();
    for (const [index, file] of files.entries()) {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'cm-file';
      label.textContent = file.name;
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'cm-drop';
      drop.setAttribute('aria-label', `Remove ${file.name}`);
      drop.textContent = '×';
      drop.addEventListener('click', () => {
        files.splice(index, 1);
        paintQueue();
      });
      row.append(label, drop);
      queue.append(row);
    }
  };

  const showError = (message: string | null): void => {
    error.textContent = message ?? '';
    error.hidden = message === null;
  };

  const reset = (): void => {
    body.value = '';
    priority = 'normal';
    files = [];
    paintPriority();
    paintQueue();
    showError(null);
    nameInput.hidden = true;
    who.hidden = false;
    rename.textContent = 'Edit';
  };

  const submit = (): void => {
    const text = body.value.trim();
    if (text === '') {
      // Refused here rather than stored empty: an annotation with no body is
      // not a comment, and the panel would drop it silently.
      showError('Write something first.');
      body.focus();
      return;
    }
    callbacks.onSubmit({ body: text, priority, files: [...files] });
  };

  for (const [level, button] of priorityButtons) {
    button.addEventListener('click', () => {
      priority = level;
      paintPriority();
    });
  }
  priorities.addEventListener('keydown', (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = ANNOTATION_PRIORITIES.indexOf(priority);
    const next = ANNOTATION_PRIORITIES[(at + step + ANNOTATION_PRIORITIES.length) % ANNOTATION_PRIORITIES.length]!;
    priority = next;
    paintPriority();
    priorityButtons.get(next)?.focus();
  });

  attach.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    // Snapshotted before the input is cleared: a FileList read later is empty,
    // which is how an attachment gets silently lost.
    const chosen = [...(picker.files ?? [])];
    picker.value = '';
    if (chosen.length === 0) return;
    const room = MAX_FILES - files.length;
    files = [...files, ...chosen.slice(0, Math.max(0, room))];
    showError(chosen.length > room ? `Up to ${MAX_FILES} images on one comment.` : null);
    paintQueue();
  });

  rename.addEventListener('click', () => {
    if (nameInput.hidden) {
      nameInput.value = who.textContent ?? '';
      nameInput.hidden = false;
      who.hidden = true;
      rename.textContent = 'Done';
      nameInput.focus();
      nameInput.select();
      return;
    }
    const name = nameInput.value.trim();
    who.textContent = name === '' ? 'Nobody yet' : name;
    nameInput.hidden = true;
    who.hidden = false;
    rename.textContent = 'Edit';
    callbacks.onRename(name);
  });
  nameInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      rename.click();
    }
  });

  cancel.addEventListener('click', () => callbacks.onCancel());
  add.addEventListener('click', submit);
  card.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      callbacks.onCancel();
      return;
    }
    // Enter sends from the textarea only with a modifier: a comment is prose
    // and pressing Enter in it means a new paragraph.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  });

  paintPriority();

  return {
    open(anchor) {
      reset();
      card.hidden = false;
      visible = true;
      /*
       * Below the element by preference, above when there is no room. Measured
       * after unhiding, because a hidden card has no height and placing it on a
       * guess puts it half off the screen on the first open of every session.
       */
      const height = card.offsetHeight;
      const below = anchor.y + anchor.height + GAP;
      const above = anchor.y - height - GAP;
      const top = below + height <= window.innerHeight - 8 ? below : above >= 8 ? above : 8;
      const left = Math.max(8, Math.min(anchor.x, window.innerWidth - WIDTH - 8));
      card.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      body.focus();
    },
    close() {
      visible = false;
      card.hidden = true;
      reset();
    },
    isOpen: () => visible,
    setAuthor(name) {
      who.textContent = name.trim() === '' ? 'Nobody yet' : name;
    },
    setBusy(busy) {
      add.disabled = busy;
      cancel.disabled = busy;
      attach.disabled = busy;
      add.textContent = busy ? 'Adding…' : 'Add';
    },
    fail(message) {
      showError(message);
    },
    destroy() {
      card.remove();
    },
  };
}

/** The attach icon, drawn rather than fetched. */
function paperclip(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'cm-clip');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute(
    'd',
    'M9.5 14.5l5-5m-8.2 1.7l6.4-6.4a3.6 3.6 0 015.1 5.1l-8.5 8.5a2.4 2.4 0 01-3.4-3.4l8.5-8.5',
  );
  svg.append(path);
  return svg;
}
