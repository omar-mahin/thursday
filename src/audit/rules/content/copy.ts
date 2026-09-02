import type { ElementSnapshot } from '../../../shared/types';
import type { Rule } from '../../types';
import { describe, finding } from '../../types';
import { normalizeLabel, readability, upperCaseRatio } from '../../measure/text';

const isLinkOrButton = (element: ElementSnapshot): boolean =>
  element.tagName === 'a' || element.tagName === 'button' || element.role === 'link' || element.role === 'button';

/**
 * CNT-001 - link and button labels that say nothing on their own.
 *
 * Screen reader users navigate by pulling up a list of links, out of context.
 * "Learn more" repeated eight times is a list of eight identical entries. The
 * phrase list is a user setting, because the right answer is domain-specific.
 */
export const vagueLabels: Rule = {
  id: 'CNT-001',
  category: 'content',
  kind: 'rule',
  scope: 'element',
  description: 'Link and button labels should make sense out of context',
  run({ candidates, settings }) {
    const phrases = new Set(settings.vaguePhrases.map(normalizeLabel));
    const results = [];
    for (const element of candidates) {
      if (!isLinkOrButton(element)) continue;
      const name = element.accessibleName.name;
      if (!name) continue; // A11Y-007 covers the empty case
      if (!phrases.has(normalizeLabel(name))) continue;

      results.push(
        finding(vagueLabels, {
          title: `Label "${name}" does not describe its destination`,
          summary: `${describe(element)} is labelled "${name}", which carries no meaning when read on its own.`,
          evidence: [
            `Accessible name: "${name}".`,
            element.href ? `Destination: ${element.href}.` : 'No href; this is an in-page action.',
            'Screen reader users often browse a list of links stripped of surrounding text.',
          ],
          impact: 'Out of context the label gives no clue where it goes, and repeated instances are indistinguishable.',
          recommendation: `Say what is on the other side, e.g. "${element.href ? `View ${element.href.split('/').filter(Boolean).pop() ?? 'the details'}` : 'Start the trial'}".`,
          elementIndex: element.index,
          severity: 'medium',
          measurements: { label: name },
        }),
      );
    }
    return results;
  },
};

/**
 * CNT-002 - identical link text pointing at different places.
 *
 * Deterministic, and a genuine failure of WCAG 2.4.4's intent: two links that
 * announce the same thing and go somewhere different.
 */
export const duplicateLinkText: Rule = {
  id: 'CNT-002',
  category: 'content',
  kind: 'rule',
  scope: 'page',
  description: 'Links with the same label should go to the same place',
  run({ candidates }) {
    const byLabel = new Map<string, ElementSnapshot[]>();
    for (const element of candidates) {
      if (element.tagName !== 'a' && element.role !== 'link') continue;
      if (!element.href) continue;
      const name = normalizeLabel(element.accessibleName.name);
      if (!name) continue;
      const bucket = byLabel.get(name);
      if (bucket) bucket.push(element);
      else byLabel.set(name, [element]);
    }

    const results = [];
    for (const [name, links] of byLabel) {
      const destinations = new Set(links.map((link) => link.href));
      if (links.length < 2 || destinations.size < 2) continue;
      results.push(
        finding(duplicateLinkText, {
          title: `"${links[0]!.accessibleName.name}" links to ${destinations.size} different places`,
          summary: `${links.length} links share the label "${links[0]!.accessibleName.name}" but point at ${destinations.size} different destinations.`,
          evidence: [
            `Label: "${links[0]!.accessibleName.name}" (${links.length} occurrences).`,
            ...[...destinations].slice(0, 4).map((href) => `Destination: ${href}`),
          ],
          impact: 'Anyone navigating by link list sees identical entries that behave differently.',
          recommendation: 'Give each link a label describing its own destination.',
          elementIndex: links[1]?.index,
          relatedIndexes: links.map((link) => link.index),
          severity: 'medium',
          measurements: { label: name, occurrences: links.length, destinations: destinations.size },
        }),
      );
    }
    return results;
  },
};

const LONG_PARAGRAPH_WORDS = 90;

/** CNT-003 - paragraphs long enough that people skip them. */
export const longParagraphs: Rule = {
  id: 'CNT-003',
  category: 'content',
  kind: 'heuristic',
  scope: 'element',
  description: 'Body paragraphs should stay scannable',
  run({ candidates }) {
    const results = [];
    for (const element of candidates) {
      if (element.tagName !== 'p') continue;
      const text = element.text?.trim();
      if (!text) continue;
      // Counted during collection, before the text was capped.
      const count = element.wordCount;
      if (count < LONG_PARAGRAPH_WORDS) continue;

      results.push(
        finding(longParagraphs, {
          title: `Paragraph runs to ${count} words`,
          summary: `A single paragraph of ${count} words asks for sustained reading on a page people are scanning.`,
          evidence: [
            `${count} words in one paragraph.`,
            `Opening: "${text.slice(0, 80)}…".`,
          ],
          impact: 'Long unbroken text gets skipped, so whatever it contains does not land.',
          recommendation: 'Split it, or pull the key point into a heading or list.',
          elementIndex: element.index,
          severity: 'low',
          measurements: { words: count, threshold: LONG_PARAGRAPH_WORDS },
        }),
      );
    }
    return results;
  },
};

/**
 * CNT-004 - reading difficulty of the body copy.
 *
 * Always `info`. A grade level is a fact about sentence and word length, not a
 * verdict: technical documentation is legitimately grade 14, and a rule that
 * calls that a defect would be wrong about its own evidence.
 */
export const readingDifficulty: Rule = {
  id: 'CNT-004',
  category: 'content',
  kind: 'heuristic',
  scope: 'page',
  description: 'Reports the reading grade of the page body copy',
  run({ candidates }) {
    const body = candidates
      .filter((element) => element.tagName === 'p' || element.tagName === 'li')
      .map((element) => element.text?.trim() ?? '')
      .filter((text) => text.length > 0)
      .join(' ');

    const score = readability(body);
    if (!score) return [];
    if (score.grade < 12) return [];

    return [
      finding(readingDifficulty, {
        title: `Body copy reads at about grade ${score.grade}`,
        summary: `Across ${score.words} words, the copy averages ${score.averageWordsPerSentence} words per sentence, giving a Flesch-Kincaid grade of ${score.grade}.`,
        evidence: [
          `${score.words} words in ${score.sentences} sentences.`,
          `Average ${score.averageWordsPerSentence} words per sentence.`,
          `Flesch-Kincaid grade level ${score.grade}.`,
        ],
        impact: 'Denser prose is slower to read for everyone, and much slower for non-native speakers.',
        recommendation: 'Shorten the longest sentences. Whether this grade is right depends on your audience.',
        severity: 'info',
        measurements: {
          grade: score.grade,
          words: score.words,
          wordsPerSentence: score.averageWordsPerSentence,
        },
      }),
    ];
  },
};

const SHOUT_MIN_LETTERS = 25;

/** CNT-005 - long runs of capitals, which are slower to read. */
export const shoutingText: Rule = {
  id: 'CNT-005',
  category: 'content',
  kind: 'heuristic',
  scope: 'element',
  description: 'Long stretches of capitals are hard to read',
  run({ candidates }) {
    const results = [];
    for (const element of candidates) {
      const text = element.text?.trim();
      if (!text) continue;
      const letters = text.replace(/[^\p{L}]/gu, '');
      if (letters.length < SHOUT_MIN_LETTERS) continue; // acronyms and labels are fine
      if (upperCaseRatio(text) < 0.9) continue;
      // text-transform is a styling choice; the source text is still readable.
      const fromCss = element.styles.textTransform === 'uppercase';
      if (fromCss) continue;

      results.push(
        finding(shoutingText, {
          title: 'Long passage set in capitals',
          summary: `${describe(element)} contains ${letters.length} letters, effectively all capitals.`,
          evidence: [
            `${Math.round(upperCaseRatio(text) * 100)}% of letters are upper case across ${letters.length} letters.`,
            `Text: "${text.slice(0, 60)}…".`,
            'The capitals are in the content, not applied by text-transform.',
          ],
          impact: 'Capitals remove word shapes, which slows reading measurably for long passages.',
          recommendation: 'Write in sentence case and use text-transform if you want the uppercase look.',
          elementIndex: element.index,
          severity: 'low',
          measurements: { letters: letters.length },
        }),
      );
    }
    return results;
  },
};

const UNHEADED_TEXT_WORDS = 120;

/** CNT-006 - a long stretch of copy with no heading to anchor it. */
export const sectionWithoutHeading: Rule = {
  id: 'CNT-006',
  category: 'content',
  kind: 'heuristic',
  scope: 'page',
  description: 'Long passages should sit under a heading',
  run({ candidates }) {
    const paragraphs = candidates.filter(
      (element) => (element.tagName === 'p' || element.tagName === 'li') && (element.text?.trim().length ?? 0) > 0,
    );
    if (paragraphs.length === 0) return [];

    const unheaded = paragraphs.filter((element) => element.precedingHeading === null);
    const wordCount = unheaded.reduce((total, element) => total + element.wordCount, 0);
    if (wordCount < UNHEADED_TEXT_WORDS) return [];

    return [
      finding(sectionWithoutHeading, {
        title: `About ${wordCount} words sit above any heading`,
        summary: `${unheaded.length} text block${unheaded.length === 1 ? '' : 's'} appear before the first heading, so there is nothing to tell a scanner what they are about.`,
        evidence: [
          `${wordCount} words across ${unheaded.length} block(s) with no preceding heading.`,
          `First block: "${(unheaded[0]?.text ?? '').slice(0, 70)}…".`,
        ],
        impact: 'People scanning by heading, and screen reader users navigating by outline, skip past unlabelled copy.',
        recommendation: 'Add a heading above this content, or move it under the heading it belongs to.',
        elementIndex: unheaded[0]?.index,
        severity: 'low',
        measurements: { words: wordCount, blocks: unheaded.length },
      }),
    ];
  },
};
