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
   * Whether the panel may crop screenshots of findings.
   *
   * Off by default, and deliberately so: a crop is a picture of the page, which
   * is the one kind of evidence that can contain something Thursday otherwise
   * never reads. Sensitive fields are refused even when this is on.
   */
  captureScreenshots: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  toolbarPosition: null,
  theme: 'system',
  minTouchTarget: 44,
  keepHistory: true,
  captureScreenshots: false,
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
