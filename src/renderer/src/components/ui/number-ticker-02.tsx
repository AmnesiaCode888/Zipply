import React from 'react'
import NumberFlow, { type Value } from '@number-flow/react'

const countTiming = { duration: 160, easing: 'ease-out' }

type NumberTickerProps = {
  value: Value
  currency?: string | null
  decimals?: number
  className?: string
}

export default function NumberTicker({
  value,
  currency = 'USD',
  decimals = 2,
  className
}: NumberTickerProps): React.JSX.Element {
  return (
    <NumberFlow
      value={value}
      transformTiming={countTiming}
      spinTiming={countTiming}
      opacityTiming={countTiming}
      format={{
        ...(currency ? { style: 'currency' as const, currency } : { style: 'decimal' as const, useGrouping: false }),
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }}
      className={className}
    />
  )
}
