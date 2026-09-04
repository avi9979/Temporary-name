/**
 * מונה הצטרפויות — Google Apps Script (חינם, בלי שרת ובלי בסיס נתונים).
 * זהו רכיב אופציונלי. בלעדיו הכלי עובד על מספרים ידניים בלבד.
 *
 * התקנה:
 *   1. script.google.com  ←  New project  ←  הדביקו את הקובץ הזה.
 *   2. Deploy ← New deployment ← Web app
 *      Execute as: Me    |    Who has access: Anyone
 *   3. העתיקו את כתובת ה־/exec ושימו אותה בשדה "כתובת המונה" בלשונית ניהול.
 *
 * הסקריפט סופר לחיצות על הקישור הנצחי. הוא לא נוגע בוואטסאפ בשום צורה.
 */

const STORE = PropertiesService.getScriptProperties();

function doGet(e) {
  const action = (e.parameter.action || 'all').toLowerCase();

  if (action === 'hit') {
    const node = String(e.parameter.node || '').slice(0, 64);
    if (node) {
      const lock = LockService.getScriptLock();
      lock.waitLock(5000);
      try {
        const key = 'n:' + node;
        STORE.setProperty(key, String((Number(STORE.getProperty(key)) || 0) + 1));
      } finally {
        lock.releaseLock();
      }
    }
    return json({ ok: true });
  }

  const counts = {};
  const all = STORE.getProperties();
  for (const key in all) {
    if (key.indexOf('n:') === 0) counts[key.slice(2)] = Number(all[key]) || 0;
  }
  return json({ counts: counts });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
