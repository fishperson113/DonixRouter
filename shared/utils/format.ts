export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

type LangArg = string | boolean;

function isZhLang(lang: LangArg): boolean {
  return typeof lang === "boolean" ? lang : lang === "zh";
}
function isViLang(lang: LangArg): boolean {
  return typeof lang === "boolean" ? false : lang === "vi";
}

export function formatWindowDuration(seconds: number, lang: LangArg): string {
  const zh = isZhLang(lang);
  const vi = isViLang(lang);
  if (seconds >= 86400) {
    const days = Math.floor(seconds / 86400);
    if (zh) return `${days}\u5929`;
    if (vi) return `${days} ngày`;
    return `${days}d`;
  }
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    if (zh) return `${hours}\u5c0f\u65f6`;
    if (vi) return `${hours} giờ`;
    return `${hours}h`;
  }
  const minutes = Math.floor(seconds / 60);
  if (zh) return `${minutes}\u5206\u949f`;
  if (vi) return `${minutes} phút`;
  return `${minutes}m`;
}

export function formatResetTime(unixSec: number, lang: LangArg): string {
  const zh = isZhLang(lang);
  const vi = isViLang(lang);
  const d = new Date(unixSec * 1000);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return time;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()
  ) {
    let prefix = "Tomorrow ";
    if (zh) prefix = "\u660e\u5929 ";
    else if (vi) prefix = "Ngày mai ";
    return prefix + time;
  }

  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return date + " " + time;
}
