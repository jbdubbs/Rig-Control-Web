import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../utils";
import { useFloatingPanel, normalizeSearchText } from "../hooks/useFloatingPanel";

export interface SerialPortInputOption {
  value: string;
  label: string;
}

interface SerialPortInputProps {
  id: string;
  options: SerialPortInputOption[];
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const PANEL_MAX_HEIGHT = 240;

// An editable combobox: unlike SearchableSelect (strict pick-from-list, the
// input's value is just a search query), here the input's value IS the
// field's value — suggestions are an assist, not a constraint. Serial ports
// are attached to the server machine (which may not be the browser's
// machine) and enumeration can miss a device, so free text must always work.
export function SerialPortInput({
  id,
  options,
  value,
  onChange,
  onFocus,
  onCommit,
  placeholder,
  className,
}: SerialPortInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeOptionRef = useRef<HTMLLIElement>(null);

  const closePanel = () => setIsOpen(false);

  const { panelStyle, positionPanel } = useFloatingPanel({
    isOpen,
    triggerRef: inputRef,
    panelRef,
    onClose: closePanel,
    panelMaxHeight: PANEL_MAX_HEIGHT,
  });

  const filteredOptions = useMemo(() => {
    const q = normalizeSearchText(value);
    if (!q) return options;
    return options.filter((o) => normalizeSearchText(o.label).includes(q));
  }, [options, value]);

  const listboxId = `${id}-listbox`;
  const activeOptionId =
    isOpen && filteredOptions[activeIndex] ? `${id}-option-${activeIndex}` : undefined;

  const openPanel = () => {
    positionPanel();
    setActiveIndex(0);
    setIsOpen(true);
    onFocus?.();
  };

  const selectOption = (option: SerialPortInputOption) => {
    onChange(option.value);
    onCommit?.(option.value);
    closePanel();
    inputRef.current?.focus();
  };

  useEffect(() => {
    setActiveIndex(0);
  }, [value]);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        if (!isOpen) {
          openPanel();
        } else {
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, filteredOptions.length - 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        if (isOpen && filteredOptions[activeIndex]) {
          e.preventDefault();
          selectOption(filteredOptions[activeIndex]);
        }
        break;
      case "Escape":
        closePanel();
        break;
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={openPanel}
        onBlur={() => {
          closePanel();
          onCommit?.(value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          "w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white",
          className
        )}
      />

      {isOpen &&
        filteredOptions.length > 0 &&
        createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="z-[70] bg-[#151619] border border-[#2a2b2e] rounded-lg shadow-2xl overflow-y-auto custom-scrollbar"
          >
            <ul id={listboxId} role="listbox">
              {filteredOptions.map((option, index) => (
                <li
                  key={option.value}
                  ref={index === activeIndex ? activeOptionRef : undefined}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                  className={cn(
                    "px-3 py-2 text-sm cursor-pointer break-all",
                    index === activeIndex ? "bg-emerald-500/20 text-white" : "text-white/90",
                    option.value === value && "font-semibold"
                  )}
                >
                  {option.label}
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
