/**
 * Text measurements for the content rules. All pure, all cheap, all reported as
 * observations rather than verdicts: a reading grade is a fact about sentence
 * and word length, not a judgement about whether the copy is any good.
 */

const SENTENCE_SPLIT = /[.!?]+(?:\s|$)/;
const WORD_SPLIT = /[\s–—/]+/;

export const words = (text: string): string[] =>
  text
    .split(WORD_SPLIT)
    .map((word) => word.replace(/[^\p{L}\p{N}'’-]/gu, ''))
    .filter((word) => word.length > 0);

export const sentences = (text: string): string[] =>
  text
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

/**
 * Syllable estimate. Vowel-group counting with the usual English corrections --
 * approximate by nature, which is why the rule that uses it reports a grade
 * band as `info` rather than a failure.
 */
export function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (clean.length === 0) return 0;
  if (clean.length <= 3) return 1;

  const trimmed = clean
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 1);
}

export type Readability = {
  words: number;
  sentences: number;
  syllables: number;
  /** Flesch-Kincaid grade level. */
  grade: number;
  averageWordsPerSentence: number;
};

export function readability(text: string): Readability | null {
  const wordList = words(text);
  const sentenceList = sentences(text);
  if (wordList.length < 30 || sentenceList.length === 0) return null; // too little to judge

  const syllables = wordList.reduce((total, word) => total + countSyllables(word), 0);
  const wordsPerSentence = wordList.length / sentenceList.length;
  const syllablesPerWord = syllables / wordList.length;
  const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

  return {
    words: wordList.length,
    sentences: sentenceList.length,
    syllables,
    grade: Math.round(grade * 10) / 10,
    averageWordsPerSentence: Math.round(wordsPerSentence * 10) / 10,
  };
}

/** Letters that are upper case, ignoring digits and punctuation. */
export function upperCaseRatio(text: string): number {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length === 0) return 0;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  return upper / letters.length;
}

/** Normalized form for comparing link and button labels. */
export const normalizeLabel = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
