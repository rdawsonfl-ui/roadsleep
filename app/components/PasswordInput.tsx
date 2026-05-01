'use client'
/**
 * PasswordInput — text input with show/hide eye toggle.
 *
 * Used across the app wherever a password is entered (admin gate, hotelier
 * login/signup, reset-password). Tap the eye icon to reveal the password;
 * tap again to hide. Defaults to hidden.
 *
 * Two style modes are supported via the `variant` prop so we can drop this
 * into screens that use either the global `dark-input` class (admin gate)
 * or the inline-styled inputs used in the hotelier flow.
 */
import { useState } from 'react'

type Variant = 'dark-input' | 'inline'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  variant?: Variant
}

export default function PasswordInput({
  value,
  onChange,
  placeholder = '••••••••',
  autoFocus = false,
  variant = 'inline',
}: Props) {
  const [visible, setVisible] = useState(false)

  // Style for the input itself, depending on caller's design system
  const inlineInputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--night3)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '12px 44px 12px 14px', // extra right padding for the eye button
    color: 'var(--white)',
    fontSize: '14px',
    fontFamily: 'DM Sans, sans-serif',
    boxSizing: 'border-box',
  }

  // dark-input class needs the same right-padding so text doesn't go under the eye
  const darkInputExtra: React.CSSProperties = { paddingRight: '44px' }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={variant === 'dark-input' ? 'dark-input' : undefined}
        style={variant === 'dark-input' ? darkInputExtra : inlineInputStyle}
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute',
          right: '6px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '6px 10px',
          fontSize: '16px',
          color: 'var(--fog)',
          lineHeight: 1,
          userSelect: 'none',
        }}
      >
        {visible ? '🙈' : '👁'}
      </button>
    </div>
  )
}
