const CLASS_COLORS: Record<string, string> = {
  nightwatch: "#a9744f",
  sniper: "#eab308",
  alithea: "#2dd4bf",
  highwizard: "#3b82f6",
  highpriest: "#a3e635",
  paladin: "#f87171",
  lordknight: "#dc2626",
  assassincross: "#a855f7",
  whitesmith: "#f97316",
  champion: "#15803d",
};

const DEFAULT_COLOR = "#7a8399";

function normalize(className: string) {
  return className.toLowerCase().replace(/[^a-z]/g, "");
}

export function getClassColor(className: string | null | undefined): string {
  if (!className) return DEFAULT_COLOR;
  return CLASS_COLORS[normalize(className)] ?? DEFAULT_COLOR;
}
