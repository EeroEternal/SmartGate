import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

/**
 * Smallest possible check that the DOM baseline works: jsdom environment,
 * @testing-library/react rendering, jest-dom matchers and the automatic cleanup hook
 * registered in `setup.ts`. Component-level tests build on this harness.
 */
function Counter() {
  const [count, setCount] = useState(0)
  return (
    <button type="button" onClick={() => setCount((current) => current + 1)}>
      clicked {count} times
    </button>
  )
}

describe('testing harness', () => {
  it('renders a React component into jsdom and reacts to events', () => {
    render(<Counter />)

    const button = screen.getByRole('button', { name: 'clicked 0 times' })
    expect(button).toBeInTheDocument()

    fireEvent.click(button)

    expect(screen.getByRole('button', { name: 'clicked 1 times' })).toBeInTheDocument()
  })

  it('cleans up the DOM between tests', () => {
    expect(screen.queryByRole('button')).toBeNull()
  })
})
