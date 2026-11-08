// Author check of the proposed documents and byte rules; this is not a product test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const documents = [
  ['docs/stages/0.3.3-execution-plan.md', 'Draft v0.4'],
  ['docs/adr/0026-record-title-and-markdown-details.md', 'Proposed v0.4'],
  ['docs/adr/0027-multiple-main-tasks.md', 'Proposed v0.1'],
  ['docs/adr/0028-idea-document-window.md', 'Proposed v0.2'],
  ['docs/stages/changes/0.3.3-title-details-main-tasks.md', 'Discussion Draft v0.3'],
];
const links = [];
for (const [path, version] of documents) {
  const content = await readFile(resolve(root, path), 'utf8');
  assert(content.includes(version), `${path}: missing ${version}`);
  assert(content.includes('## Revision History'), `${path}: missing revision history`);
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^[a-z]+:/i.test(match[1])) continue;
    const target = resolve(dirname(resolve(root, path)), match[1].split('#')[0]);
    await access(target);
    links.push({ source: path, target: match[1] });
  }
}

const normalize = value => value.replace(/\r\n|\r/g, '\n');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Illustrative raw boundary splitter only. The production frontmatter module is unchanged.
function rawBody(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const match = /^\uFEFF?---(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---(?:(?:\r\n|\n|\r)|$)/.exec(text);
  assert(match, 'fixture: missing frontmatter');
  const offset = Buffer.byteLength(match[0], 'utf8');
  return bytes.subarray(offset);
}
const fixtures = [
  ['CRLF', '\r\n', '中文正文\r\n[资源](https://example.com)\r\n'],
  ['single-CR', '\r', '中文正文\r第二段\r'],
  ['mixed-body', '\r\n', '\r\n首段\n第二段\r第三段\r\n'],
  ['BOM-and-body-delimiter', '\n', '标题\r\n---\r\n尾段\r\n', '\uFEFF'],
  ['empty-body', '\n', ''],
];
const byteCases = [];
for (const [name, eol, original, bom = ''] of fixtures) {
  const file = Buffer.from(`${bom}---${eol}id: sample${eol}text: 原标题${eol}---${eol}${original}`, 'utf8');
  const body = rawBody(file);
  assert.deepEqual(body, Buffer.from(original, 'utf8'));
  for (const action of ['title-only', 'needs-only', 'lifecycle', 'equal-details-patch']) {
    const updated = Buffer.concat([Buffer.from('---\nid: sample\ntext: 新标题\n---\n'), body]);
    assert.deepEqual(rawBody(updated), body, `${name}/${action}: changed raw body`);
  }
  const changedBody = Buffer.from(normalize(`${original}新增\r\n正文`), 'utf8');
  assert(!changedBody.includes(13), `${name}: explicit content change should use LF`);
  byteCases.push({
    name,
    preservationCases: ['title-only', 'needs-only', 'lifecycle', 'equal-details-patch'],
    originalBodyHash: digest(body),
    semanticBodyHash: digest(Buffer.from(normalize(original), 'utf8')),
    explicitChangedBodyUsesLF: true,
  });
}
const lf = Buffer.from('首段\n尾段\n');
const crlf = Buffer.from('首段\r\n尾段\r\n');
assert.notEqual(digest(lf), digest(crlf));
assert.equal(digest(Buffer.from(normalize(lf.toString()))), digest(Buffer.from(normalize(crlf.toString()))));
assert.throws(() => rawBody(Buffer.from([0xff, 0xfe])), /encoded|encoding/i);
const packageVersion = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
assert.equal(packageVersion, '0.3.2');
const result = {
  scope: 'Author-only document links/version check and illustrative D2 byte-rule fixtures. Not production migration, state-machine, browser, receipt or Tauri validation.',
  generatedAt: new Date().toISOString(),
  status: 'PASS',
  documents: documents.map(([path, version]) => ({ path, version })),
  relativeLinksChecked: links.length,
  links,
  byteCases,
  sameSemanticDifferentBytes: { rawHashesDiffer: true, semanticDigestsEqual: true },
  invalidUTF8ExplicitlyRejected: true,
  packageVersion,
};
await writeFile(resolve(root, 'evidence/0.3.3-plan-v04-check.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`PLAN_V04_AUTHOR_CHECK_PASS: ${documents.length} documents, ${links.length} links, ${fixtures.length} byte fixtures; product unchanged at ${packageVersion}`);
