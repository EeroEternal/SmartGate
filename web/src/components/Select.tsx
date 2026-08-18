import { Listbox, ListboxButton, ListboxOption, ListboxOptions, Transition } from '@headlessui/react'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid'
import { Fragment } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface Option {
  id: string | number
  name: string
}

export interface SelectProps {
  label?: string
  options: Option[]
  selected: Option
  onChange: (option: Option) => void
  className?: string
  direction?: 'down' | 'up'
  size?: 'sm' | 'md'
}

export default function Select({
  label,
  options,
  selected,
  onChange,
  className,
  direction = 'down',
  size = 'md',
}: SelectProps) {
  const isSm = size === 'sm'

  return (
    <div className={cn("w-full", className)}>
      <Listbox value={selected} onChange={onChange}>
        {label && <Listbox.Label className="block text-sm font-medium text-zinc-700 mb-1">{label}</Listbox.Label>}
        <div className="relative">
          <ListboxButton className={cn(
            "relative w-full cursor-default rounded-md bg-white text-left border border-zinc-300 focus:outline-none focus:ring-1 focus:ring-[#635BFF] focus:border-[#635BFF] transition-colors",
            isSm ? "py-1.5 pl-3 pr-8 text-xs" : "py-2 pl-3 pr-10 text-sm"
          )}>
            <span className="block truncate text-zinc-900">{selected.name}</span>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronUpDownIcon className={cn("text-zinc-400", isSm ? "h-4 w-4" : "h-5 w-5")} aria-hidden="true" />
            </span>
          </ListboxButton>
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <ListboxOptions className={cn(
              "absolute z-30 max-h-60 min-w-full overflow-auto rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none border border-zinc-200",
              direction === 'up' ? "bottom-full mb-1" : "mt-1",
              isSm ? "text-xs" : "text-sm"
            )}>
              {options.map((option) => (
                <ListboxOption
                  key={option.id}
                  className={({ active }) =>
                    cn(
                      active ? 'bg-zinc-100 text-black' : 'text-zinc-900',
                      'relative cursor-default select-none',
                      isSm ? 'py-1.5 pl-7 pr-3' : 'py-2 pl-10 pr-4'
                    )
                  }
                  value={option}
                >
                  {({ selected }) => (
                    <>
                      <span className={cn(selected ? 'font-semibold' : 'font-normal', 'block whitespace-nowrap')}>
                        {option.name}
                      </span>
                      {selected ? (
                        <span className={cn("absolute inset-y-0 left-0 flex items-center text-black", isSm ? "pl-2" : "pl-3")}>
                          <CheckIcon className={cn(isSm ? "h-4 w-4" : "h-5 w-5")} aria-hidden="true" />
                        </span>
                      ) : null}
                    </>
                  )}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </Transition>
        </div>
      </Listbox>
    </div>
  )
}
