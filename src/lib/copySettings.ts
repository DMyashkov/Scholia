const KEY = 'scholia-copy-include-evidence';
export const COPY_SETTING_CHANGED = 'scholia-copy-setting-changed';

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
    window.dispatchEvent(new CustomEvent(COPY_SETTING_CHANGED, { detail: include }));
  } catch {
    // ignore
  }
}
