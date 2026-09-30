// Ek hi Netlify Function saare /api/* routes handle karta hai.
// Data Google Sheet (via Apps Script) me store hota hai, photos Google Drive me.
import jwt from "jsonwebtoken";
import cookie from "cookie";

export const config = { path: "/api/*" };

const COOKIE_NAME = "fa_admin";
const TZ = process.env.TIMEZONE || "Asia/Kolkata";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

// ---------- auth ----------
function getSession(req) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  const token = cookie.parse(req.headers.get("cookie") || "")[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

const sessionCookie = (token, maxAge) =>
  cookie.serialize(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge });

// ---------- Google Sheet (Apps Script) ----------
async function callSheet(payload) {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) throw new Error("APPS_SCRIPT_URL / APPS_SCRIPT_SECRET not set");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, secret }),
    redirect: "follow",
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Apps Script ne JSON nahi diya (deployment access 'Anyone' hai?)");
  }
  if (data.error) throw new Error(data.message || data.error);
  return data;
}

// ---------- helpers ----------
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayOf = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : dayFmt.format(d);
};

function countBy(rows, key, limit = 8) {
  const map = new Map();
  for (const r of rows) {
    const label = r[key] || "Unspecified";
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}

const clip = (v, n = 200) => (v == null ? "" : String(v).slice(0, n));

// ---------- handler ----------
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  try {
    // ----- admin auth -----
    if (path === "/api/admin/session" && req.method === "GET") {
      const s = getSession(req);
      return json({ isAdmin: !!(s && s.isAdmin) });
    }

    if (path === "/api/admin/login" && req.method === "POST") {
      const { ADMIN_USER, ADMIN_PASS, JWT_SECRET } = process.env;
      if (!ADMIN_USER || !ADMIN_PASS || !JWT_SECRET) return json({ error: "server_not_configured" }, 500);
      const { username, password } = await req.json().catch(() => ({}));
      if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = jwt.sign({ isAdmin: true, username }, JWT_SECRET, { expiresIn: "12h" });
        return json({ ok: true, username }, 200, { "Set-Cookie": sessionCookie(token, 60 * 60 * 12) });
      }
      return json({ error: "invalid_credentials" }, 401);
    }

    if (path === "/api/admin/logout" && req.method === "POST") {
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
    }

    // ----- check-in (public) -----
    if (path === "/api/attendance" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const { clientUuid, facultyName, checkinTime, photoCaptureTime, photoDataUrl } = b;
      if (!clientUuid || !facultyName || !checkinTime || !photoCaptureTime || !photoDataUrl) {
        return json({ error: "missing_fields" }, 400);
      }
      const m = /^data:([^;]+);base64,(.+)$/.exec(photoDataUrl);
      if (!m) return json({ error: "invalid_photo" }, 400);

      const result = await callSheet({
        action: "add",
        clientUuid: clip(clientUuid, 100),
        facultyName: clip(facultyName),
        campus: clip(b.campus),
        batch: clip(b.batch),
        className: clip(b.className),
        subject: clip(b.subject),
        checkinTime: clip(checkinTime, 40),
        photoCaptureTime: clip(photoCaptureTime, 40),
        contentType: m[1],
        photoBase64: m[2],
      });
      return json(result);
    }

    // ----- admin-only data -----
    if ((path === "/api/attendance" || path === "/api/dashboard") && req.method === "GET") {
      const s = getSession(req);
      if (!s || !s.isAdmin) return json({ error: "not_authenticated" }, 401);

      const { rows: all } = await callSheet({ action: "list" });
      all.sort((a, b) => new Date(b.checkinTime) - new Date(a.checkinTime));

      if (path === "/api/dashboard") {
        const today = dayOf(new Date());
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const perDay = new Map();
        for (const r of all) {
          if (new Date(r.checkinTime).getTime() > sevenDaysAgo) {
            const d = dayOf(r.checkinTime);
            perDay.set(d, (perDay.get(d) || 0) + 1);
          }
        }
        return json({
          total: all.length,
          today: all.filter((r) => dayOf(r.checkinTime) === today).length,
          facultyCount: new Set(all.map((r) => r.facultyName)).size,
          campusCount: new Set(all.map((r) => r.campus).filter(Boolean)).size,
          byCampus: countBy(all, "campus"),
          bySubject: countBy(all, "subject"),
          last7Days: [...perDay.entries()].sort().map(([day, count]) => ({ day, count })),
        });
      }

      const q = url.searchParams;
      const faculty = (q.get("faculty") || "").toLowerCase();
      const campus = q.get("campus");
      const batch = q.get("batch");
      const date = q.get("date");
      const rows = all
        .filter((r) => !faculty || r.facultyName.toLowerCase().includes(faculty))
        .filter((r) => !campus || r.campus === campus)
        .filter((r) => !batch || r.batch === batch)
        .filter((r) => !date || dayOf(r.checkinTime) === date)
        .slice(0, 1000);

      if (q.get("format") === "csv") {
        const header = ["Faculty", "Campus", "Batch", "Class", "Subject", "Check-in Time", "Photo Time", "Sync Time", "Photo URL"];
        const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const lines = [header.join(",")];
        for (const r of rows) {
          lines.push([r.facultyName, r.campus, r.batch, r.className, r.subject, r.checkinTime, r.photoCaptureTime, r.syncTime, r.photoUrl].map(esc).join(","));
        }
        return new Response(lines.join("\n"), {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="attendance-${Date.now()}.csv"`,
          },
        });
      }
      return json(rows);
    }

    return json({ error: "not_found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "server_error", message: err.message }, 500);
  }
};
