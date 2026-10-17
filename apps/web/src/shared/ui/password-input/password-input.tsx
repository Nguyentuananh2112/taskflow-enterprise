'use client';

import { useState } from 'react';

import { cn } from '@/shared/lib/cn';
import { useFieldIds } from '@/shared/lib/use-field-ids';

import { controlClass, type InputProps } from '../input';

export type PasswordInputProps = Omit<InputProps, 'type' | 'hint'> &
  Readonly<{
    /**
     * Luật hiện SẴN dưới ô (không đợi lỗi 422) — mặc định `NEW_PASSWORD_RULES` cho ô đặt mật khẩu mới; ô mật khẩu hiện
     * tại truyền `[]`.
     */
    rules?: readonly string[];
  }>;

/**
 * Luật `PasswordPolicy` của server (ADR-049/065: 12–256 ký tự, không phổ biến, không chứa email) bằng lời thường —
 * dùng chung cho đổi mật khẩu và kích hoạt tài khoản (ADR-137).
 */
export const NEW_PASSWORD_RULES = [
  'Từ 12 đến 256 ký tự — nên dùng một cụm từ dễ nhớ.',
  'Không dùng mật khẩu quá phổ biến.',
  'Không chứa phần tên trong email của bạn.',
] as const;

/**
 * Ô mật khẩu có nút Hiện/Ẩn (điện thoại gõ khó — người dùng nhìn lại được chữ đã gõ) và danh sách luật. Không chặn dán
 * (trình quản lý mật khẩu). Cùng nhãn / lỗi / aria như `Input`.
 */
export function PasswordInput({
  label,
  error,
  id,
  className,
  required,
  rules = NEW_PASSWORD_RULES,
  ...rest
}: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  const ids = useFieldIds({ id, hint: rules.length > 0, error });
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={ids.id} className="text-sm font-medium text-text">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger">
            {' '}
            *
          </span>
        )}
      </label>
      <div className="relative">
        <input
          id={ids.id}
          type={shown ? 'text' : 'password'}
          required={required}
          spellCheck={false}
          autoCapitalize="none"
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cn(
            controlClass,
            'h-11 pr-16',
            error ? 'border-danger' : 'border-border',
            className,
          )}
          {...rest}
        />
        <button
          type="button"
          aria-controls={ids.id}
          onClick={() => setShown((s) => !s)}
          className="absolute inset-y-1 right-1 rounded-control px-3 text-sm text-text-muted hover:bg-bg-subtle"
        >
          <span aria-hidden="true">{shown ? 'Ẩn' : 'Hiện'}</span>
          <span className="sr-only">{shown ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}</span>
        </button>
      </div>
      {rules.length > 0 && (
        <ul id={ids.hintId} className="list-disc pl-5 text-xs text-text-muted">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      )}
      {error && (
        <p id={ids.errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
