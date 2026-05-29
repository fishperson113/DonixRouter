import { Outlet, NavLink } from "react-router-dom";
import { useTheme } from "../providers/ThemeProvider";

const NAV_ITEMS = [
  { path: "providers", label: "Providers", icon: "dns" },
  { path: "endpoint", label: "Endpoint", icon: "link" },
  { path: "usage", label: "Usage", icon: "bar_chart" },
  { path: "cli-tools", label: "CLI Tools", icon: "terminal" },
  { path: "proxy-pools", label: "Proxy Pools", icon: "hub" },
  { path: "combos", label: "Combos", icon: "merge" },
  { path: "mitm", label: "MITM", icon: "security" },
  { path: "profile", label: "Profile", icon: "person" },
];

export default function DashboardLayout() {
  const { theme, toggle } = useTheme();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 border-r border-[var(--border)] bg-[var(--card)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-lg font-bold">DonixRouter</h1>
          <p className="text-xs text-[var(--muted-foreground)]">AI Infrastructure</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-[var(--primary)] text-white"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
                }`
              }
            >
              <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-[var(--border)]">
          <button
            onClick={toggle}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm w-full text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <span className="material-symbols-outlined text-[18px]">
              {theme === "dark" ? "light_mode" : "dark_mode"}
            </span>
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
