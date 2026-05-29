"use client";

import { cn } from "#shared/utils/cn.js";

const variants = {
  primary:
    "border border-[#f27952] bg-[linear-gradient(180deg,#fb7f55_0%,#e56a4a_100%)] text-white shadow-[0_12px_30px_-12px_rgba(229,106,74,0.75)] hover:border-[#ff9a74] hover:shadow-[0_18px_36px_-12px_rgba(229,106,74,0.85)] disabled:border-white/10 disabled:bg-white/8 disabled:text-white/50",
  secondary:
    "border border-white/50 bg-white/75 text-text-main shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] hover:bg-white hover:border-white/80 dark:border-white/8 dark:bg-white/[0.035] dark:text-[#dbe4f1] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] dark:hover:bg-white/[0.055] dark:hover:border-white/12",
  outline:
    "border border-white/45 bg-transparent text-text-main hover:bg-white/60 hover:border-brand-500/40 dark:border-white/10 dark:text-[#dbe4f1] dark:hover:bg-white/[0.045] dark:hover:border-brand-500/35",
  ghost:
    "border border-transparent bg-transparent text-text-muted hover:bg-black/[0.04] hover:text-text-main dark:hover:bg-white/[0.04] dark:hover:text-white",
  danger:
    "border border-red-500/50 bg-[linear-gradient(180deg,#ef5350_0%,#dc3d3d_100%)] text-white shadow-[0_12px_30px_-12px_rgba(239,68,68,0.55)] hover:border-red-400/70 hover:shadow-[0_18px_36px_-12px_rgba(239,68,68,0.72)] disabled:border-white/10 disabled:bg-white/8 disabled:text-white/50",
  success:
    "border border-emerald-500/45 bg-[linear-gradient(180deg,#2acb78_0%,#18a957_100%)] text-white shadow-[0_12px_30px_-12px_rgba(34,197,94,0.55)] hover:border-emerald-400/65 hover:shadow-[0_18px_36px_-12px_rgba(34,197,94,0.72)] disabled:border-white/10 disabled:bg-white/8 disabled:text-white/50",
};

const sizes = {
  sm: "h-8 px-3.5 text-xs rounded-[10px]",
  md: "h-10 px-4.5 text-sm rounded-[12px]",
  lg: "h-11 px-6 text-sm rounded-[13px]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold tracking-[-0.01em] backdrop-blur-md transition-all duration-150 ease-out cursor-pointer",
        "active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
      ) : icon ? (
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span className="material-symbols-outlined text-[18px]">{iconRight}</span>
      )}
    </button>
  );
}
