import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { cn } from "../utils";
import { useFloatingPanel, normalizeSearchText } from "../hooks/useFloatingPanel";

export interface SearchableSelectOption {
  value: string;
  label: string;
  searchText?: string;
}

interface SearchableSelectProps {
  id: string;
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const PANEL_MAX_HEIGHT = 280;

export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Select...",
  className,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeOptionRef = useRef<HTMLLIElement>(null);

  const closePanel = (restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const { panelStyle, positionPanel } = useFloatingPanel({
    isOpen,
    triggerRef,
    panelRef,
    onClose: () => closePanel(false),
    panelMaxHeight: PANEL_MAX_HEIGHT,
  });

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const q = normalizeSearchText(query);
    if (!q) return options;
    return options.filter((o) => normalizeSearchText(o.searchText ?? o.label).includes(q));
  }, [options, query]);

  const listboxId = `${id}-listbox`;
  const activeOptionId =
    isOpen && filteredOptions[activeIndex] ? `${id}-option-${activeIndex}` : undefined;

  const openPanel = () => {
    positionPanel();
    setQuery("");
    const initialIndex = selectedOption
      ? options.findIndex((o) => o.value === selectedOption.value)
      : 0;
    setActiveIndex(Math.max(initialIndex, 0));
    setIsOpen(true);
  };

  const selectOption = (option: SearchableSelectOption) => {
    onChange(option.value);
    closePanel(true);
  };

  useEffect(() => {
    if (isOpen) inputRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filteredOptions.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filteredOptions[activeIndex]) selectOption(filteredOptions[activeIndex]);
        break;
      case "Escape":
        e.preventDefault();
        closePanel(true);
        break;
      case "Tab":
        closePanel(false);
        break;
    }
  };

  const triggerClasses = cn(
    "w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 flex items-center justify-between gap-2",
    className
  );

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        onClick={() => (isOpen ? closePanel(true) : openPanel())}
        className={triggerClasses}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={cn("truncate text-left", selectedOption ? "text-white" : "text-[#8e9299]")}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {selectedOption && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear selection"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="text-[#8e9299] hover:text-white p-0.5"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={14} className="text-[#8e9299]" />
        </span>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="z-[70] bg-[#151619] border border-[#2a2b2e] rounded-lg shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="p-2 border-b border-[#2a2b2e] shrink-0">
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={isOpen}
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search..."
                className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
              />
            </div>
            <ul
              id={listboxId}
              role="listbox"
              className="overflow-y-auto custom-scrollbar"
            >
              {filteredOptions.length === 0 ? (
                <li className="px-3 py-2 text-sm text-[#8e9299] italic">
                  No radios match &quot;{query}&quot;
                </li>
              ) : (
                filteredOptions.map((option, index) => (
                  <li
                    key={option.value}
                    ref={index === activeIndex ? activeOptionRef : undefined}
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={option.value === value}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                    className={cn(
                      "px-3 py-2 text-sm cursor-pointer truncate",
                      index === activeIndex ? "bg-emerald-500/20 text-white" : "text-white/90",
                      option.value === value && "font-semibold"
                    )}
                  >
                    {option.label}
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
