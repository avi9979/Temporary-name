/* core.js — טעינת הנתונים והחישובים המשותפים לכל הדפים.
   מקור האמת היחיד הוא data/groups.json בריפו. אין בסיס נתונים. */

export const PLATFORMS = {
  whatsapp_group:     { label: "קבוצת וואטסאפ",  capped: true  },
  whatsapp_community: { label: "קהילת וואטסאפ",  capped: false },
  whatsapp_channel:   { label: "ערוץ וואטסאפ",   capped: false },
  telegram:           { label: "טלגרם",          capped: false },
  facebook_group:     { label: "קבוצת פייסבוק",  capped: false },
  linkedin:           { label: "לינקדאין",       capped: false },
  other:              { label: "אחר",            capped: false },
};

/* מטמון־דפדפן עוקף עדכונים, ולכן מוסיפים חותמת זמן לבקשה. */
export async function loadData(base = "") {
  const res = await fetch(`${base}data/groups.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`טעינת הנתונים נכשלה (${res.status})`);
  return normalize(await res.json());
}

export function normalize(raw) {
  const d = structuredClone(raw);
  d.config ??= {};
  d.config.warnAtPercent ??= 85;
  d.config.staleAfterDays ??= 14;
  d.brands ??= [];
  d.funnels ??= [];
  d.nodes ??= [];
  d.history ??= [];
  d.broadcasts ??= [];
  for (const b of d.brands) {
    b.color ??= "#2563eb";
  }
  for (const n of d.nodes) {
    n.platform ??= "whatsapp_group";
    n.capacity = Number(n.capacity) || 0;
    n.members = Number(n.members) || 0;
    n.clicksAtCalibration = Number(n.clicksAtCalibration) || 0;
    n.acceptingJoins = n.acceptingJoins !== false;
  }
  for (const f of d.funnels) {
    f.routingMode ??= "sequential";
  }
  return d;
}

export const byId = (list, id) => list.find((x) => x.id === id) || null;

/* מספר החברים המוצג = הכיול הידני האחרון + ההצטרפויות שנספרו מאז.
   clicks הוא מפת { nodeId: לחיצות מצטברות } מהמונה החיצוני, אם הוגדר. */
export function estimatedMembers(node, clicks) {
  const total = clicks?.[node.id];
  if (typeof total !== "number") return { value: node.members, estimated: false, since: 0 };
  const since = Math.max(0, total - node.clicksAtCalibration);
  return { value: node.members + since, estimated: since > 0, since };
}

export function capacityOf(node) {
  return PLATFORMS[node.platform]?.capped ? node.capacity : Infinity;
}

/* מצב קבוצה: open (יש מקום) / warn (כמעט מלאה) / full / closed (סגורה ידנית) / broken (אין קישור) */
export function nodeStatus(node, data, clicks) {
  if (!node.inviteUrl) return "broken";
  if (!node.acceptingJoins) return "closed";
  const cap = capacityOf(node);
  if (cap === Infinity) return "open";
  const { value } = estimatedMembers(node, clicks);
  const free = cap - value;
  if (free <= 0) return "full";
  if (value / cap >= data.config.warnAtPercent / 100) return "warn";
  return "open";
}

export const isJoinable = (s) => s === "open" || s === "warn";

export const ROUTING_MODES = {
  sequential: { label: "ברצף",             hint: "ממלאים קבוצה אחת עד הסוף, ואז עוברים לבאה בתור." },
  balanced:   { label: "מאוזן (Load Balancer)", hint: "כל כניסה הולכת לקבוצה עם אחוז התפוסה הנמוך ביותר, כדי שכל הקבוצות יתמלאו בערך ביחד." },
};

/* אחוז התפוסה של הקבוצה — 0 לקבוצה ללא תקרה. משמש לניתוב מאוזן. */
function occupancy(node, clicks) {
  const cap = capacityOf(node);
  if (cap === Infinity) return 0;
  return estimatedMembers(node, clicks).value / cap;
}

/* היעד של הקישור הנצחי, בין הקבוצות הפתוחות בתור של המשפך:
   ברצף — הראשונה שיש בה מקום. מאוזן — זו עם אחוז התפוסה הנמוך ביותר,
   כך שכל הקבוצות גדלות יחד באותו קצב במקום אחת אחרי השנייה.
   אם כולן מלאות — רשת הביטחון של המשפך (ערוץ/קהילה), שאין לה תקרה. */
export function pickTarget(funnel, data, clicks) {
  const ordered = (funnel.order || []).map((id) => byId(data.nodes, id)).filter(Boolean);
  const joinable = ordered.filter((node) => isJoinable(nodeStatus(node, data, clicks)));
  if (joinable.length) {
    const node = funnel.routingMode === "balanced"
      ? joinable.reduce((best, n) => (occupancy(n, clicks) < occupancy(best, clicks) ? n : best))
      : joinable[0];
    return { node, reason: "ordered" };
  }
  const fb = funnel.fallbackNodeId ? byId(data.nodes, funnel.fallbackNodeId) : null;
  if (fb && fb.inviteUrl && fb.acceptingJoins) return { node: fb, reason: "fallback" };
  return { node: null, reason: "none" };
}

export function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function fmt(n) {
  if (n === Infinity) return "∞";
  return new Intl.NumberFormat("he-IL").format(Math.round(n));
}

/* המונה החיצוני הוא אופציונלי לחלוטין. אם הוא לא מוגדר או לא זמין —
   הכלי ממשיך לעבוד על המספרים הידניים בלבד. */
export async function loadClicks(config) {
  const url = config?.counterEndpoint;
  if (!url) return null;
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}action=all`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json && typeof json === "object" ? json.counts || json : null;
  } catch {
    return null;
  }
}
