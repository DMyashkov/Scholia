export function formatRagError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('signal') && lower.includes('aborted')) {
    return 'The request timed out — the assistant took too long to respond. Try again, or simplify your question.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network error')) {
    return 'Network error — could not reach the server. Check your connection and try again.';
  }
  return raw;
}
