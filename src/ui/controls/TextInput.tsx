import type { InputHTMLAttributes } from 'react';
import './controls.css';

export function TextInput({ className = '', invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input type="text" spellCheck={false} {...rest} aria-invalid={invalid || undefined} className={`inp ${className}`.trim()} />;
}
