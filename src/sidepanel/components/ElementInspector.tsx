import type { SelectedElement } from '../../shared/messaging/protocol';
import type { ElementSnapshot, ResolutionLevel } from '../../shared/types';

const NAME_SOURCE_LABEL: Record<string, string> = {
  'aria-labelledby': 'aria-labelledby',
  'aria-label': 'aria-label',
  'label-for': '<label for>',
  'label-wrapped': 'wrapping <label>',
  legend: '<legend>',
  caption: '<caption>',
  alt: 'alt text',
  value: 'value attribute',
  text: 'text content',
  title: 'title attribute',
  placeholder: 'placeholder',
  none: 'none',
};

const RESOLUTION_LABEL: Record<ResolutionLevel, string> = {
  1: 'found by id',
  2: 'found by test attribute',
  3: 'found by role and name',
  4: 'found by text',
  5: 'found by position in the DOM — approximate',
  6: 'found by screen position — approximate',
};

const identity = (element: ElementSnapshot): string => {
  if (element.id) return `${element.tagName}#${element.id}`;
  const first = element.classNames[0];
  return first ? `${element.tagName}.${first}` : element.tagName;
};

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </>
  );
}

function Swatch({ color }: { color: string }): React.ReactElement {
  return (
    <span className="swatch-row">
      <span className="swatch" style={{ background: color }} aria-hidden="true" />
      <span className="mono">{color}</span>
    </span>
  );
}

export function ElementInspector({
  selection,
  resolution,
  onLocate,
  onSelectAnother,
}: {
  selection: SelectedElement | null;
  resolution: ResolutionLevel | null | 'unresolved';
  onLocate: () => void;
  onSelectAnother: () => void;
}): React.ReactElement {
  if (!selection) {
    return (
      <div className="empty">
        Nothing selected. Use <strong>Select</strong> and click an element on the page.
      </div>
    );
  }

  const { element, reference } = selection;
  const box = element.rect;
  const styles = element.styles;
  const name = element.accessibleName;

  return (
    <div className="stack">
      <div className="card stack">
        <div className="spread">
          <div className="mono truncate" title={identity(element)}>
            {identity(element)}
          </div>
          <span className="badge">{Math.round(box.width)} × {Math.round(box.height)}</span>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" onClick={onLocate}>
            Show on page
          </button>
          <button type="button" onClick={onSelectAnother}>
            Select another
          </button>
        </div>
        {resolution === 'unresolved' ? (
          <p className="hint" role="status" style={{ color: 'var(--danger)', margin: 0 }}>
            This element is no longer on the page.
          </p>
        ) : resolution !== null ? (
          <p className="hint" role="status" style={{ margin: 0 }}>
            {RESOLUTION_LABEL[resolution]}
          </p>
        ) : null}
      </div>

      <section className="card" data-card="identity">
        <div className="section-title">Identity</div>
        <dl className="kv">
          <Row label="Tag" value={element.tagName} />
          {element.role ? <Row label="Role" value={element.role} /> : null}
          {element.implicitRole && element.implicitRole !== element.role ? (
            <Row label="Implicit role" value={element.implicitRole} />
          ) : null}
          {element.headingLevel ? <Row label="Heading level" value={`h${element.headingLevel}`} /> : null}
          <Row label="Name" value={name.name || '—'} mono={false} />
          <Row label="Name from" value={NAME_SOURCE_LABEL[name.source] ?? name.source} />
          {element.href ? <Row label="Href" value={element.href} /> : null}
        </dl>
        {name.weak && name.name ? (
          <p className="hint" style={{ margin: '6px 0 0' }}>
            That name comes from a source assistive tech treats as a last resort.
          </p>
        ) : null}
        {element.redacted ? (
          <p className="hint" style={{ margin: '6px 0 0' }}>
            This is a sensitive field, so only its type was collected.
          </p>
        ) : null}
      </section>

      <section className="card" data-card="box">
        <div className="section-title">Box</div>
        <dl className="kv">
          <Row label="Size" value={`${box.width} × ${box.height}`} />
          <Row label="Viewport" value={`${box.x}, ${box.y}`} />
          <Row label="Document" value={`${element.documentRect.x}, ${element.documentRect.y}`} />
          <Row label="Padding" value={styles.padding.join(' ')} />
          <Row label="Margin" value={styles.margin.join(' ')} />
          <Row label="Border" value={styles.borderWidths.join(' ')} />
          <Row label="Display" value={`${styles.display} · ${styles.position}`} />
        </dl>
      </section>

      <section className="card" data-card="type">
        <div className="section-title">Type</div>
        <dl className="kv">
          <Row label="Family" value={styles.fontFamily.split(',')[0] ?? '—'} />
          <Row label="Size" value={`${styles.fontSize}px / ${styles.lineHeight}`} />
          <Row label="Weight" value={String(styles.fontWeight)} />
          {styles.letterSpacing !== 'normal' ? <Row label="Tracking" value={styles.letterSpacing} /> : null}
          {styles.textTransform !== 'none' ? <Row label="Transform" value={styles.textTransform} /> : null}
          <Row label="Align" value={styles.textAlign} />
        </dl>
      </section>

      <section className="card" data-card="color">
        <div className="section-title">Color</div>
        <dl className="kv">
          <dt>Text</dt>
          <dd>
            <Swatch color={styles.color} />
          </dd>
          <dt>Background</dt>
          <dd>
            {styles.backgroundColor === 'rgba(0, 0, 0, 0)' ? (
              <span className="hint">transparent — inherited from an ancestor</span>
            ) : (
              <Swatch color={styles.backgroundColor} />
            )}
          </dd>
          {styles.hasBackgroundImage ? (
            <>
              <dt>Image</dt>
              <dd className="hint">present — contrast cannot be computed reliably</dd>
            </>
          ) : null}
          <Row label="Radius" value={styles.borderRadius} />
          <Row label="Opacity" value={String(styles.opacity)} />
        </dl>
      </section>

      <section className="card" data-card="accessibility">
        <div className="section-title">Accessibility</div>
        <dl className="kv">
          <Row label="Interactive" value={element.interactive ? 'yes' : 'no'} />
          <Row label="Focusable" value={element.focusable ? 'yes' : 'no'} />
          <Row label="tabindex" value={element.tabIndex === -1 ? 'not set' : String(element.tabIndex)} />
          {element.disabled ? <Row label="Disabled" value="yes" /> : null}
          {element.ariaHidden ? <Row label="aria-hidden" value="true" /> : null}
          {element.form ? (
            <>
              <Row label="Field type" value={element.form.type} />
              <Row label="Labelled by" value={element.form.labelledBy} />
              <Row label="Required" value={element.form.required ? 'yes' : 'no'} />
            </>
          ) : null}
        </dl>
        {Object.keys(element.aria).length > 0 ? (
          <dl className="kv" style={{ marginTop: 6 }}>
            {Object.entries(element.aria).map(([key, value]) => (
              <Row key={key} label={key} value={value} />
            ))}
          </dl>
        ) : null}
        {element.form ? (
          <p className="hint" style={{ margin: '6px 0 0' }}>
            Field values are never read — not even whether the field is filled.
          </p>
        ) : null}
      </section>

      {element.text ? (
        <section className="card" data-card="text">
          <div className="section-title">Text</div>
          <div>{element.text}</div>
          {element.textLength > element.text.length ? (
            <p className="hint" style={{ margin: '6px 0 0' }}>
              Truncated from {element.textLength} characters.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="card" data-card="reference">
        <div className="section-title">Reference</div>
        <dl className="kv">
          {reference.stableAttribute ? (
            <Row label="Handle" value={`${reference.stableAttribute.name}="${reference.stableAttribute.value}"`} />
          ) : null}
          <Row label="Path" value={reference.structuralPath || '—'} />
          <Row label="Ancestry" value={reference.ancestry.join(' › ') || '—'} />
        </dl>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          Stored with the audit so this element can be found again after a reload.
        </p>
      </section>
    </div>
  );
}
