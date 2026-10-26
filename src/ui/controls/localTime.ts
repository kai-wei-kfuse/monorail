const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 时间 → datetime-local 的值（本地时区，精确到分钟）。 */
export function toLocalValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local 的值 → ISO 时间；空串返回 null。 */
export const fromLocalValue = (value: string): string | null => (value ? new Date(value).toISOString() : null);
