import type { FieldsetHTMLAttributes } from 'react';
import './activityActions.css';

/** Disable the whole bottom row during an away activity, including actions supplied by the card. */
export function ActivityActions({ disabled, className = '', ...props }: FieldsetHTMLAttributes<HTMLFieldSetElement>) {
  return <fieldset {...props} className={`activity-actions ${className}`} disabled={disabled}
    aria-label="底部活动操作" title={disabled ? '从临时活动回来后可用' : undefined} />;
}
