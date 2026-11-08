import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeSafeExternalUrl, openSafeExternalUrl } from '../../shared/externalUrl';
import type { ExternalUrlPort } from '../../shared/externalUrl';

export interface SafeMarkdownProps {
  markdown: string;
  className?: string;
  emptyText?: string;
  urlPort?: ExternalUrlPort;
  onLinkError?: (error: unknown) => void;
}

/**
 * 安全 Markdown 渲染器（ADR 0026 & UI风格规范 §11.17）：
 * - 基于 react-markdown + remark-gfm；
 * - 禁用 raw HTML 执行（不启用 rehype-raw）；
 * - 仅 http/https 链接渲染为可点击外链，点击 stopPropagation 并走窄命令 open_external_url；
 * - 危险协议（javascript:/file:/data: 等）渲染为不可点击的纯文本标记，保存时仍保留用户原文不清洗。
 */
export function SafeMarkdown({
  markdown,
  className = '',
  emptyText = '（暂无详情内容）',
  urlPort,
  onLinkError,
}: SafeMarkdownProps) {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return (
      <div className={`md-body md-empty${className ? ` ${className}` : ''}`}>
        <p className="md-placeholder">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className={`md-body${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={url => normalizeSafeExternalUrl(url)?.href ?? ''}
        components={{
          a({ href, children }) {
            const safe = normalizeSafeExternalUrl(href);
            if (!safe) {
              return (
                <span className="md-unsafe-link" title="已阻止非 http/https 协议链接">
                  {children}
                </span>
              );
            }
            return (
              <a
                href={safe.href}
                className="md-link"
                title={`打开外部链接：${safe.href}`}
                rel="noopener noreferrer"
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  void openSafeExternalUrl(safe.href, urlPort).catch(err => onLinkError?.(err));
                }}
              >
                {children}
                <span className="md-link-arrow" aria-hidden="true"> ↗</span>
              </a>
            );
          },
          img({ alt, src }) {
            const safe = normalizeSafeExternalUrl(src);
            return (
              <span className="md-img-fallback">
                [图片{alt ? `：${alt}` : ''}{safe ? ` (${safe.host})` : ''}]
              </span>
            );
          },
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
