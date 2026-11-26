import React from 'react'
import NumberTicker from './number-ticker-02'

export default function NumberTickerDemo(): React.JSX.Element {
  const [value, setValue] = React.useState(1284.5)

  React.useEffect(() => {
    const interval = setInterval(() => setValue((previous) => previous + (Math.random() * 50 - 20)), 2500)
    return () => clearInterval(interval)
  }, [])

  return <NumberTicker value={value} className="text-primary font-medium text-3xl sm:text-4xl lg:text-5xl tracking-tight" />
}
