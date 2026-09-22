/**
 * Editing a dotenv file in place.
 *
 * .env.local holds the Xero client secrets and the token encryption key, so a
 * script that sets one variable has to leave every other line exactly as it
 * found it. Rewriting the file from a parsed object would drop comments,
 * blank lines and ordering, and a subtly reordered credentials file is hard to
 * tell from a correct one until something stops working.
 *
 * Pure string in, string out, so the behaviour can be checked without putting
 * a real credentials file at risk.
 */

export function upsertEnvVar(contents: string, name: string, value: string, comment?: string): string {
  // Whichever the file already uses. Mixing them in a file Windows tools also
  // edit is how a diff turns into a whole-file rewrite.
  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);

  // Leading whitespace is legal in dotenv. A commented-out line is not a match:
  // "# NAME=" is documentation, and replacing it in place would leave the key
  // sitting behind a comment marker and silently unset.
  const at = lines.findIndex((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith(`${name}=`);
  });

  if (at >= 0) {
    lines[at] = `${name}=${value}`;
    return lines.join(eol);
  }

  const needsGap = contents.length > 0;
  const base = contents.length > 0 && !/\r?\n$/.test(contents) ? contents + eol : contents;
  return (
    base +
    (needsGap ? eol : "") +
    (comment ? `# ${comment}${eol}` : "") +
    `${name}=${value}${eol}`
  );
}
