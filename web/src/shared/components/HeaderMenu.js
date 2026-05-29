"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { useTheme } from "@/shared/hooks/useTheme";
import ChangelogModal from "./ChangelogModal";
import NineRemotePromoModal from "./NineRemotePromoModal";
import LanguageSwitcher from "./LanguageSwitcher";

const LOCALE_INFO = {
  "en": { name: "English", flag: "🇺🇸" },
  "vi": { name: "Tiếng Việt", flag: "🇻🇳" },
  "zh-CN": { name: "简体中文", flag: "🇨🇳" },
  "zh-TW": { name: "繁體中文", flag: "🇹🇼" },
  "ja": { name: "日本語", flag: "🇯🇵" },
  "pt-BR": { name: "Português (BR)", flag: "🇧🇷" },
  "pt-PT": { name: "Português (PT)", flag: "🇵🇹" },
  "ko": { name: "한국어", flag: "🇰🇷" },
  "es": { name: "Español", flag: "🇪🇸" },
  "de": { name: "Deutsch", flag: "🇩🇪" },
  "fr": { name: "Français", flag: "🇫🇷" },
  "he": { name: "עברית", flag: "🇮🇱" },
  "ar": { name: "العربية", flag: "🇸🇦" },
  "ru": { name: "Русский", flag: "🇷🇺" },
  "pl": { name: "Polski", flag: "🇵🇱" },
  "cs": { name: "Čeština", flag: "🇨🇿" },
  "nl": { name: "Nederlands", flag: "🇳🇱" },
  "tr": { name: "Türkçe", flag: "🇹🇷" },
  "uk": { name: "Українська", flag: "🇺🇦" },
  "tl": { name: "Tagalog", flag: "🇵🇭" },
  "id": { name: "Indonesia", flag: "🇮🇩" },
  "th": { name: "ไทย", flag: "🇹🇭" },
  "hi": { name: "हिन्दी", flag: "🇮🇳" },
  "bn": { name: "বাংলা", flag: "🇧🇩" },
  "ur": { name: "اردو", flag: "🇵🇰" },
  "ro": { name: "Română", flag: "🇷🇴" },
  "sv": { name: "Svenska", flag: "🇸🇪" },
  "it": { name: "Italiano", flag: "🇮🇹" },
  "el": { name: "Ελληνικά", flag: "🇬🇷" },
  "hu": { name: "Magyar", flag: "🇭🇺" },
  "fi": { name: "Suomi", flag: "🇫🇮" },
  "da": { name: "Dansk", flag: "🇩🇰" },
  "no": { name: "Norsk", flag: "🇳🇴" },
};

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

function MenuItem({ icon, label, onClick, trailing, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-500/10"
          : "text-text-main hover:bg-white/[0.05]"
      }`}
    >
      <span className={`material-symbols-outlined text-[20px] ${danger ? "" : "text-text-muted"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {trailing && <span className="text-base">{trailing}</span>}
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  trailing: PropTypes.node,
  danger: PropTypes.bool,
};

export default function HeaderMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [locale, setLocale] = useState("en");
  const { toggleTheme, isDark } = useTheme();
  const menuRef = useRef(null);

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, [langOpen]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const close = () => setIsOpen(false);

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center justify-center rounded-lg p-2 text-text-muted transition-all hover:bg-white/[0.05] hover:text-text-main"
          title="Menu"
        >
          <span className="material-symbols-outlined">grid_view</span>
        </button>

        {isOpen && (
          <div className="surface-panel absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-white/10 py-1 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <MenuItem
              icon="history"
              label="Change Log"
              onClick={() => { close(); setChangelogOpen(true); }}
            />
            <MenuItem
              icon="language"
              label={LOCALE_INFO[locale]?.name || locale}
              trailing={LOCALE_INFO[locale]?.flag || "🌐"}
              onClick={() => { close(); setLangOpen(true); }}
            />
            <MenuItem
              icon={isDark ? "light_mode" : "dark_mode"}
              label="Theme"
              onClick={() => { toggleTheme(); close(); }}
            />
            <MenuItem
              icon="computer"
              label="Remote"
              onClick={() => { close(); setRemoteOpen(true); }}
            />
            <MenuItem
              icon="logout"
              label="Logout"
              danger
              onClick={() => { close(); onLogout(); }}
            />
          </div>
        )}
      </div>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <NineRemotePromoModal isOpen={remoteOpen} onClose={() => setRemoteOpen(false)} />
      <LanguageSwitcher hideTrigger isOpen={langOpen} onClose={() => setLangOpen(false)} />
    </>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
