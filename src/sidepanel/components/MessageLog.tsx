import type { LogEntry } from '../state/usePageConnection';

const time = (at: number): string => new Date(at).toLocaleTimeString([], { hour12: false });

/** Development aid behind FLAGS.messageLog: makes the message protocol visible
 *  while there is no audit UI to observe. */
export function MessageLog({ entries }: { entries: LogEntry[] }): React.ReactElement {
  return (
    <section>
      <div className="section-title">Messages</div>
      {entries.length === 0 ? (
        <div className="empty">Nothing yet.</div>
      ) : (
        <div className="log mono">
          {entries.map((entry) => (
            <div className="log-row" key={`${entry.at}-${entry.type}-${entry.direction}`}>
              <span className="log-dir">{entry.direction === 'in' ? '←' : '→'}</span>
              <span style={{ flex: 1 }}>{entry.type}</span>
              <span className="dim">{time(entry.at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
