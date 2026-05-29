"use client";

import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";

export default function ThemeToggle({ className, variant = "default" }) {
  const { isDark, toggleTheme } = useTheme();

  const variants = {
    default: cn(
      "flex size-10 items-center justify-center rounded-full border border-transparent",
      "text-text-muted transition-colors hover:border-white/45 hover:bg-white/55 hover:text-text-main dark:hover:border-white/8 dark:hover:bg-white/[0.035]"
    ),
    card: cn(
      "flex size-11 items-center justify-center rounded-full",
      "border border-white/45 bg-white/76 hover:bg-white/90 dark:border-white/8 dark:bg-white/[0.035] dark:hover:bg-white/[0.055]",
      "backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:shadow-[var(--shadow-warm)]",
      "text-text-muted hover:text-brand-500",
      "transition-all group"
    ),
  };

  return (
    <button
      onClick={toggleTheme}
      className={cn(variants[variant], className)}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <span
        className={cn(
          "material-symbols-outlined text-[22px]",
          variant === "card" && "transition-transform duration-300 group-hover:rotate-12"
        )}
      >
        {isDark ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
