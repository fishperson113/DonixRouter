"use client";

import { cn } from "#shared/utils/cn.js";

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
}) {
  const sizes = {
    sm: "h-7 text-xs",
    md: "h-9 text-sm",
    lg: "h-11 text-base",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 overflow-x-auto rounded-[14px] border border-white/45 bg-white/70 p-1 backdrop-blur-md dark:border-white/8 dark:bg-white/[0.035]",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "shrink-0 rounded-[10px] px-4 font-medium transition-all",
            sizes[size],
            value === option.value
              ? "bg-white text-text-main shadow-[0_10px_20px_rgba(0,0,0,0.08)] dark:bg-[linear-gradient(180deg,rgba(253,127,82,0.94),rgba(229,106,74,0.94))] dark:text-white dark:shadow-[0_10px_22px_rgba(229,106,74,0.16)]"
              : "text-text-muted hover:text-text-main hover:bg-black/[0.035] dark:hover:bg-white/[0.04]"
          )}
        >
          {option.icon && (
            <span className="material-symbols-outlined text-[16px] mr-1.5">
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
