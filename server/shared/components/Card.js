"use client";

import { cn } from "#shared/utils/cn.js";

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  className,
  ...props
}) {
  const paddings = {
    none: "",
    xs: "p-3",
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden border backdrop-blur-xl",
        "bg-white/82 border-white/55 dark:bg-[rgba(12,16,24,0.74)] dark:border-white/8",
        elev
          ? "rounded-[18px] shadow-[0_20px_48px_rgba(0,0,0,0.18)] dark:shadow-[0_24px_56px_rgba(0,0,0,0.36)]"
          : "rounded-[16px] shadow-[0_10px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_14px_32px_rgba(0,0,0,0.24)]",
        "before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_28%)] before:content-['']",
        hover && "hover:-translate-y-[1px] hover:border-brand-500/25 hover:shadow-[0_18px_42px_rgba(229,106,74,0.16)] dark:hover:shadow-[0_18px_42px_rgba(0,0,0,0.42)] transition-all cursor-pointer",
        paddings[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="grid size-10 place-items-center rounded-[12px] border border-white/50 bg-white/65 text-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] dark:border-white/8 dark:bg-white/4 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
              </div>
            )}
            <div>
              {title && (
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-main">{title}</h3>
              )}
              {subtitle && (
                <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-[14px] border border-white/45 bg-white/55 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:border-white/8 dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "p-3 -mx-3 px-3 transition-colors",
        "border-b border-white/40 last:border-b-0 dark:border-white/8",
        "hover:bg-black/[0.025] dark:hover:bg-white/[0.035]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({
  children,
  actions,
  className,
  ...props
}) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between p-3 -mx-3 px-3",
        "border-b border-white/40 last:border-b-0 dark:border-white/8",
        "hover:bg-black/[0.025] dark:hover:bg-white/[0.035] transition-colors",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
    </div>
  );
};
