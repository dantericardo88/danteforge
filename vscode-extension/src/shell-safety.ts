const FORBIDDEN_SHELL_CHARS = /["'`$&|;<>\\\r\n]/g;
const ALLOWED_TEXT = /[^A-Za-z0-9\s._,:/@%+\-!?]/g;

export function sanitizeShellInput(input: string): string {
  return input
    .replace(FORBIDDEN_SHELL_CHARS, ' ')
    .replace(ALLOWED_TEXT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSpecifyCommand(idea: string): string {
  return `danteforge ${buildSpecifySubcommand(idea)}`;
}

export function buildSpecifySubcommand(idea: string): string {
  const sanitizedIdea = sanitizeShellInput(idea);
  if (!sanitizedIdea) {
    throw new Error('Please enter an idea with letters or numbers.');
  }
  return `specify "${sanitizedIdea}"`;
}
