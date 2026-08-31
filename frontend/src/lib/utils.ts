import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Strips HTML tags from a string, returning plain text. DOM-based (a
// detached element's `.textContent`) rather than a regex — regexes can't
// reliably handle malformed or nested markup, while letting the browser's
// own HTML parser build a real DOM and read `.textContent` back out is
// correct by construction for whatever it parses. Requires a real `document`
// (unavailable during SSR, same limitation DOMPurify has elsewhere in this
// codebase — see the comment on StaticBody's `useIsClient()` gating in
// content-slide-face.tsx); returns the input unchanged in that case, the
// same documented fallback shape DOMPurify itself uses, so callers that
// already only invoke this client-side (as content-slide-face.tsx does) see
// no behavior change, and any future SSR caller degrades safely rather than
// throwing.
export function stripHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.textContent ?? "";
}
