import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { FluentIcon } from '../lib/icons'
import { useFocusgroupFallback } from '../lib/use-focusgroup'

export interface MenuEntry {
  id: string
  label: string
  icon?: FluentIcon
  /** Extra text at the end of the item, for example a drive letter. */
  hint?: string
  disabled?: boolean
  onSelect(): void
}

export interface MenuSection {
  id: string
  /** Visible group heading; also the group's accessible name. */
  label?: string
  entries: MenuEntry[]
  /** Shown as a disabled item when `entries` is empty, for example "(none)". */
  emptyText?: string
}

export interface MenuButtonProps {
  /** Accessible name of the menu (the trigger's visible text names the trigger). */
  menuLabel: string
  /** Accessible name of the trigger when its content is only an icon. */
  triggerLabel?: string
  sections: MenuSection[]
  /** Called before the menu opens (for example to refresh the drive list). */
  onOpen?(): void
  className?: string
  disabled?: boolean
  title?: string
  children: ReactNode
}

const MENU_GAP = 2

/** jsdom has no Popover API; there the popup is a plain fixed element. */
const supportsPopover = () =>
  typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function'

/**
 * A menu button (modern-web-guidance "menu"): Enter, Space or click toggles; ArrowDown opens
 * and enters; a keyboard open focuses the first item, a pointer open keeps focus on the
 * trigger; Escape closes and returns focus; Tab and an outside click close. The popup is a
 * `popover="manual"` element in the top layer, placed below its trigger from script (Electron
 * 45's Chromium has no CSS anchor positioning) and flipped above when there is no room.
 * Arrow keys come from native `focusgroup="menu"`, with a script fallback.
 */
export function MenuButton({
  menuLabel,
  triggerLabel,
  sections,
  onOpen,
  className = '',
  disabled = false,
  title,
  children,
}: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const enterOnOpen = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const itemCount = sections.reduce((sum, s) => sum + Math.max(1, s.entries.length), 0)
  useFocusgroupFallback(listRef, 'menu', `${open}:${itemCount}`)

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  const focusFirstItem = useCallback(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
      ?.focus()
  }, [])

  const show = (enter: boolean) => {
    if (disabled) return
    enterOnOpen.current = enter
    onOpen?.()
    setOpen(true)
  }

  useLayoutEffect(() => {
    const popup = popupRef.current
    const trigger = triggerRef.current
    if (!open || popup === null || trigger === null) return
    if (typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) {
      popup.showPopover()
    }
    const anchor = trigger.getBoundingClientRect()
    const box = popup.getBoundingClientRect()
    const below = anchor.bottom + MENU_GAP + box.height <= window.innerHeight
    popup.style.top = `${below ? anchor.bottom + MENU_GAP : Math.max(0, anchor.top - MENU_GAP - box.height)}px`
    popup.style.left = `${Math.max(0, Math.min(anchor.left, window.innerWidth - box.width))}px`
    if (enterOnOpen.current) focusFirstItem()
  }, [open, focusFirstItem])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (popupRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, close])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') {
      // Focus goes back to the trigger before the browser moves it, so Tab and Shift+Tab continue
      // from the trigger (menu button pattern) instead of dropping to the page body.
      close(true)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={disabled ? 'true' : undefined}
        className={className}
        onClick={(event) => {
          if (open) close(false)
          else show(event.detail === 0) // detail 0: Enter or Space, not a pointer
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            // Opens a closed menu and enters it; after a pointer open it enters the open menu.
            event.preventDefault()
            if (!open) show(true)
            else focusFirstItem()
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            close(true)
          }
        }}
      >
        {children}
      </button>
      {open && (
        <div
          ref={popupRef}
          id={menuId}
          popover={supportsPopover() ? 'manual' : undefined}
          className="popup-menu z-50 min-w-56 rounded-panel border border-line bg-raised p-1 text-ink shadow-menu"
          onKeyDown={onMenuKeyDown}
        >
          <div ref={listRef} role="menu" aria-label={menuLabel} focusgroup="menu nomemory">
            {sections.map((section, sectionIndex) => (
              <MenuGroup
                key={section.id}
                section={section}
                first={sectionIndex === 0}
                onChoose={(entry) => {
                  close(true)
                  entry.onSelect()
                }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function MenuGroup({
  section,
  first,
  onChoose,
}: {
  section: MenuSection
  first: boolean
  onChoose(entry: MenuEntry): void
}) {
  const headingId = useId()
  return (
    <>
      {!first && <hr className="mx-1.5 my-1 border-line" />}
      <div role="group" aria-labelledby={section.label ? headingId : undefined}>
        {section.label && (
          <div
            id={headingId}
            role="presentation"
            className="px-2.5 pt-1.5 pb-0.5 text-xs leading-4 font-semibold font-small text-ink-muted"
          >
            {section.label}
          </div>
        )}
        {section.entries.length === 0 && section.emptyText !== undefined ? (
          <button
            type="button"
            role="menuitem"
            aria-disabled="true"
            className="flex min-h-8 w-full items-center gap-2 rounded-control px-2.5 text-left text-[13px] leading-[18px] text-ink-subtle"
          >
            <span aria-hidden="true" className="size-5 shrink-0" />
            {section.emptyText}
          </button>
        ) : (
          section.entries.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                aria-disabled={entry.disabled ? 'true' : undefined}
                onClick={() => {
                  if (!entry.disabled) onChoose(entry)
                }}
                className="flex min-h-8 w-full items-center gap-2 rounded-control px-2.5 text-left text-[13px] leading-[18px] text-ink transition-colors duration-[120ms] hover:bg-row-hover focus-visible:bg-row-hover focus-visible:outline-offset-[-2px] aria-disabled:text-ink-subtle aria-disabled:hover:bg-transparent"
              >
                {Icon ? (
                  <Icon aria-hidden="true" focusable={false} className="shrink-0 text-ink-muted" />
                ) : (
                  <span aria-hidden="true" className="size-5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.hint && (
                  <span
                    aria-hidden="true"
                    className="ml-4 text-xs leading-4 font-small text-ink-subtle"
                  >
                    {entry.hint}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </>
  )
}
