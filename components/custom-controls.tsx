"use client";

import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";

export type CustomSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  openUpward: boolean;
};

export function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
}: {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = options[selectedIndex];

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const rootFontSize =
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
      16;
    const viewportPadding = Math.max(8, rootFontSize * 0.5);
    const menuGap = Math.max(6, rootFontSize * 0.35);
    const idealHeight = rootFontSize * 17.5;
    const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
    const roomAbove = rect.top - viewportPadding;
    const openUpward = roomBelow < rootFontSize * 10 && roomAbove > roomBelow;
    const availableHeight = openUpward ? roomAbove : roomBelow;
    const maxHeight = Math.max(
      rootFontSize * 7,
      Math.min(idealHeight, availableHeight - menuGap),
    );
    const width = Math.min(
      Math.max(rect.width, rootFontSize * 9),
      window.innerWidth - viewportPadding * 2,
    );
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    );

    setPosition({
      left,
      top: openUpward ? rect.top - menuGap : rect.bottom + menuGap,
      width,
      maxHeight,
      openUpward,
    });
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const firstEnabled = options.findIndex((option) => !option.disabled);
    setActiveIndex(
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : Math.max(firstEnabled, 0),
    );
    setOpen(true);
  }, [disabled, options, selectedIndex]);

  const choose = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      setOpen(false);
      buttonRef.current?.focus();
    },
    [onChange, options],
  );

  const move = useCallback(
    (direction: 1 | -1) => {
      if (!options.length) return;
      let next = activeIndex;
      for (let attempts = 0; attempts < options.length; attempts += 1) {
        next = (next + direction + options.length) % options.length;
        if (!options[next]?.disabled) {
          setActiveIndex(next);
          return;
        }
      }
    },
    [activeIndex, options],
  );

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
      } else {
        move(event.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else openMenu();
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) openMenu();
      const indexes = options
        .map((option, index) => (!option.disabled ? index : -1))
        .filter((index) => index >= 0);
      const next = event.key === "Home" ? indexes[0] : indexes.at(-1);
      if (next !== undefined) setActiveIndex(next);
      return;
    }

    if (event.key === "Tab") {
      setOpen(false);
      return;
    }

    if (event.key.length === 1 && /\S/.test(event.key)) {
      const search = event.key.toLocaleLowerCase("zh-CN");
      const match = options.findIndex(
        (option) =>
          !option.disabled &&
          option.label.toLocaleLowerCase("zh-CN").startsWith(search),
      );
      if (match >= 0) {
        if (!open) openMenu();
        setActiveIndex(match);
      }
    }
  }

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    updatePosition();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const menuStyle = position
    ? ({
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: position.maxHeight,
        transform: position.openUpward ? "translateY(-100%)" : undefined,
      } as CSSProperties)
    : undefined;

  return (
    <div
      ref={rootRef}
      className={`custom-select ${open ? "open" : ""} ${className}`.trim()}
    >
      <button
        ref={buttonRef}
        className="custom-select-trigger"
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-activedescendant={
          open ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-autocomplete="none"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span>{selectedOption?.label ?? options[0]?.label ?? "请选择"}</span>
        <ChevronDown size={14} />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className="custom-select-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
          >
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  id={`${listboxId}-option-${index}`}
                  className={`${selected ? "selected" : ""} ${
                    activeIndex === index ? "active" : ""
                  }`.trim()}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  data-active={activeIndex === index}
                  key={option.value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span>{option.label}</span>
                  {selected && <Check size={14} />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function CustomCheckbox({
  checked,
  onChange,
  label,
  description,
  compact = false,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`checkbox-row ${compact ? "compact" : ""} ${
        checked ? "checked" : ""
      }`.trim()}
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="custom-checkbox-box">
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span className="custom-checkbox-copy">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
    </button>
  );
}
