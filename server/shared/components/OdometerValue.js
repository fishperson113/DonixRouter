"use client";

import { useEffect, useRef, useMemo } from "react";

/**
 * Tokenize a formatted string into { type: "digit"|"char", val } tokens.
 * This works with any pre-formatted string (e.g. "54.826.400", "~$136.25", "40%", "304K").
 */
function tokenize(str) {
  const tokens = [];
  for (const ch of String(str)) {
    if (ch >= "0" && ch <= "9") {
      tokens.push({ type: "digit", val: ch });
    } else {
      tokens.push({ type: "char", val: ch });
    }
  }
  return tokens;
}

/**
 * Single digit window — renders a strip of 0-9 and slides to the target digit.
 */
function DigitSlot({ digit, height }) {
  const stripRef = useRef(null);
  const firstRender = useRef(true);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    const d = parseInt(digit, 10) || 0;

    if (firstRender.current) {
      // No transition on first render — snap into place
      strip.style.transition = "none";
      strip.style.transform = `translateY(${d * -height}px)`;
      // Force reflow then restore transition
      strip.getBoundingClientRect();
      strip.style.transition = "";
      firstRender.current = false;
    } else {
      strip.style.transform = `translateY(${d * -height}px)`;
    }
  }, [digit, height]);

  return (
    <span className="odo-digit-win" style={{ height }}>
      <span className="odo-digit-strip" ref={stripRef}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <span key={d} className="odo-d" style={{ height, lineHeight: `${height}px` }}>
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * OdometerValue — renders a value string with rolling digit animation.
 *
 * Props:
 *   value     - formatted string to display, e.g. "54.826.400", "~$136.25", "304K", "40%"
 *   height    - pixel height per digit cell (controls the font size proportionally)
 *   className - optional extra class on the container
 */
export default function OdometerValue({ value, height = 36, className = "" }) {
  const tokens = useMemo(() => tokenize(value), [value]);

  return (
    <span className={`odo-display ${className}`.trim()}>
      {tokens.map((tok, i) =>
        tok.type === "digit" ? (
          <DigitSlot key={`d-${i}`} digit={tok.val} height={height} />
        ) : (
          <span
            key={`c-${i}`}
            className="odo-char"
            style={{ height, lineHeight: `${height}px` }}
          >
            {tok.val}
          </span>
        )
      )}
    </span>
  );
}
