import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Encode text for Scroll to Text Fragment (#:~:text=) URLs.
 * Per spec, dash (-), ampersand (&), and comma (,) must be percent-encoded so they
 * aren't interpreted as delimiters. encodeURIComponent handles & and , but NOT hyphen.
 */
export function encodeTextForFragment(text: string): string {
  return encodeURIComponent(text).replace(/-/g, '%2D');
}

/** Derive a human-readable title from a URL (e.g. /wiki/Miss_Meyers → "Miss Meyers"). */
export function deriveTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split('/').filter(Boolean);
    const last = pathParts[pathParts.length - 1];
    if (last) return decodeURIComponent(last).replace(/_/g, ' ');
    return u.hostname || url;
  } catch {
    return url;
  }
}
