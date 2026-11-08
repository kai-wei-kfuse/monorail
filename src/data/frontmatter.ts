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

/**
 * ADR 0026 D2 记录专用原串边界读取：
 * 在不改写结束线后 rawBody 换行（保留 CRLF / 单 CR）的前提下拆出 YAML 头部与原始正文切片，
 * 仅对头部做 YAML 解析；从 rawBody 临时派生语义归一正文 normalizedBody（N(rawBody)）。
 */
export function splitRecordFrontmatter(rawText: string, path: string): {
  meta: Record<string, unknown>;
  rawBody: string;
  normalizedBody: string;
} {
  const withoutBom = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText;
  const match = /^---(?:\r\n|\n)([\s\S]*?)(?:\r\n|\n)---(?:\r\n|\n|$)/.exec(withoutBom);
  if (!match) throw new Error(`${path}: missing YAML frontmatter`);
  try {
    const meta: unknown = parse(match[1].replace(/\r\n/g, '\n'));
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('metadata must be an object');
    const rawBody = withoutBom.slice(match[0].length);
    const normalizedBody = rawBody.replace(/\r\n|\r/g, '\n');
    return { meta: meta as Record<string, unknown>, rawBody, normalizedBody };
  } catch (error) {
    throw new Error(`${path}: invalid YAML`, { cause: error });
  }
}

export function encode(meta: unknown, body: string): string { return `---\n${stringify(meta)}---\n${body}`; }
