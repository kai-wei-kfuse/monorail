import { parse, stringify } from 'yaml';

export function decode(text: string, path: string): { meta: Record<string, unknown>; body: string } {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match) throw new Error(`${path}: missing YAML frontmatter`);
  try {
    const meta: unknown = parse(match[1]);
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('metadata must be an object');
    return { meta: meta as Record<string, unknown>, body: normalized.slice(match[0].length) };
  } catch (error) { throw new Error(`${path}: invalid YAML`, { cause: error }); }
}

export function encode(meta: unknown, body: string): string { return `---\n${stringify(meta)}---\n${body}`; }
