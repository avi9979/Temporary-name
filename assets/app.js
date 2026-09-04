/* app.js — מרכז הבקרה. אין שרת ואין בסיס נתונים:
   הכול נטען מ־data/groups.json ונשמר בחזרה לאותו קובץ. */

import {
  PLATFORMS, ROUTING_MODES, loadData, loadClicks, byId, estimatedMembers, capacityOf,
  nodeStatus, pickTarget, daysSince, todayISO, fmt,
} from "./core.js";

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : String(kid));
  }
  return n;
}

const TOKEN_KEY = "cc.gh.token";

const state = {
  data: null,
  clicks: null,
  dirty: false,
  activeBroadcastId: null,
};

/* ---------------------------------------------------------- עזרים */

function toast(text) {
  const t = el("div", { class: "toast", textContent: text });
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

function markDirty() {
  state.dirty = true;
  const s = $("#save-state");
  s.textContent = "יש שינויים שלא נשמרו";
  s.className = "pill warn";
}

function markClean() {
  state.dirty = false;
  const s = $("#save-state");
  s.textContent = "הכול שמור";
  s.className = "pill ok";
}

const STATUS_TEXT = {
  open:   ["יש מקום",      "ok"],
  warn:   ["כמעט מלאה",    "warn"],
  full:   ["מלאה",         "danger"],
  closed: ["סגורה לכניסה", ""],
  broken: ["חסר קישור",    "danger"],
};

const brandName = (id) => byId(state.data.brands, id)?.name ?? "—";

function siteBase() {
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

const joinUrl = (funnelId) => `${siteBase()}join/?c=${encodeURIComponent(funnelId)}`;

async function copy(text, msg = "הועתק") {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    /* דפדפנים שחוסמים clipboard — נופלים לבחירה ידנית */
    const ta = el("textarea", { value: text, style: "position:fixed;opacity:0" });
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast(msg);
  }
}

/* ---------------------------------------------------------- סקירה */

function renderStats() {
  const d = state.data;
  const groups = d.nodes.filter((n) => PLATFORMS[n.platform]?.capped);
  const totalMembers = d.nodes.reduce((s, n) => s + estimatedMembers(n, state.clicks).value, 0);
  const freeSeats = groups.reduce((s, n) => {
    const cap = capacityOf(n);
    return s + Math.max(0, cap - estimatedMembers(n, state.clicks).value);
  }, 0);
  const openNow = d.nodes.filter((n) => ["open", "warn"].includes(nodeStatus(n, d, state.clicks))).length;
  const joinedThisMonth = monthlyGrowth();

  const stats = [
    [fmt(totalMembers), "חברים בסך הכול"],
    [fmt(d.nodes.length), "קבוצות, קהילות וערוצים"],
    [fmt(freeSeats), "מקומות פנויים בקבוצות"],
    [openNow ? fmt(openNow) : "0", "פתוחות לכניסה עכשיו"],
    [joinedThisMonth == null ? "—" : fmt(joinedThisMonth), "נכנסו החודש"],
  ];

  $("#stats").replaceChildren(
    ...stats.map(([n, l]) => el("div", { class: "stat" },
      el("div", { class: "n" }, n),
      el("div", { class: "l" }, l),
    )),
  );
}

/* ההפרש בין הסך הכול היום לסך הכול בתמונת המצב הראשונה של החודש.
   מחזיר null כשאין מספיק היסטוריה — עדיף "—" על מספר מומצא. */
function monthlyGrowth() {
  const d = state.data;
  const monthStart = new Date();
  monthStart.setDate(1);
  const cutoff = monthStart.toISOString().slice(0, 10);
  const snaps = d.history.filter((h) => h.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  if (!snaps.length) return null;
  const now = d.nodes.reduce((s, n) => s + estimatedMembers(n, state.clicks).value, 0);
  return Math.max(0, now - snaps[0].total);
}

function renderPermalinks() {
  const rows = state.data.funnels.map((f) => {
    const url = joinUrl(f.id);
    const { node, reason } = pickTarget(f, state.data, state.clicks);
    const target = node
      ? `${reason === "fallback" ? "רשת ביטחון · " : ""}${node.name}`
      : "אין יעד פנוי — צריך לפתוח קבוצה";
    return el("div", { class: "task p3" },
      el("i", { class: "dot" }),
      el("div", { class: "why" },
        el("b", {}, f.name),
        el("span", {}, url),
        el("span", { style: "display:block" }, `כרגע מנתב אל: ${target}`),
      ),
      el("button", { class: "sm", onClick: () => copy(url, "הקישור הועתק") }, "העתק"),
      el("a", { class: "btn sm", href: url, target: "_blank", rel: "noopener" }, "בדוק"),
    );
  });
  $("#permalinks").replaceChildren(...(rows.length ? rows : [el("div", { class: "empty" }, "עדיין אין משפכים. הוסיפו אחד בלשונית ניהול.")]));
}

function renderNodesTable() {
  const d = state.data;
  const rows = d.nodes.map((n) => {
    const { value, estimated } = estimatedMembers(n, state.clicks);
    const cap = capacityOf(n);
    const pct = cap === Infinity ? 0 : Math.min(100, (value / cap) * 100);
    const [label, cls] = STATUS_TEXT[nodeStatus(n, d, state.clicks)];
    const days = daysSince(n.calibratedAt);

    return el("tr", {},
      el("td", {}, n.inviteUrl
        ? el("a", { href: n.inviteUrl, target: "_blank", rel: "noopener" }, n.name)
        : n.name),
      el("td", {}, el("span", { class: "pill brand" }, brandName(n.brandId))),
      el("td", {}, PLATFORMS[n.platform]?.label ?? n.platform),
      el("td", { class: "num" }, fmt(value) + (estimated ? " ~" : "")),
      el("td", {}, cap === Infinity
        ? el("span", { class: "pill" }, "ללא הגבלה")
        : el("div", { class: `bar ${pct >= 100 ? "full" : pct >= d.config.warnAtPercent ? "warn" : ""}` },
            el("i", { style: `width:${pct}%` }))),
      el("td", { class: "num" }, cap === Infinity ? "∞" : fmt(Math.max(0, cap - value))),
      el("td", { class: "num" }, days === Infinity ? "אף פעם" : days === 0 ? "היום" : `לפני ${days} ימים`),
      el("td", {}, el("span", { class: `pill ${cls}` }, label)),
    );
  });
  $("#nodes-body").replaceChildren(...(rows.length ? rows : [
    el("tr", {}, el("td", { colSpan: 8 }, el("div", { class: "empty" }, "אין עדיין קבוצות."))),
  ]));
}

/* ---------------------------------------------------------- משימות */

function buildTasks() {
  const d = state.data;
  const tasks = [];
  const goto = (tab) => () => selectTab(tab);

  for (const f of d.funnels) {
    const { node, reason } = pickTarget(f, d, state.clicks);
    if (!node) {
      tasks.push({
        p: 1, title: `${f.name}: אין לאן לנתב`,
        why: "כל הקבוצות מלאות או סגורות, ואין רשת ביטחון. כל מי שלוחץ על הקישור עכשיו נתקל בקיר.",
        action: ["פתח קבוצה חדשה", goto("manage")],
      });
    } else if (reason === "fallback") {
      tasks.push({
        p: 1, title: `${f.name}: הקבוצות מלאות`,
        why: `הקישור מנתב כרגע ל־${node.name} כרשת ביטחון. פתחו קבוצה חדשה כדי לחזור למסלול.`,
        action: ["פתח קבוצה חדשה", goto("manage")],
      });
    }
    if (!f.fallbackNodeId) {
      tasks.push({
        p: 3, title: `${f.name}: אין רשת ביטחון`,
        why: "הגדירו ערוץ או קהילה כיעד גיבוי, כדי שגם ברגע שכולן מלאות אף אחד לא ילך לאיבוד.",
        action: ["הגדר", goto("manage")],
      });
    }
  }

  for (const n of d.nodes) {
    const status = nodeStatus(n, d, state.clicks);
    const { value } = estimatedMembers(n, state.clicks);
    const cap = capacityOf(n);

    if (status === "broken") {
      tasks.push({
        p: 1, title: `${n.name}: חסר קישור הזמנה`,
        why: "בלי קישור הקבוצה לא קיימת מבחינת הכלי ואי אפשר לנתב אליה.",
        action: ["הוסף קישור", goto("manage")],
      });
    }
    if (status === "warn") {
      const inFunnel = d.funnels.find((f) => (f.order || []).includes(n.id));
      const isLast = inFunnel && inFunnel.order.at(-1) === n.id;
      tasks.push({
        p: 2, title: `${n.name} כמעט מלאה`,
        why: `${fmt(value)} מתוך ${fmt(cap)}. ${isLast ? "זו האחרונה בתור — פתחו את הבאה עכשיו, לא כשהיא תתמלא." : "הבאה בתור כבר מוכנה."}`,
        action: isLast ? ["פתח את הבאה", goto("manage")] : null,
      });
    }
    if (status === "full") {
      tasks.push({
        p: 2, title: `${n.name} מלאה`,
        why: "הכלי כבר מדלג עליה. אפשר לסמן אותה כסגורה לכניסה כדי לנקות את התמונה.",
        action: ["סמן כסגורה", () => { n.acceptingJoins = false; markDirty(); renderAll(); }],
      });
    }
    if (n.inviteUrl && daysSince(n.calibratedAt) > d.config.staleAfterDays) {
      tasks.push({
        p: 3, title: `${n.name}: מספר החברים מיושן`,
        why: n.calibratedAt
          ? `הכיול האחרון היה לפני ${daysSince(n.calibratedAt)} ימים.`
          : "המספר מעולם לא כויל מול המציאות.",
        action: ["עדכן מספר", goto("manage")],
      });
    }
  }

  const bc = activeBroadcast();
  if (bc) {
    const pending = d.nodes.filter((n) => n.inviteUrl && !(bc.sentTo || []).includes(n.id));
    if (pending.length) {
      tasks.push({
        p: 3, title: `"${bc.title}" עוד לא נשלחה ל־${pending.length} מקומות`,
        why: pending.map((n) => n.name).join(" · "),
        action: ["המשך שליחה", goto("broadcast")],
      });
    }
  }

  if (!d.history.some((h) => h.date === todayISO())) {
    tasks.push({
      p: 4, title: "שמור תמונת מצב של היום",
      why: "תמונת מצב יומית היא מה שמאפשר להגיד 'כמה אנשים נכנסו החודש' במספר, לא בהרגשה.",
      action: ["שמור תמונת מצב", () => { snapshot(); renderAll(); }],
    });
  }

  return tasks.sort((a, b) => a.p - b.p);
}

function renderTasks() {
  const tasks = buildTasks();
  $("#task-count").textContent = tasks.length ? `(${tasks.length})` : "";
  $("#tasks").replaceChildren(...(tasks.length ? tasks.map((t) => el("div", { class: `task p${Math.min(t.p, 3)}` },
    el("i", { class: "dot" }),
    el("div", { class: "why" }, el("b", {}, t.title), el("span", {}, t.why)),
    t.action ? el("button", { class: "sm primary", onClick: t.action[1] }, t.action[0]) : null,
  )) : [el("div", { class: "empty" }, "אין מה לעשות. הכול פתוח, מכויל ומעודכן.")]));
}

function snapshot() {
  const total = state.data.nodes.reduce((s, n) => s + estimatedMembers(n, state.clicks).value, 0);
  const today = todayISO();
  const existing = state.data.history.find((h) => h.date === today);
  if (existing) existing.total = total;
  else state.data.history.push({ date: today, total, perNode: Object.fromEntries(
    state.data.nodes.map((n) => [n.id, estimatedMembers(n, state.clicks).value]))});
  state.data.history = state.data.history.slice(-400);
  markDirty();
  toast("תמונת המצב נשמרה");
}

/* ---------------------------------------------------------- הודעה לכולם */

const activeBroadcast = () =>
  byId(state.data.broadcasts, state.activeBroadcastId) ?? state.data.broadcasts.at(-1) ?? null;

function renderBroadcast() {
  const bc = activeBroadcast();
  if (bc && document.activeElement !== $("#bc-title") && document.activeElement !== $("#bc-text")) {
    $("#bc-title").value = bc.title;
    $("#bc-text").value = bc.text;
  }

  const targets = state.data.nodes.filter((n) => n.inviteUrl);
  $("#bc-targets").replaceChildren(...(targets.length ? targets.map((n) => {
    const sent = bc ? (bc.sentTo || []).includes(n.id) : false;
    return el("div", { class: `task ${sent ? "" : "p3"}` },
      el("input", {
        type: "checkbox", checked: sent, disabled: !bc,
        style: "width:auto;flex:none",
        onChange: (e) => {
          bc.sentTo ??= [];
          bc.sentTo = e.target.checked
            ? [...new Set([...bc.sentTo, n.id])]
            : bc.sentTo.filter((x) => x !== n.id);
          markDirty(); renderAll();
        },
      }),
      el("div", { class: "why" },
        el("b", {}, n.name),
        el("span", {}, `${brandName(n.brandId)} · ${PLATFORMS[n.platform]?.label ?? n.platform}`)),
      el("button", { class: "sm", disabled: !bc, onClick: () => copy($("#bc-text").value, "הנוסח הועתק") }, "העתק נוסח"),
      el("a", { class: "btn sm", href: n.inviteUrl, target: "_blank", rel: "noopener" }, "פתח בוואטסאפ"),
    );
  }) : [el("div", { class: "empty" }, "אין יעדים עם קישור. הוסיפו קישורים בלשונית ניהול.")]));

  const past = [...state.data.broadcasts].reverse();
  $("#bc-history-card").hidden = past.length < 1;
  $("#bc-history").replaceChildren(...past.map((b) => el("div", { class: "task" },
    el("i", { class: "dot" }),
    el("div", { class: "why" },
      el("b", {}, b.title || "ללא שם"),
      el("span", {}, `${b.createdAt} · נשלח ל־${(b.sentTo || []).length} מתוך ${state.data.nodes.filter((n) => n.inviteUrl).length}`)),
    el("button", { class: "sm", onClick: () => copy(b.text, "הנוסח הועתק") }, "העתק נוסח"),
    b.id === (bc?.id)
      ? el("span", { class: "pill ok" }, "פעיל")
      : el("button", { class: "sm", onClick: () => { state.activeBroadcastId = b.id; renderAll(); } }, "הפוך לפעיל"),
  )));
}

function saveBroadcast() {
  const title = $("#bc-title").value.trim();
  const text  = $("#bc-text").value.trim();
  if (!text) return toast("אין מה לשמור — הנוסח ריק");

  const bc = activeBroadcast();
  if (bc && bc.title === title) {
    bc.text = text;
    toast("הקמפיין עודכן");
  } else {
    const id = `bc-${Date.now().toString(36)}`;
    state.data.broadcasts.push({ id, title: title || "ללא שם", text, createdAt: todayISO(), sentTo: [] });
    state.activeBroadcastId = id;
    toast("קמפיין חדש נוצר");
  }
  markDirty();
  renderAll();
}

/* ---------------------------------------------------------- ניהול */

function renderManage() {
  const d = state.data;

  $("#manage-nodes").replaceChildren(...d.nodes.map((n) => {
    const capped = PLATFORMS[n.platform]?.capped;
    const field = (label, input) => el("div", { class: "field" }, el("label", {}, label), input);
    const bind = (key, opts = {}) => el("input", {
      value: n[key] ?? "", ...opts,
      onChange: (e) => {
        n[key] = opts.type === "number" ? Number(e.target.value) || 0 : e.target.value;
        markDirty(); renderAll();
      },
    });

    return el("div", { class: "card", style: "box-shadow:none" },
      el("div", { class: "grid-2" },
        field("שם", bind("name")),
        field("מותג", el("select", {
          onChange: (e) => { n.brandId = e.target.value; markDirty(); renderAll(); },
        }, ...d.brands.map((b) => el("option", { value: b.id, selected: b.id === n.brandId }, b.name)))),
        field("סוג", el("select", {
          onChange: (e) => { n.platform = e.target.value; markDirty(); renderAll(); },
        }, ...Object.entries(PLATFORMS).map(([k, v]) =>
          el("option", { value: k, selected: k === n.platform }, v.label)))),
        field("קישור הזמנה", bind("inviteUrl", { placeholder: "https://chat.whatsapp.com/…" })),
        capped ? field("תפוסה מרבית", bind("capacity", { type: "number", min: 1 })) : null,
        field("מספר חברים (כיול ידני)", el("input", {
          type: "number", min: 0, value: n.members,
          onChange: (e) => {
            n.members = Number(e.target.value) || 0;
            n.calibratedAt = todayISO();
            n.clicksAtCalibration = state.clicks?.[n.id] ?? n.clicksAtCalibration;
            markDirty(); renderAll();
          },
        })),
      ),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px" },
        el("label", { style: "display:flex;gap:6px;align-items:center;margin:0" },
          el("input", {
            type: "checkbox", checked: n.acceptingJoins, style: "width:auto",
            onChange: (e) => { n.acceptingJoins = e.target.checked; markDirty(); renderAll(); },
          }), "פתוחה לכניסה"),
        el("span", { class: "pill" }, n.calibratedAt ? `כויל ב־${n.calibratedAt}` : "לא כויל"),
        el("span", { style: "flex:1" }),
        el("button", {
          class: "sm ghost",
          onClick: () => {
            if (!confirm(`למחוק את "${n.name}"? הפעולה גם תסיר אותה מכל המשפכים.`)) return;
            d.nodes = d.nodes.filter((x) => x.id !== n.id);
            for (const f of d.funnels) {
              f.order = (f.order || []).filter((x) => x !== n.id);
              if (f.fallbackNodeId === n.id) f.fallbackNodeId = "";
            }
            markDirty(); renderAll();
          },
        }, "מחק"),
      ),
    );
  }));

  $("#manage-funnels").replaceChildren(...d.funnels.map((f) => {
    const inOrder = (f.order || []).map((id) => byId(d.nodes, id)).filter(Boolean);
    const available = d.nodes.filter((n) => !(f.order || []).includes(n.id));

    return el("div", { class: "card", style: "box-shadow:none" },
      el("b", {}, f.name),
      el("div", { class: "hint" }, joinUrl(f.id)),
      el("div", { class: "field", style: "margin-top:10px;max-width:340px" },
        el("label", {}, "אופן ניתוב"),
        el("select", {
          onChange: (e) => { f.routingMode = e.target.value; markDirty(); renderAll(); },
        }, ...Object.entries(ROUTING_MODES).map(([k, v]) =>
          el("option", { value: k, selected: k === (f.routingMode || "sequential") }, v.label))),
        el("div", { class: "hint" }, ROUTING_MODES[f.routingMode]?.hint ?? ROUTING_MODES.sequential.hint),
      ),
      ...inOrder.map((n, i) => el("div", { class: "task" },
        el("span", { class: "pill" }, `${i + 1}`),
        el("div", { class: "why" }, el("b", {}, n.name),
          el("span", {}, STATUS_TEXT[nodeStatus(n, d, state.clicks)][0])),
        el("button", {
          class: "sm", disabled: i === 0,
          onClick: () => { const o = f.order; [o[i - 1], o[i]] = [o[i], o[i - 1]]; markDirty(); renderAll(); },
        }, "↑"),
        el("button", {
          class: "sm", disabled: i === inOrder.length - 1,
          onClick: () => { const o = f.order; [o[i + 1], o[i]] = [o[i], o[i + 1]]; markDirty(); renderAll(); },
        }, "↓"),
        el("button", {
          class: "sm ghost",
          onClick: () => { f.order = f.order.filter((x) => x !== n.id); markDirty(); renderAll(); },
        }, "הסר"),
      )),
      el("div", { class: "grid-2", style: "margin-top:10px" },
        el("div", { class: "field" },
          el("label", {}, "הוסף לתור"),
          el("select", {
            onChange: (e) => {
              if (!e.target.value) return;
              f.order = [...(f.order || []), e.target.value];
              markDirty(); renderAll();
            },
          }, el("option", { value: "" }, "— בחרו —"),
             ...available.map((n) => el("option", { value: n.id }, n.name)))),
        el("div", { class: "field" },
          el("label", {}, "רשת ביטחון (כשכולן מלאות)"),
          el("select", {
            onChange: (e) => { f.fallbackNodeId = e.target.value; markDirty(); renderAll(); },
          }, el("option", { value: "" }, "— אין —"),
             ...d.nodes.filter((n) => !PLATFORMS[n.platform]?.capped)
               .map((n) => el("option", { value: n.id, selected: n.id === f.fallbackNodeId }, n.name)))),
      ),
    );
  }));

  $("#cfg-warn").value    = d.config.warnAtPercent;
  $("#cfg-stale").value   = d.config.staleAfterDays;
  $("#cfg-branch").value  = d.config.repo?.branch ?? "main";
}

function addNode() {
  const d = state.data;
  const brandId = d.brands[0]?.id ?? "";
  const n = {
    id: `node-${Date.now().toString(36)}`,
    brandId, platform: "whatsapp_group",
    name: `קבוצה חדשה ${d.nodes.length + 1}`,
    inviteUrl: "", capacity: 1024, members: 0,
    calibratedAt: todayISO(), clicksAtCalibration: 0,
    acceptingJoins: true, notes: "",
  };
  d.nodes.push(n);
  markDirty(); renderAll();
  toast("נוספה. עכשיו הדביקו את קישור ההזמנה ושייכו אותה למשפך.");
}

/* ---------------------------------------------------------- שמירה לגיטהאב */

const b64 = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));

function serialize() {
  const out = structuredClone(state.data);
  out.updatedAt = todayISO();
  return JSON.stringify(out, null, 2) + "\n";
}

async function saveToGithub() {
  const token = $("#gh-token").value.trim();
  if (!token) return toast("צריך טוקן גיטהאב כדי לשמור");
  localStorage.setItem(TOKEN_KEY, token);

  const repo = state.data.config.repo ?? {};
  const branch = $("#cfg-branch").value.trim() || repo.branch || "main";
  const path = repo.path || "data/groups.json";
  const api = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const btn = $("#save-github");
  btn.disabled = true;
  btn.textContent = "שומר…";
  try {
    const head = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
    if (!head.ok && head.status !== 404) throw new Error(`קריאת הקובץ נכשלה (${head.status})`);
    const sha = head.ok ? (await head.json()).sha : undefined;

    const put = await fetch(api, {
      method: "PUT", headers,
      body: JSON.stringify({
        message: "עדכון נתוני הקהילות ממרכז הבקרה",
        content: b64(serialize()),
        branch, ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) throw new Error(`${put.status} ${(await put.text()).slice(0, 160)}`);
    markClean();
    toast("נשמר. הקישורים הנצחיים כבר מעודכנים.");
  } catch (err) {
    console.error(err);
    alert(`השמירה נכשלה:\n${err.message}\n\nבדקו שהטוקן בתוקף ושיש לו הרשאת Contents: Read and write על הריפו.`);
  } finally {
    btn.disabled = false;
    btn.textContent = "שמור לגיטהאב";
  }
}

function downloadJson() {
  const blob = new Blob([serialize()], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "groups.json" });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

/* ---------------------------------------------------------- לשוניות ואתחול */

function selectTab(name) {
  $$("[role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $$(".tab-panel").forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  location.hash = name;
}

function renderAll() {
  renderStats();
  renderPermalinks();
  renderNodesTable();
  renderTasks();
  renderBroadcast();
  renderManage();
}

async function boot() {
  try {
    state.data = await loadData("");
  } catch (err) {
    const box = $("#load-error");
    box.hidden = false;
    box.textContent = `לא הצלחנו לטעון את data/groups.json — ${err.message}`;
    return;
  }
  state.clicks = await loadClicks(state.data.config);

  $("#site-title").textContent = state.data.config.siteName ?? "מרכז הבקרה של הקהילות";
  $("#site-sub").textContent =
    `${state.data.brands.map((b) => b.name).join(" · ")} · עודכן ${state.data.updatedAt ?? "—"}` +
    (state.clicks ? "" : " · המונה כבוי, המספרים ידניים");
  $("#gh-token").value = localStorage.getItem(TOKEN_KEY) ?? "";

  $$("[role=tab]").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));
  $("#add-node").addEventListener("click", addNode);
  $("#bc-save").addEventListener("click", saveBroadcast);
  $("#bc-clear").addEventListener("click", () => { $("#bc-title").value = ""; $("#bc-text").value = ""; });
  $("#save-github").addEventListener("click", saveToGithub);
  $("#save-download").addEventListener("click", downloadJson);
  $("#reload").addEventListener("click", () => {
    if (state.dirty && !confirm("יש שינויים שלא נשמרו. לטעון מחדש ולאבד אותם?")) return;
    location.reload();
  });

  for (const [id, key] of [["#cfg-warn", "warnAtPercent"], ["#cfg-stale", "staleAfterDays"]]) {
    $(id).addEventListener("change", (e) => {
      state.data.config[key] = Number(e.target.value) || state.data.config[key];
      markDirty(); renderAll();
    });
  }
  $("#cfg-branch").addEventListener("change", (e) => {
    state.data.config.repo = { ...(state.data.config.repo ?? {}), branch: e.target.value.trim() };
    markDirty();
  });

  addEventListener("beforeunload", (e) => { if (state.dirty) e.preventDefault(); });

  markClean();
  renderAll();
  const tab = location.hash.slice(1);
  if (["overview", "tasks", "broadcast", "manage"].includes(tab)) selectTab(tab);
}

boot();
