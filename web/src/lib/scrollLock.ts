import { useEffect } from 'react'

/**
 * Document-level scroll lock shared by every modal.
 *
 * Why a shared lock instead of `document.body.style.overflow = 'hidden'`:
 * - The viewport, not `body`, is the scroll container of the page. Locking only
 *   `body` still leaves the document scrollable programmatically, so a focused
 *   element (for example an option inside a dropdown) can still shift the page
 *   behind a dialog.
 * - Hiding the scrollbar changes the layout width by the scrollbar size unless
 *   `scrollbar-gutter: stable` is in effect. Rather than assuming a gutter, the
 *   lock measures the root element before and after locking and only adds the
 *   compensating padding when the layout really did grow. This keeps the page
 *   pixel-stable in every browser, with or without gutter support.
 * - Several dialogs can be open at once, so the lock is reference counted and
 *   only the outermost lock installs or removes the styles.
 */

type RestoreState = { overflow: string; paddingRight: string }

let lockCount = 0
let restore: RestoreState | null = null

function acquireLock() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (lockCount === 0) {
    const widthBefore = root.getBoundingClientRect().width
    restore = { overflow: root.style.overflow, paddingRight: root.style.paddingRight }
    root.style.overflow = 'hidden'
    const widthAfter = root.getBoundingClientRect().width
    const scrollbarWidth = widthAfter - widthBefore
    if (scrollbarWidth > 0) root.style.paddingRight = `${scrollbarWidth}px`
  }
  lockCount += 1
}

function releaseLock() {
  if (typeof document === 'undefined') return
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount > 0) return
  const root = document.documentElement
  const previous = restore
  restore = null
  root.style.overflow = previous ? previous.overflow : ''
  root.style.paddingRight = previous ? previous.paddingRight : ''
}

/** Locks document scrolling while `enabled` is true. */
export function useBodyScrollLock(enabled = true) {
  useEffect(() => {
    if (!enabled) return
    acquireLock()
    return releaseLock
  }, [enabled])
}
