import { STORAGE_KEY_PREFIX } from '../shared/constants/product';

/** Small, frequently read values live in chrome.storage.local. Audit data goes
 *  to IndexedDB in Sprint 5. Nothing leaves the machine either way. */
export type ToolbarPosition = { x: number; y: number };

export type Settings = {
  toolbarPosition: ToolbarPosition | null;
  theme: 'system' | 'dark' | 'light';
  minTouchTarget: number;
};

export const DEFAULT_SETTINGS: Settings = {
  toolbarPosition: null,
  theme: 'system',
  minTouchTarget: 44,
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
