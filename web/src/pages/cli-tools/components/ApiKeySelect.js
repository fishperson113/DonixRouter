"use client";

import { useEffect, useState } from "react";

const CUSTOM_VALUE = "__custom__";

const deriveMode = (value, apiKeys) => {
  if (!value) return apiKeys.length > 0 ? apiKeys[0].key : "";
  if (apiKeys.some((k) => k.key === value)) return value;
  return CUSTOM_VALUE;
};

export default function ApiKeySelect({ value, onChange, apiKeys = [], cloudEnabled = false, className = "" }) {
  const isCustom = !apiKeys.some((k) => k.key === value) && value !== "";
  const [mode, setMode] = useState(() => deriveMode(value, apiKeys));
  const [customInput, setCustomInput] = useState(isCustom ? value : "");

  useEffect(() => {
    const nextMode = deriveMode(value, apiKeys);
    setMode(nextMode);
    setCustomInput(nextMode === CUSTOM_VALUE ? value : "");
  }, [value, apiKeys]);

  const handleSelect = (e) => {
    const next = e.target.value;
    setMode(next);
    if (next === CUSTOM_VALUE) {
      setCustomInput("");
      onChange("");
    } else {
      onChange(next);
    }
  };

  const handleCustomInput = (e) => {
    const v = e.target.value;
    setCustomInput(v);
    onChange(v);
  };

  const noKeys = apiKeys.length === 0 && mode !== CUSTOM_VALUE;

  if (noKeys && mode !== CUSTOM_VALUE) {
    return (
      <span className={`surface-panel-soft min-w-0 rounded-lg px-2 py-2 text-xs text-text-muted sm:py-1.5 ${className}`}>
        {cloudEnabled ? "No API keys - Create one in Keys page" : "sk_donixrouter (default)"}
      </span>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <select
        value={mode}
        onChange={handleSelect}
        className="w-full min-w-0 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-xs text-text-main shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/40 sm:py-1.5"
      >
        {apiKeys.map((k) => (
          <option key={k.id} value={k.key}>{k.key}</option>
        ))}
        <option value={CUSTOM_VALUE}>Custom...</option>
      </select>
      {mode === CUSTOM_VALUE && (
        <input
          type="text"
          value={customInput}
          onChange={handleCustomInput}
          placeholder="sk-..."
          className="w-full min-w-0 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-xs text-text-main shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/40 sm:py-1.5"
        />
      )}
    </div>
  );
}
