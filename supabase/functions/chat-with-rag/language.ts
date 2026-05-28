import { normalizeSlotEntityString } from './utils.ts';

export type CorpusLanguage = { code: string; name: string };

function countRegex(s: string, re: RegExp): number {
  const m = s.match(re);
  return m ? m.length : 0;
}


export function inferCorpusLanguage(sample: string): CorpusLanguage {
  const text = (sample ?? '').trim();
  if (!text) return { code: 'und', name: 'Unknown' };

  const letters = countRegex(text, /\p{L}/gu);
  const cyr = countRegex(text, /[\u0400-\u04FF]/g);
  const greek = countRegex(text, /[\u0370-\u03FF]/g);
  const latin = countRegex(text, /[A-Za-z\u00C0-\u024F]/g);

  if (letters > 0 && cyr / letters >= 0.2) {
    return { code: 'bg', name: 'Bulgarian' };
  }
  if (letters > 0 && greek / letters >= 0.2) {
    return { code: 'el', name: 'Greek' };
  }
  if (letters > 0 && latin / letters >= 0.6) {
    return { code: 'en', name: 'English' };
  }
  return { code: 'und', name: 'Unknown' };
}

export function looksLikeLanguageMismatch(text: string, lang: CorpusLanguage): boolean {
  const s = normalizeSlotEntityString(text);
  if (!s) return false;
  if (lang.code === 'bg') {
    // Bulgarian corpus: output should contain Cyrillic
    return !/[\u0400-\u04FF]/.test(s);
  }
  if (lang.code === 'el') {
    // Greek corpus: output should contain Greek characters
    return !/[\u0370-\u03FF]/.test(s);
  }
  if (lang.code === 'en') {
    // English corpus: output shouldn't be mostly Cyrillic or Greek
    const letters = (s.match(/\p{L}/gu) ?? []).length;
    if (letters === 0) return false;
    const nonLatin = (s.match(/[\u0370-\u03FF\u0400-\u04FF]/g) ?? []).length;
    return nonLatin / letters >= 0.5;
  }
  return false;
}

export function formatCorpusLanguageLine(lang: CorpusLanguage): string {
  if (lang.code === 'und') return 'Corpus language: Unknown (und).';
  return `Corpus language: ${lang.name} (${lang.code}).`;
}

