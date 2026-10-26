import { describe, expect, it } from 'vitest';
import { decode, encode } from './frontmatter';

describe('frontmatter file contract', () => {
  it('accepts BOM and CRLF and leaves body delimiters intact', () => {
    const source = '\uFEFF---\r\nid: x\r\ncustom: yes\r\n---\r\nbody\r\n---\r\ntail';
    const parsed = decode(source, 'records/x.md');
    expect(parsed).toEqual({ meta: { id: 'x', custom: 'yes' }, body: 'body\n---\ntail' });
    expect(decode(encode(parsed.meta, parsed.body), 'records/x.md')).toEqual(parsed);
  });
  it('round-trips unknown nested metadata and multiline values', () => {
    const meta = { id: 'x', external: { tags: ['a', 'b'], nested: true }, note: 'first\nsecond' };
    expect(decode(encode(meta, '正文'), 'x.md')).toEqual({ meta, body: '正文' });
  });
  it.each(['body only', '---\nid: x', '---\n- not-an-object\n---\n', '---\na: [\n---\n', '---\na: 1\na: 2\n---\n'])('reports the path for invalid input %j', source => {
    expect(() => decode(source, 'records/broken.md')).toThrow('records/broken.md');
  });
});
