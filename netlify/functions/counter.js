/**
 * מונה הצטרפויות — Netlify Function + Netlify Blobs.
 * זהו רכיב אופציונלי. בלעדיו הכלי עובד על מספרים ידניים בלבד.
 *
 * Netlify Blobs לא דורש שום הקמה — הוא מוגדר אוטומטית בזמן ריצה על נטליפיי.
 * מספיק לפרסם את הריפו הזה (עם package.json ו־netlify.toml שכבר בריפו),
 * ואז לשים "/api/counter" בשדה "כתובת המונה" בלשונית ניהול.
 *
 * זהה בפרוטוקול שלו למונה החלופי מבוסס Google Apps Script (tools/counter.gs),
 * כדי ש־assets/core.js ו־join/index.html יעבדו איתו בלי שום שינוי:
 *   GET/POST ?action=hit&node=<id>   →  סופר הצטרפות אחת לקבוצה הזו
 *   GET      ?action=all             →  { counts: { nodeId: number, ... } }
 *
 * כל קבוצה נשמרת כמפתח (blob) נפרד — כדי שהצטרפויות לקבוצות שונות לעולם
 * לא יתחרו זו בזו על כתיבה. בתוך אותה קבוצה, כתיבה במקביל מיושבת עם
 * concurrency אופטימי (etag) ונסיונות חוזרים.
 */

const { getStore } = require("@netlify/blobs");

const PREFIX = "node:";
const MAX_RETRIES = 8;

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const action = (params.action || "all").toLowerCase();
  const store = getStore("community-counter");

  if (action === "hit") {
    const node = String(params.node || "").slice(0, 64);
    if (node) await bumpCount(store, PREFIX + node);
    return json({ ok: true });
  }

  return json({ counts: await readAll(store) });
};

async function bumpCount(store, key) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { data, etag } = await store.getWithMetadata(key);
    const next = String((Number(data) || 0) + 1);
    const result = etag
      ? await store.set(key, next, { onlyIfMatch: etag })
      : await store.set(key, next, { onlyIfNew: true });
    if (result.modified) return;
    /* מישהו אחר כתב לאותה קבוצה בדיוק באותו רגע — ננסה שוב אחרי המתנה קצרה ואקראית. */
    await sleep(10 + Math.random() * 30 * (attempt + 1));
  }
  /* כישלון אחרי כמה ניסיונות לא מפיל את הניתוב — זה לכל היותר hit בודד שהוחמץ. */
}

async function readAll(store) {
  const { blobs } = await store.list({ prefix: PREFIX });
  const entries = await Promise.all(blobs.map(async (b) => {
    const value = await store.get(b.key);
    return [b.key.slice(PREFIX.length), Number(value) || 0];
  }));
  return Object.fromEntries(entries);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(obj) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(obj),
  };
}
