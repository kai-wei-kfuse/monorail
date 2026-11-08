import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { normalizeSafeExternalUrl } from '../../shared/externalUrl';
import { SafeMarkdown } from './SafeMarkdown';

describe('normalizeSafeExternalUrl & SafeMarkdown security boundary (ADR 0026)', () => {
  it('allows only valid http: and https: URLs and rejects javascript:, data:, file:, vbscript:, and relative paths', () => {
    expect(normalizeSafeExternalUrl('https://example.com/path?a=1#frag')?.href).toBe('https://example.com/path?a=1#frag');
    expect(normalizeSafeExternalUrl('  http://localhost:3000/test  ')?.href).toBe('http://localhost:3000/test');

    expect(normalizeSafeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSafeExternalUrl('JAVASCRIPT:alert(document.cookie)')).toBeNull();
    expect(normalizeSafeExternalUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBeNull();
    expect(normalizeSafeExternalUrl('file:///C:/Windows/System32/calc.exe')).toBeNull();
    expect(normalizeSafeExternalUrl('vbscript:msgbox(1)')).toBeNull();
    expect(normalizeSafeExternalUrl('/relative/path')).toBeNull();
    expect(normalizeSafeExternalUrl('')).toBeNull();
  });

  it('renders GFM headings, lists, code blocks, and safe http/https links while neutralizing dangerous URLs, raw HTML, and remote images', () => {
    const markdown = [
      '# 一级标题',
      '',
      '- [安全链接](https://example.com/docs)',
      '- [危险脚本](javascript:alert(1))',
      '- [本地文件](file:///C:/secret.txt)',
      '- ![远程图片](https://example.com/tracker.png)',
      '',
      '<script>window.pwned = true;</script>',
      '<img src="x" onerror="alert(1)" />',
      '',
      '```ts',
      'const x = "#代码块里的井号";',
      '```',
    ].join('\n');

    const html = renderToStaticMarkup(createElement(SafeMarkdown, { markdown }));

    // Safe https link is rendered as clickable <a href="https://example.com/docs">
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('class="md-link"');

    // Dangerous links must NOT be rendered as <a href="javascript:..."> or <a href="file:...">
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="file:');
    expect(html).toContain('class="md-unsafe-link"');

    // Raw HTML (<script>, <img onerror>) must NOT execute as DOM elements
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');

    // Remote Markdown image must NOT emit an <img> tag that auto-fetches remote content
    expect(html).not.toContain('<img');
    expect(html).toContain('[图片：远程图片 (example.com)]');
  });
});
