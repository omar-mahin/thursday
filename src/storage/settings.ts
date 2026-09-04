import { STORAGE_KEY_PREFIX } from '../shared/constants/product';

/** Small, frequently read values live in chrome.storage.local; audits and their
 *  screenshots live in IndexedDB (storage/db.ts). Nothing leaves the machine. */
export type ToolbarPosition = { x: number; y: number };

export type Settings = {
  toolbarPosition: ToolbarPosition | null;
  theme: 'system' | 'dark' | 'light';
  minTouchTarget: number;
  /**
   * Whether finished audits are written to IndexedDB.
   *
   * On by default, because history is the feature -- but auditing a page does
   * write its URL and title to disk, and someone working on a private system
   * is entitled to turn that off and still use the tool. With it off, nothing
   * is stored and saving a file is the only way to keep an audit.
   */
  keepHistory: boolean;
  /**
   * Whether an audit photographs its findings.
   *
   * On by default as of 1.0.1, which reverses an earlier decision, so the
   * reasoning belongs here rather than in a commit message.
   *
   * It was off because a picture of the page is the one kind of evidence that
   * can contain something Thursday otherwise never reads. That risk is real and
   * has not gone away -- what changed is that it is now handled rather than
   * avoided: every sensitive field on screen is painted out of every picture
   * before it is encoded, not merely the one being photographed.
   *
   * And off-by-default had its own cost, which turned out to be the larger one.
   * A report of thirty findings with no pictures does not say where any of them
   * are, and nobody found the setting that would have fixed it. A feature
   * nobody finds is not a safe default; it is a broken one.
   */
  captureScreenshots: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  toolbarPosition: null,
  theme: 'system',
  minTouchTarget: 44,
  keepHistory: true,
  captureScreenshots: true,
};

const key = <K extends keyof Settings>(name: K): string => `${STORAGE_KEY_PREFIX}${name}`;

export async function getSetting<K extends keyof Settings>(name: K): Promise<Settings[K]> {
  try {
    const stored = await chrome.storage.local.get(key(name));
    const value = stored[key(name)];
    return (value === undefined ? DEFAULT_SETTINGS[name] : value) as Settings[K];
  } catch {
    return DEFAULT_SETTINGS[name];
  }
}

export async function setSetting<K extends keyof Settings>(name: K, value: Settings[K]): Promise<void> {
  try {
    await chrome.storage.local.set({ [key(name)]: value });
  } catch {
    /* storage full or unavailable: a remembered toolbar position is not worth throwing over */
  }
}
