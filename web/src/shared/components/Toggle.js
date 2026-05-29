"use client";

import { cn } from "@/shared/utils/cn";

export default function Toggle({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  size = "md",
  className,
}) {
  const sizes = {
    sm: { track: "w-8 h-4", thumb: "size-3", translate: "translate-x-4" },
    md: { track: "w-11 h-6", thumb: "size-5", translate: "translate-x-5" },
    lg: { track: "w-14 h-7", thumb: "size-6", translate: "translate-x-7" },
  };

  const handleClick = () => {
    if (!disabled && onChange) onChange(!checked);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "relative inline-flex items-center shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out",
          "focus:outline-none focus:ring-2 focus:ring-brand-500/30",
          checked
            ? "border-emerald-500/60 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)] dark:border-emerald-400/50 dark:bg-emerald-500"
            : "border-white/20 bg-white/[0.55] dark:border-white/[0.18] dark:bg-white/[0.12]",
          sizes[size].track,
          disabled && "cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.18)] dark:bg-[#f8fafc]",
            "transform transition duration-200 ease-in-out",
            checked ? sizes[size].translate : "translate-x-0.5",
            sizes[size].thumb,
            "my-auto"
          )}
        />
      </button>
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className="text-sm font-medium text-text-main">{label}</span>
          )}
          {description && (
            <span className="text-xs text-text-muted">{description}</span>
          )}
        </div>
      )}
    </div>
  );
}
