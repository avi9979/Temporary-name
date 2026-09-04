/**
 * מונה הצטרפויות — Netlify Function + Netlify Blobs.
 * זהו רכיב אופציונלי. בלעדיו הכלי עובד על מספרים ידניים בלבד.
 *
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
 *
 * הגדרת Netlify Blobs האוטומטית לא אמינה בכל הדפלוימנטים (MissingBlobsEnvironmentError
 * מתועד בתקלה נפוצה מצד נטליפיי) — לכן במקום להסתמך עליה, מוסרים כאן ל־siteID+token
 * מפורשים כשהם מוגדרים כמשתני סביבה. ר׳ README להקמת BLOBS_TOKEN.
 */

const { getStore } = require("@netlify/blobs");

const PREFIX = "node:";
const MAX_RETRIES = 8;

function counterStore() {
  const siteID = process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  return siteID && token
    ? getStore({ name: "community-counter", siteID, token })
    : getStore("community-counter");
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const action = (params.action || "all").toLowerCase();

  try {
    const store = counterStore();

    if (action === "hit") {
      const node = String(params.node || "").slice(0, 64);
      if (node) await bumpCount(store, PREFIX + node);
      return json({ ok: true });
    }

    return json({ counts: await readAll(store) });
  } catch (err) {
    /* לא מפילים את הפונקציה עם דף קריסה — מחזירים שגיאה קריאה,
       כדי ש־loadClicks בצד הלקוח פשוט יתעלם ויעבוד על המספרים הידניים. */
    console.error(err);
    return json({ error: String(err && err.message || err) }, 500);
  }
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

function json(obj, statusCode = 200) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(obj),
  };
}
