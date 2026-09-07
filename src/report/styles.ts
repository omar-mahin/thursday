/**
 * The report's entire stylesheet, inlined.
 *
 * No web fonts and no CSS import: a report has to render identically on a
 * machine with no network, which is the point of it being a single file.
 */
export const REPORT_CSS = `
/* A comment's priority and its author. Outlined, never on the severity
   palette: an opinion and a measurement must not read as the same weight. */
.finding.comment .priority {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid currentColor;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}
.finding.comment .priority[data-level="medium"] { color: var(--medium); }
.finding.comment .priority[data-level="high"] { color: var(--critical); }
.finding.comment .byline { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--dim); }

:root {
  --fg: #16181d;
  --dim: #5b6270;
  --line: #dfe2e8;
  --bg: #ffffff;
  --raised: #f7f8fa;
  --critical: #c1123c;
  --high: #b8531f;
  --medium: #8a6300;
  --low: #2f5fd0;
  --info: #5b6270;
  --comment: #0f6b6b;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px 24px 64px;
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.sheet { max-width: 820px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 32px 0 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); }
h3 { font-size: 16px; margin: 0; }
h4 { font-size: 12px; margin: 0 0 3px; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); }
p { margin: 0 0 8px; }
ul { margin: 0; padding-left: 20px; }
a { color: var(--low); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.dim { color: var(--dim); }
header.report-head { border-bottom: 2px solid var(--fg); padding-bottom: 14px; }
.brand { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
.meta { display: grid; grid-template-columns: auto 1fr; gap: 2px 14px; font-size: 13px; margin-top: 10px; }
.meta dt { color: var(--dim); }
.meta dd { margin: 0; overflow-wrap: anywhere; }
.totals { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; padding: 0; list-style: none; }
.totals li {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 13px;
  font-weight: 600;
}
.totals li[data-severity="critical"] { color: var(--critical); }
.totals li[data-severity="high"] { color: var(--high); }
.totals li[data-severity="medium"] { color: var(--medium); }
.totals li[data-severity="low"] { color: var(--low); }
.totals li[data-severity="info"] { color: var(--info); }
.notice {
  border-left: 3px solid var(--medium);
  background: var(--raised);
  padding: 8px 12px;
  margin: 16px 0 0;
  font-size: 13px;
}
.finding {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
  margin: 0 0 12px;
  background: var(--bg);
  break-inside: avoid;
}
.finding-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.sev {
  flex: none;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.sev[data-severity="critical"] { color: var(--critical); }
.sev[data-severity="high"] { color: var(--high); }
.sev[data-severity="medium"] { color: var(--medium); }
.sev[data-severity="low"] { color: var(--low); }
.sev[data-severity="info"] { color: var(--info); }
.finding-head h3 { flex: 1; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; padding: 0; list-style: none; }
.tags li {
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 7px;
  font-size: 11px;
  color: var(--dim);
}
.block { margin: 10px 0 0; }
.note { border-left: 3px solid var(--low); background: var(--raised); padding: 8px 12px; margin: 10px 0 0; }
.shot { margin: 12px 0 0; }
.shot img { max-width: 100%; border: 1px solid var(--line); border-radius: 6px; display: block; }
.where { font-size: 12px; color: var(--dim); margin-top: 10px; overflow-wrap: anywhere; }
footer.report-foot {
  margin-top: 40px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--dim);
}
@media print {
  body { padding: 0; font-size: 11pt; }
  .finding { border-color: #bbb; }
  h2 { break-after: avoid; }
  a { color: inherit; text-decoration: none; }
  a[href]::after { content: " (" attr(href) ")"; font-size: 9pt; color: #555; }
}

/*
 * Comments are visibly the user's own: a teal rule down the side and a
 * lettered marker rather than a severity word, so nobody skims the report and
 * reads somebody's opinion as a measured result.
 */
.comments h2 { color: var(--comment); }
.finding.comment { border-left: 3px solid var(--comment); padding-left: 13px; }
.finding.comment .sev[data-kind="comment"],
.totals li[data-kind="comment"] { color: var(--comment); }
.shot figcaption { font-size: 12px; color: var(--dim); padding: 6px 2px 0; }
`;
