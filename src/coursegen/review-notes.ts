// Helpers for persisting practice-review findings in course state.
// Findings lists are stored newline-delimited; legacy states may still hold a
// single '; '-joined string, which degrades to one finding on restore.

export function joinReviewNotes(findings: string[]): string {
  return findings.join('\n');
}

export function splitStoredReviewNotes(notes: string): string[] {
  const trimmed = notes.trim();
  if (!trimmed) return [];
  if (trimmed.includes('\n')) {
    return trimmed.split('\n').map(item => item.trim()).filter(Boolean);
  }
  return [trimmed];
}

/**
 * Collapse embedded newlines in a raw error message so it stays a single
 * stored finding instead of splitting into many bogus ones.
 */
export function singleLineNote(message: string): string {
  return message.replace(/[^\S\n]*\n\s*/g, '; ').trim();
}

/** Tooling/Playwright failures — not fixable by editing practice HTML. */
export function isQaInfrastructureFinding(finding: string): boolean {
  return finding.trimStart().startsWith('QA infrastructure error:');
}

/** Shell chrome QA failures — fix belongs in activity-shell (shell.css/shell.js), not stage.js. */
export function isShellChromeFinding(finding: string): boolean {
  const trimmed = finding.trimStart();
  return /^(?:Responsive readability check:\s*)?(?:\[[^\]]+\]\s*)*\[shell-chrome\]\s/.test(trimmed);
}

/** Legacy stored notes from before shell-chrome tagging — same non-repairable semantics. */
export function isLegacyShellChromeFinding(finding: string): boolean {
  return /do not change shell chrome/i.test(finding);
}

export function filterRepairableFindings(findings: string[]): string[] {
  return findings
    .map(f => f.trim())
    .filter(f => f && !isQaInfrastructureFinding(f) && !isShellChromeFinding(f) && !isLegacyShellChromeFinding(f));
}
