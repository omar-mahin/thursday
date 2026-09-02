import type { Envelope, PortName, ThursdayMessage } from './protocol';
import { isEnvelope } from './protocol';

export type TypedPort = {
  post(message: ThursdayMessage): void;
  onMessage(listener: (envelope: Envelope) => void): void;
  onDisconnect(listener: () => void): void;
  disconnect(): void;
};

/** Long-lived port to the service worker. Ports (not sendMessage) so the panel
 *  can stream audit progress and notice when the page goes away. */
export function connectPort(from: PortName): TypedPort {
  const port = chrome.runtime.connect({ name: from });
  return {
    post(message) {
      port.postMessage({ from, message } satisfies Envelope);
    },
    onMessage(listener) {
      port.onMessage.addListener((raw: unknown) => {
        if (isEnvelope(raw)) listener(raw);
      });
    },
    onDisconnect(listener) {
      port.onDisconnect.addListener(() => listener());
    },
    disconnect() {
      port.disconnect();
    },
  };
}

/** One-shot request to the service worker, for commands that need a reply. */
export async function sendCommand<T>(message: ThursdayMessage): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}
