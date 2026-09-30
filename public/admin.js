(() => {
  "use strict";

  const loginScreen = document.getElementById("loginScreen");
  const dashboard = document.getElementById("dashboard");
  const loginError = document.getElementById("loginError");

  async function checkSession() {
    const res = await fetch("/api/admin/session");
    const data = await res.json();
    if (data.isAdmin) {
      loginScreen.hidden = true;
      dashboard.hidden = false;
      setupQr();
      loadDashboard();
      loadRecords();
    } else {
      loginScreen.hidden = false;
      dashboard.hidden = true;
    }
  }

  document.getElementById("loginBtn").addEventListener("click", async () => {
    loginError.textContent = "";
    const username = document.getElementById("loginUser").value.trim();
    const password = document.getElementById("loginPass").value;
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) { loginError.textContent = "Incorrect username or password."; return; }
      checkSession();
    } catch {
      loginError.textContent = "Could not reach the server. Try again.";
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    checkSession();
  });

  // ---------- check-in QR (points at this deployment's own root URL) ----------
  function setupQr() {
    const url = location.origin + "/";
    const imgSrc = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + encodeURIComponent(url);
    document.getElementById("qrImg").src = imgSrc;
    document.getElementById("qrDownload").href = imgSrc;
  }

  // ---------- dashboard stats ----------
  async function loadDashboard() {
    const res = await fetch("/api/dashboard");
    if (!res.ok) return;
    const d = await res.json();

    const statGrid = document.getElementById("statGrid");
    statGrid.innerHTML = [
      ["Today", d.today],
      ["Total check-ins", d.total],
      ["Faculty", d.facultyCount],
      ["Campuses", d.campusCount],
    ].map(([label, num]) => `<div class="stat"><div class="num">${num}</div><div class="label">${label}</div></div>`).join("");

    renderBars("campusBars", d.byCampus);
    renderBars("subjectBars", d.bySubject);
  }

  function renderBars(elId, rows) {
    const el = document.getElementById(elId);
    if (!rows.length) { el.innerHTML = '<p class="hint" style="margin:0">No data yet.</p>'; return; }
    const max = Math.max(...rows.map((r) => r.count));
    el.innerHTML = rows.map((r) => `
      <div class="bar-row">
        <div class="label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.count / max) * 100}%"></div></div>
        <div class="count">${r.count}</div>
      </div>`).join("");
  }

  // ---------- records ----------
  const filterFaculty = document.getElementById("filterFaculty");
  const filterCampus = document.getElementById("filterCampus");
  const filterDate = document.getElementById("filterDate");
  let debounceTimer = null;

  [filterFaculty, filterCampus].forEach((el) =>
    el.addEventListener("input", () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(loadRecords, 300); })
  );
  filterDate.addEventListener("change", loadRecords);
  document.getElementById("clearFilters").addEventListener("click", () => {
    filterFaculty.value = ""; filterCampus.value = ""; filterDate.value = "";
    loadRecords();
  });

  function currentParams() {
    const params = new URLSearchParams();
    if (filterFaculty.value.trim()) params.set("faculty", filterFaculty.value.trim());
    if (filterCampus.value.trim()) params.set("campus", filterCampus.value.trim());
    if (filterDate.value) params.set("date", filterDate.value);
    return params;
  }

  document.getElementById("exportBtn").addEventListener("click", () => {
    const params = currentParams();
    params.set("format", "csv");
    window.location.href = "/api/attendance?" + params.toString();
  });

  async function loadRecords() {
    const res = await fetch("/api/attendance?" + currentParams().toString());
    if (!res.ok) return;
    const rows = await res.json();
    const tbody = document.getElementById("recordsBody");
    const empty = document.getElementById("recordsEmpty");
    tbody.innerHTML = "";
    empty.hidden = rows.length > 0;

    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td class="photo"><img src="${r.photoUrl}" alt="" /></td>` +
        `<td>${escapeHtml(r.facultyName)}</td>` +
        `<td>${escapeHtml(r.campus)}</td>` +
        `<td>${escapeHtml(r.batch)}</td>` +
        `<td>${escapeHtml(r.className)}</td>` +
        `<td>${escapeHtml(r.subject)}</td>` +
        `<td class="time">${formatDateTime(r.checkinTime)}</td>` +
        `<td class="time">${formatDateTime(r.syncTime)}</td>`;
      tbody.appendChild(tr);
    }
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : s;
    return d.innerHTML;
  }

  checkSession();
})();
