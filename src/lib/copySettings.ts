const KEY = 'scholia-copy-include-evidence';

export function getCopyIncludeEvidence(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'false') return false;
    if (v === 'true') return true;
  } catch {
    // ignore
  }
  return true; // default: with evidence
}

export function setCopyIncludeEvidence(include: boolean): void {
  try {
    localStorage.setItem(KEY, String(include));
  } catch {
    // ignore
  }
}
