"use client";

import { useState } from "react";
import NineRemotePromoModal from "./NineRemotePromoModal.js";

export default function NineRemoteButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-text-muted transition-all hover:bg-white/[0.05] hover:text-text-main"
        title="9Remote"
      >
        <span className="material-symbols-outlined text-[18px]">computer</span>
        <span className="text-xs font-medium">Remote</span>
      </button>

      <NineRemotePromoModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
