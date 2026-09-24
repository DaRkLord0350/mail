// Pure helpers for email addresses (safe for client and server).

/** Trim, strip `mailto:` / angle brackets, lowercase. */
export function normalizeEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  let e = String(raw).trim();
  e = e.replace(/^mailto:/i, "");
  const angle = e.match(/<([^>]+)>/);
  if (angle) e = angle[1];
  return e.trim().toLowerCase();
}

// Pragmatic RFC 5321-ish validation: no whitespace, one "@", sane local part,
// dot-separated domain labels and an alphabetic TLD of 2+ chars.
const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !LOCAL_RE.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL_RE.test(l))) return false;
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,63}$/i.test(tld) || /^xn--[a-z0-9-]+$/i.test(tld);
}
