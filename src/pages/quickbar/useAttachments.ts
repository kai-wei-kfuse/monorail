import type { ClipboardEvent, DragEvent } from 'react';
import { useState } from 'react';

/** 待保存的附件：粘贴的截图只有 blob；拖进来的文件在 Tauri 里能拿到路径时带 path。 */
export interface PendingAttachment { id: string; name: string; blob?: Blob; path?: string }

let n = 0;
const pending = (file: File): PendingAttachment =>
  ({ id: `att-${++n}`, name: file.name || `截图-${n}.png`, blob: file, path: (file as File & { path?: string }).path });

/**
 * 粘贴和拖入附件。只收文件，纯文字（包括链接）照常留在正文里。
 * 注意：Tauri 默认会拦截窗口上的拖放，记录条窗口要关掉 dragDropEnabled，DOM 的 drop 事件才收得到。
 */
export function useAttachments() {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [over, setOver] = useState(false);
  const add = (files: Iterable<File>) => {
    const list = [...files].map(pending);
    if (list.length) setItems(prev => [...prev, ...list]);
    return list.length;
  };
  return {
    items, over,
    remove: (id: string) => setItems(prev => prev.filter(a => a.id !== id)),
    clear: () => setItems([]),
    onPaste: (e: ClipboardEvent) => { if (add(e.clipboardData.files)) e.preventDefault(); },
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { setOver(false); if (add(e.dataTransfer.files)) e.preventDefault(); },
  };
}
