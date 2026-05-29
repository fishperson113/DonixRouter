"use client";

import PropTypes from "prop-types";
import ThemeToggle from "../ThemeToggle";

export default function AuthLayout({ children }) {
  return (
    <div className="app-shell relative flex min-h-screen flex-col overflow-x-hidden bg-bg transition-colors duration-500 selection:bg-primary/20 selection:text-primary">
      <div className="pointer-events-none fixed left-1/2 top-1/2 z-0 h-[820px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-[110px]" />
      <div className="pointer-events-none fixed bottom-0 right-0 z-0 h-[620px] w-[620px] translate-x-1/3 translate-y-1/3 rounded-full bg-orange-200/20 blur-[140px] dark:bg-orange-900/10" />
      <div className="pointer-events-none fixed left-0 top-0 z-0 h-[420px] w-[420px] -translate-x-1/4 -translate-y-1/4 rounded-full bg-cyan-400/10 blur-[120px]" />

      {/* Theme toggle */}
      <div className="absolute top-6 right-6 z-20">
        <ThemeToggle variant="card" />
      </div>

      {/* Content */}
      <main className="z-10 flex h-full w-full flex-1 flex-col items-center justify-center p-4 sm:p-6">
        {children}
      </main>
    </div>
  );
}

AuthLayout.propTypes = {
  children: PropTypes.node.isRequired,
};
