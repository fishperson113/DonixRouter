import { createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>(null!);
const THEME_STORAGE_KEY = "codex-proxy-theme";
const THEME_MODES: ThemeMode[] = ["dark", "light", "system"];

function getStoredThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light" || saved === "system")
      return saved;
  } catch {}
  return "system";
}

function getSystemIsDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveIsDark(mode: ThemeMode, systemIsDark: boolean): boolean {
  return mode === "system" ? systemIsDark : mode === "dark";
}

function applyTheme(mode: ThemeMode, systemIsDark: boolean): void {
  const isDark = resolveIsDark(mode, systemIsDark);
  if (isDark) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

const _initialMode = getStoredThemeMode();
const _initialSystemIsDark = getSystemIsDark();
applyTheme(_initialMode, _initialSystemIsDark);

export function ThemeProvider({ children }: { children: ComponentChildren }) {
  const [mode, setMode] = useState<ThemeMode>(_initialMode);
  const [systemIsDark, setSystemIsDark] = useState(_initialSystemIsDark);
  const isDark = resolveIsDark(mode, systemIsDark);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      isDark,
      setMode: (nextMode: ThemeMode) => {
        setMode(nextMode);
        localStorage.setItem(THEME_STORAGE_KEY, nextMode);
        applyTheme(nextMode, systemIsDark);
      },
      toggle: () => {
        const currentIndex = THEME_MODES.indexOf(mode);
        const nextMode = THEME_MODES[(currentIndex + 1) % THEME_MODES.length];
        setMode(nextMode);
        localStorage.setItem(THEME_STORAGE_KEY, nextMode);
        applyTheme(nextMode, systemIsDark);
      },
    }),
    [isDark, mode, systemIsDark],
  );

  useEffect(() => {
    applyTheme(mode, systemIsDark);
  }, [mode, systemIsDark]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemIsDark(event.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
