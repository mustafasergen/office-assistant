/** The first blockquote below the H1 is optional library metadata, not a source chunk. */
export function parseSeedDocument(raw: string, slug: string) {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  const header = normalized.match(/^#\s+([^\n]+)\n\s*\n> ([^\n]+)(?:\n|$)/);
  return {
    title: normalized.match(/^#\s+(.+)$/m)?.[1] ?? slug,
    description: header?.[2].trim() ?? '',
    content: header ? `# ${header[1]}\n\n${normalized.slice(header[0].length).trim()}` : normalized,
  };
}
