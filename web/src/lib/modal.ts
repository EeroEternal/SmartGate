import { useEffect, useRef, type RefObject } from 'react'
import { useBodyScrollLock } from './scrollLock'

/**
 * Shared behavior for every dialog in the product: locks page scrolling, closes on
 * Escape, moves focus into the dialog and keeps Tab inside it, and returns focus to
 * the element that opened the dialog when it unmounts.
 *
 * Usage:
 *   const dialogRef = useModal({ onClose: () => setOpen(false) })
 *   return <div ref={dialogRef} role="dialog" aria-modal="true">...</div>
 *
 * Dialogs stack: only the topmost one reacts to Escape and traps Tab, and the page
 * scroll lock is reference counted by `useBodyScrollLock`.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Open dialog containers, topmost last. */
const openDialogs: HTMLElement[] = []

export function useModal({ onClose, enabled = true }: { onClose?: () => void; enabled?: boolean } = {}): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useBodyScrollLock(enabled)

  useEffect(() => {
    if (!enabled) return
    const node = ref.current
    if (!node) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    openDialogs.push(node)
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
    // Respect an element that already claimed focus (for example `autoFocus`), only
    // pull focus in when it is still outside of the dialog.
    if (!node.contains(document.activeElement)) node.focus({ preventScroll: true })

    const dialog: HTMLDivElement = node
    const isTopmost = () => openDialogs[openDialogs.length - 1] === dialog
    const focusableElements = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement,
      )

    function onKeyDown(event: KeyboardEvent) {
      if (!isTopmost()) return
      // A dropdown inside the dialog handles Escape itself (and prevents the default);
      // in that case the dialog stays open.
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements()
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const inside = active instanceof HTMLElement && dialog.contains(active)
      if (event.shiftKey && (!inside || active === first || active === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const index = openDialogs.lastIndexOf(node)
      if (index !== -1) openDialogs.splice(index, 1)
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [enabled])

  return ref
}
