import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, LucideIcon } from 'lucide-react'

export interface DropdownOption {
    value: string
    label: string
}

export interface DropdownSection {
    title?: string
    options: DropdownOption[]
    value: string
    onChange: (value: string) => void
}

interface DropdownProps {
    icon: LucideIcon
    label: string
    ariaLabel: string
    sections: DropdownSection[]
    /** Highlights the trigger when a non-default value is selected. */
    active?: boolean
    /** Keep the menu open after picking, so options in several sections can be combined. */
    closeOnSelect?: boolean
}

export function Dropdown({ icon: Icon, label, ariaLabel, sections, active = false, closeOnSelect = true }: DropdownProps) {
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return

        const handleClickOutside = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)

        // Focus the selected option (or the first one) when the menu opens.
        const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
        const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
        ;(selected ?? items?.[0])?.focus()

        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [open])

    const handleMenuKeyDown = (e: React.KeyboardEvent) => {
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
        const index = items.indexOf(document.activeElement as HTMLButtonElement)

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                items[(index + 1) % items.length]?.focus()
                break
            case 'ArrowUp':
                e.preventDefault()
                items[(index - 1 + items.length) % items.length]?.focus()
                break
            case 'Home':
                e.preventDefault()
                items[0]?.focus()
                break
            case 'End':
                e.preventDefault()
                items[items.length - 1]?.focus()
                break
            case 'Escape':
            case 'Tab':
                e.preventDefault()
                setOpen(false)
                triggerRef.current?.focus()
                break
        }
    }

    return (
        <div className="relative" ref={rootRef}>
            <button
                ref={triggerRef}
                onClick={() => setOpen(o => !o)}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' && !open) {
                        e.preventDefault()
                        setOpen(true)
                    }
                }}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${open || active ? 'text-white bg-white/10' : 'text-textMuted hover:text-white hover:bg-white/5'}`}
                aria-label={ariaLabel}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
                <ChevronDown className={`w-3.5 h-3.5 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div
                    ref={menuRef}
                    role="menu"
                    onKeyDown={handleMenuKeyDown}
                    className="absolute right-0 mt-2 w-56 max-h-[70vh] overflow-y-auto bg-surface/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                >
                    {sections.map((section, sectionIndex) => (
                        <div key={section.title ?? sectionIndex} className={`p-2 ${sectionIndex > 0 ? 'border-t border-white/5' : ''}`}>
                            {section.title && (
                                <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-textMuted">
                                    {section.title}
                                </p>
                            )}
                            {section.options.map(option => {
                                const selected = section.value === option.value
                                return (
                                    <button
                                        key={option.value}
                                        role="menuitemradio"
                                        aria-checked={selected}
                                        onClick={() => {
                                            section.onChange(option.value)
                                            if (closeOnSelect) {
                                                setOpen(false)
                                                triggerRef.current?.focus()
                                            }
                                        }}
                                        className={`w-full text-left px-2 py-1.5 text-sm rounded-md flex items-center justify-between transition-colors outline-none focus-visible:bg-white/10 focus-visible:text-white hover:bg-white/10 hover:text-white ${selected ? 'text-white' : 'text-gray-300'}`}
                                    >
                                        <span>{option.label}</span>
                                        {selected && <Check className="w-3.5 h-3.5 text-primary" />}
                                    </button>
                                )
                            })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
