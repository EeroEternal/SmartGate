import { Listbox, ListboxButton, ListboxOption, ListboxOptions, Transition } from '@headlessui/react'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid'
import { Fragment } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

interface Option {
  id: string | number
  name: string
}

interface SelectProps {
  label?: string
  options: Option[]
  selected: Option
  onChange: (option: Option) => void
  className?: string
}

export default function Select({ label, options, selected, onChange, className }: SelectProps) {
  return (
    <div className={cn("w-full", className)}>
      <Listbox value={selected} onChange={onChange}>
        {label && <Listbox.Label className="block text-sm font-medium text-zinc-700 mb-1">{label}</Listbox.Label>}
        <div className="relative mt-1">
          <ListboxButton className="relative w-full cursor-default rounded-md bg-white py-2 pl-3 pr-10 text-left border border-zinc-300 focus:outline-none focus:ring-1 focus:ring-[#635BFF] focus:border-[#635BFF] sm:text-sm transition-colors">
            <span className="block truncate text-zinc-900">{selected.name}</span>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronUpDownIcon className="h-5 w-5 text-zinc-400" aria-hidden="true" />
            </span>
          </ListboxButton>
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <ListboxOptions className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm border border-zinc-200">
              {options.map((option) => (
                <ListboxOption
                  key={option.id}
                  className={({ active }) =>
                    cn(
                      active ? 'bg-zinc-100 text-black' : 'text-zinc-900',
                      'relative cursor-default select-none py-2 pl-10 pr-4'
                    )
                  }
                  value={option}
                >
                  {({ selected }) => (
                    <>
                      <span className={cn(selected ? 'font-semibold' : 'font-normal', 'block truncate')}>
                        {option.name}
                      </span>
                      {selected ? (
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-black">
                          <CheckIcon className="h-5 w-5" aria-hidden="true" />
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
