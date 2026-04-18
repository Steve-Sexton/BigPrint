import React, { useState, useEffect } from 'react'
import { clsx } from 'clsx'

interface Props {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  decimals?: number
  disabled?: boolean
  className?: string
}

export function NumericInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  decimals = 0,
  disabled,
  className,
}: Props) {
  const [text, setText] = useState(value.toFixed(decimals))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(value.toFixed(decimals))
  }, [value, focused, decimals])

  function commit(raw: string) {
    const n = parseFloat(raw)
    if (isNaN(n)) {
      setText(value.toFixed(decimals))
      return
    }
    let clamped = n
    if (min !== undefined) clamped = Math.max(min, clamped)
    if (max !== undefined) clamped = Math.min(max, clamped)
    onChange(clamped)
    setText(clamped.toFixed(decimals))
  }

  return (
    <div className={clsx('flex items-center gap-1', className)}>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={clsx(
          'w-full rounded border px-2 py-1 text-sm',
          'border-gray-300 dark:border-gray-600',
          'bg-white dark:bg-gray-800',
          'text-gray-900 dark:text-gray-100',
          'focus:outline-none focus:ring-1 focus:ring-blue-500',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onFocus={() => setFocused(true)}
        onChange={e => setText(e.target.value)}
        onBlur={e => {
          setFocused(false)
          commit(e.target.value)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        }}
      />
      {unit && <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{unit}</span>}
    </div>
  )
}
