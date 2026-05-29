"use client";

import { useEffect } from "react";
import { cn } from "#shared/utils/cn.js";
import Button from "./Button.js";

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  showCloseButton = true,
  showTrafficLights = true,
  className,
}) {
  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-4xl",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-[rgba(3,6,11,0.62)] backdrop-blur-[6px] fade-in"
        onClick={closeOnOverlay ? onClose : undefined}
      />

      {/* Modal content */}
      <div
        className={cn(
          "relative w-full overflow-hidden border backdrop-blur-xl",
          "border-white/55 bg-white/88 dark:border-white/8 dark:bg-[rgba(10,14,22,0.94)]",
          "rounded-[20px] shadow-[0_24px_60px_rgba(0,0,0,0.24)] dark:shadow-[0_28px_72px_rgba(0,0,0,0.44)]",
          "before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_28%)] before:content-['']",
          "fade-in",
          sizes[size],
          className
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between border-b border-white/50 p-3 dark:border-white/8">
            <div className="flex items-center">
              {showTrafficLights && (
                <div className="ml-2 mr-4 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
                  <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                  <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
                </div>
              )}
              {title && (
                <h2 className="text-lg font-semibold tracking-[-0.02em] text-text-main">{title}</h2>
              )}
            </div>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="rounded-[12px] border border-transparent p-1.5 text-text-muted transition-colors hover:border-white/50 hover:bg-black/[0.04] hover:text-text-main dark:hover:border-white/8 dark:hover:bg-white/[0.04]"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="max-h-[calc(85vh-100px)] overflow-y-auto p-6 custom-scrollbar">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-white/50 p-6 dark:border-white/8">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-text-muted">{message}</p>
    </Modal>
  );
}
