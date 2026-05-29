"use client";

import { useEffect } from "react";
import { cn } from "@/shared/utils/cn";

export default function Drawer({
  isOpen,
  onClose,
  title,
  children,
  width = "md",
  className
}) {
  const widths = {
    sm: "w-[400px]",
    md: "w-[500px]",
    lg: "w-[600px]",
    xl: "w-[800px]",
    full: "w-full",
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-[rgba(3,6,11,0.62)] backdrop-blur-[6px] fade-in cursor-pointer"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div className={cn(
        "absolute right-0 top-0 h-full flex flex-col backdrop-blur-xl",
        "bg-[rgba(255,255,255,0.94)] dark:bg-[rgba(10,14,22,0.94)] shadow-[var(--shadow-elev)]",
        "slide-in-right",
        "border-l border-white/55 dark:border-white/8",
        widths[width] || widths.md,
        className
      )}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/50 p-6 dark:border-white/8">
          <div className="flex items-center gap-3">
            {title && (
              <h2 className="text-lg font-semibold text-text-main">{title}</h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[12px] border border-transparent p-1.5 text-text-muted transition-colors hover:border-white/45 hover:bg-black/[0.04] hover:text-text-main dark:hover:border-white/8 dark:hover:bg-white/[0.04]"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}
