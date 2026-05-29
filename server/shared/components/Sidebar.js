"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "#shared/utils/cn.js";
import { APP_CONFIG, UPDATER_CONFIG } from "#shared/constants/config.js";
import { MEDIA_PROVIDER_KINDS } from "#shared/constants/providers.js";
import { useCopyToClipboard } from "#shared/hooks/useCopyToClipboard.js";
import Button from "./Button.js";
import { ConfirmModal } from "./Modal.js";

const VISIBLE_MEDIA_KINDS = ["embedding", "image", "tts", "stt"];
const COMBINED_WEB_ITEM = {
  id: "web",
  label: "Web Fetch & Search",
  icon: "travel_explore",
  href: "/dashboard/media-providers/web",
};

const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/combos", label: "Combos", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/mitm", label: "MITM", icon: "security" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

function navItemClass(active) {
  return active
    ? "border border-brand-500/20 bg-brand-500/12 text-brand-600 dark:text-brand-300"
    : "border border-transparent text-text-muted hover:border-white/45 hover:bg-white/55 hover:text-text-main dark:hover:border-white/6 dark:hover:bg-white/[0.04]";
}

function NavLink({ href, icon, label, active, onClose, className }) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className={cn(
        "group flex items-center gap-3 rounded-[14px] px-3 py-2 transition-all",
        navItemClass(active),
        className
      )}
    >
      <span
        className={cn(
          "material-symbols-outlined text-[18px]",
          active ? "fill-1" : "transition-colors group-hover:text-primary"
        )}
      >
        {icon}
      </span>
      <span className="text-[13px] font-medium tracking-[-0.01em]">{label}</span>
    </Link>
  );
}

NavLink.propTypes = {
  href: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  active: PropTypes.bool,
  onClose: PropTypes.func,
  className: PropTypes.string,
};

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [showShutdownModal, setShowShutdownModal] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.enableTranslator) setEnableTranslator(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/version")
      .then((res) => res.json())
      .then((data) => {
        if (data.hasUpdate) setUpdateInfo(data);
      })
      .catch(() => {});
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  const handleUpdate = () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
  };

  const handleCopyAndShutdown = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
    } catch {}
    copy(INSTALL_CMD);
    let remaining = UPDATER_CONFIG.shutdownCountdownSec;
    setShutdownCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      setShutdownCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
        setIsDisconnected(true);
      }
    }, 1000);
  };

  const handleCancelUpdate = () => {
    setIsUpdating(false);
    setShutdownCountdown(0);
  };

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch {}
    setIsShuttingDown(false);
    setShowShutdownModal(false);
    setIsDisconnected(true);
  };

  return (
    <>
      <aside className="app-shell flex min-h-full w-72 flex-col border-r border-white/45 bg-white/76 backdrop-blur-2xl dark:border-white/8 dark:bg-[rgba(12,16,24,0.8)]">
        <div className="flex items-center gap-2 px-6 pb-2 pt-5">
          <div className="h-3 w-3 rounded-full bg-[#FF5F56]" />
          <div className="h-3 w-3 rounded-full bg-[#FFBD2E]" />
          <div className="h-3 w-3 rounded-full bg-[#27C93F]" />
        </div>

        <div className="flex flex-col gap-3 px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-[12px] border border-white/45 bg-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_12px_30px_-12px_rgba(229,106,74,0.45)] dark:border-white/8 dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_34px_-12px_rgba(0,0,0,0.42)]">
              <img src="/favicon.svg" alt={APP_CONFIG.name} className="size-6 object-contain" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold tracking-[-0.02em] text-text-main">{APP_CONFIG.name}</h1>
              <span className="font-mono text-[11px] text-text-muted">v{APP_CONFIG.version}</span>
            </div>
          </Link>

          {updateInfo ? (
            <div className="-m-1 flex flex-col gap-2 rounded-[14px] border border-emerald-500/18 bg-emerald-500/8 p-3 dark:border-amber-400/16 dark:bg-amber-400/8">
              <span className="text-xs font-semibold text-emerald-700 dark:text-amber-300">
                Update available: v{updateInfo.latestVersion}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowUpdateModal(true)}
                  className="rounded-[10px] border border-emerald-600/40 bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 dark:border-amber-500/45 dark:bg-amber-500 dark:hover:bg-amber-600"
                >
                  Update now
                </button>
                <button
                  onClick={() => copy(INSTALL_CMD)}
                  title="Copy install command"
                  className="min-w-0 flex-1 text-left transition-opacity hover:opacity-80"
                >
                  <code className="block truncate font-mono text-[10px] text-emerald-700/85 dark:text-amber-300/80">
                    {copied ? "copied!" : INSTALL_CMD}
                  </code>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <nav className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-4 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={isActive(item.href)}
              onClose={onClose}
            />
          ))}

          <div className="mt-3 space-y-1 pt-3">
            <p className="mb-2 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted/70">
              System
            </p>

            <button
              onClick={() => setMediaOpen((value) => !value)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-[14px] px-3 py-2 transition-all",
                navItemClass(pathname.startsWith("/dashboard/media-providers"))
              )}
            >
              <span className="material-symbols-outlined text-[18px]">perm_media</span>
              <span className="flex-1 text-left text-[13px] font-medium tracking-[-0.01em]">Media Providers</span>
              <span
                className="material-symbols-outlined text-[14px] transition-transform"
                style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                expand_more
              </span>
            </button>

            {mediaOpen ? (
              <div className="space-y-1 pl-4">
                {MEDIA_PROVIDER_KINDS.filter((kind) => VISIBLE_MEDIA_KINDS.includes(kind.id)).map((kind) => (
                  <NavLink
                    key={kind.id}
                    href={`/dashboard/media-providers/${kind.id}`}
                    icon={kind.icon}
                    label={kind.label}
                    active={pathname.startsWith(`/dashboard/media-providers/${kind.id}`)}
                    onClose={onClose}
                    className="rounded-[12px] px-4"
                  />
                ))}
                <NavLink
                  href={COMBINED_WEB_ITEM.href}
                  icon={COMBINED_WEB_ITEM.icon}
                  label={COMBINED_WEB_ITEM.label}
                  active={pathname.startsWith(COMBINED_WEB_ITEM.href)}
                  onClose={onClose}
                  className="rounded-[12px] px-4"
                />
              </div>
            ) : null}

            {systemItems.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                icon={item.icon}
                label={item.label}
                active={isActive(item.href)}
                onClose={onClose}
              />
            ))}

            {debugItems.map((item) => {
              const show = item.href !== "/dashboard/translator" || enableTranslator;
              if (!show) return null;
              return (
                <NavLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  active={isActive(item.href)}
                  onClose={onClose}
                />
              );
            })}

            <NavLink
              href="/dashboard/profile"
              icon="settings"
              label="Settings"
              active={isActive("/dashboard/profile")}
              onClose={onClose}
            />
          </div>
        </nav>

        <div className="border-t border-white/45 p-4 dark:border-white/8">
          <Button
            variant="outline"
            fullWidth
            icon="power_settings_new"
            onClick={() => setShowShutdownModal(true)}
            className="!border-red-500/28 !text-red-500 hover:!bg-red-500/10 hover:!border-red-500/45 dark:!text-red-300"
          >
            Shutdown
          </Button>
        </div>
      </aside>

      <ConfirmModal
        isOpen={showShutdownModal}
        onClose={() => setShowShutdownModal(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />

      <ConfirmModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onConfirm={handleUpdate}
        title="Update DonixRouter"
        message={`Show install command for v${updateInfo?.latestVersion || ""}? You can copy it and shutdown to install manually.`}
        confirmText="Show Command"
        cancelText="Cancel"
        variant="primary"
      />

      {(isDisconnected || isUpdating) ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
          {isUpdating ? (
            <ManualUpdatePanel
              latestVersion={updateInfo?.latestVersion}
              installCmd={INSTALL_CMD}
              copied={copied}
              onCopyAndShutdown={handleCopyAndShutdown}
              onCancel={handleCancelUpdate}
              countdown={shutdownCountdown}
              isDisconnected={isDisconnected}
            />
          ) : (
            <div className="rounded-[22px] border border-white/10 bg-[rgba(12,16,24,0.9)] p-8 text-center text-white shadow-[0_30px_70px_rgba(0,0,0,0.45)]">
              <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-red-500/20 text-red-500">
                <span className="material-symbols-outlined text-[32px]">power_off</span>
              </div>
              <h2 className="mb-2 text-xl font-semibold">Server Disconnected</h2>
              <p className="mb-6 text-text-muted">The proxy server has been stopped.</p>
              <Button variant="secondary" onClick={() => globalThis.location.reload()}>
                Reload Page
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};

function ManualUpdatePanel({
  latestVersion,
  installCmd,
  copied,
  onCopyAndShutdown,
  onCancel,
  countdown,
  isDisconnected,
}) {
  const isCountingDown = countdown > 0;

  return (
    <div className="w-full max-w-lg rounded-[22px] border border-white/10 bg-[rgba(12,16,24,0.94)] p-6 text-white shadow-[0_30px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
          <span className="material-symbols-outlined text-[24px]">content_copy</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">Update DonixRouter{latestVersion ? ` to v${latestVersion}` : ""}</h2>
          <p className="text-xs text-white/60">
            {isDisconnected
              ? "Server stopped. Paste the command into a terminal to install."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : "Click the button below to copy the install command and shutdown."}
          </p>
        </div>
      </div>

      <p className="mb-2 text-sm text-white/80">Install command:</p>
      <div className="mb-4 w-full rounded-[14px] border border-white/8 bg-white/[0.04] px-3 py-2">
        <code className="break-all font-mono text-xs text-amber-400">{installCmd}</code>
      </div>

      <ol className="mb-4 list-inside list-decimal space-y-1 text-xs text-white/70">
        <li>Click <strong>Copy & Shutdown</strong> below.</li>
        <li>Paste the command into your terminal and press Enter.</li>
        <li>Run <code className="rounded bg-white/10 px-1 text-green-400">donixrouter</code> again after install.</li>
      </ol>

      {isDisconnected ? (
        <Button variant="secondary" fullWidth onClick={() => globalThis.location.reload()}>
          Reload Page
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={isCountingDown}>
            Cancel
          </Button>
          <Button variant="primary" fullWidth onClick={onCopyAndShutdown} disabled={isCountingDown}>
            {copied ? "Copied - shutting down..." : isCountingDown ? `Shutting down in ${countdown}s` : "Copy & Shutdown"}
          </Button>
        </div>
      )}
    </div>
  );
}

ManualUpdatePanel.propTypes = {
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  copied: PropTypes.bool,
  onCopyAndShutdown: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  countdown: PropTypes.number,
  isDisconnected: PropTypes.bool,
};
