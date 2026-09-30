(() => {
  "use strict";

  // ---------- tiny IndexedDB queue ----------
  const DB_NAME = "faculty-attendance";
  const STORE = "records";
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "clientUuid" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function putRecord(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function getAllRecords() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- prefill form from last submission ----------
  const fieldIds = ["fName", "fCampus", "fBatch", "fClass", "fSubject"];
  for (const id of fieldIds) {
    const v = localStorage.getItem("fa_" + id);
    if (v) document.getElementById(id).value = v;
  }

  // ---------- connectivity ----------
  const connIndicator = document.getElementById("connIndicator");
  const connLabel = document.getElementById("connLabel");
  let isConnected = false;

  function setConnected(v) {
    isConnected = v;
    connIndicator.classList.toggle("online", v);
    connLabel.textContent = v ? "Online" : "Offline";
  }
  async function checkConnectivity() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch("/api/admin/session", { cache: "no-store", signal: ctrl.signal });
      clearTimeout(t);
      setConnected(res.ok);
      if (res.ok) flushQueue();
    } catch {
      setConnected(false);
    }
  }
  window.addEventListener("online", checkConnectivity);
  window.addEventListener("offline", () => setConnected(false));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkConnectivity(); });
  setInterval(checkConnectivity, 20000);
  checkConnectivity();

  // ---------- camera ----------
  const cameraStage = document.getElementById("cameraStage");
  const camVideo = document.getElementById("camVideo");
  const camHint = document.getElementById("camHint");
  const captureBtn = document.getElementById("captureBtn");
  const cancelCamBtn = document.getElementById("cancelCamBtn");
  const hiddenCanvas = document.getElementById("hiddenCanvas");

  let stream = null;
  let formSnapshot = null;

  async function openCamera() {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
    camVideo.srcObject = stream;
    await camVideo.play();
  }
  function closeCamera() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    camVideo.srcObject = null;
  }

  document.getElementById("fForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    formSnapshot = {
      facultyName: document.getElementById("fName").value.trim(),
      campus: document.getElementById("fCampus").value.trim(),
      batch: document.getElementById("fBatch").value.trim(),
      className: document.getElementById("fClass").value.trim(),
      subject: document.getElementById("fSubject").value.trim(),
      checkinTime: new Date().toISOString(),
    };
    for (const id of fieldIds) localStorage.setItem("fa_" + id, document.getElementById(id).value.trim());

    cameraStage.hidden = false;
    camHint.textContent = "Take a photo of the classroom to confirm you're here";
    try {
      await openCamera();
    } catch {
      camHint.textContent = "Couldn't access the camera. Check camera permission for this site and try again.";
    }
  });

  cancelCamBtn.addEventListener("click", () => {
    formSnapshot = null;
    closeCamera();
    cameraStage.hidden = true;
  });

  captureBtn.addEventListener("click", () => {
    if (!formSnapshot) return;
    const photoCaptureTime = new Date().toISOString();
    const ctx = hiddenCanvas.getContext("2d");
    const maxW = 720;
    const scale = Math.min(1, maxW / camVideo.videoWidth);
    const w = Math.round(camVideo.videoWidth * scale);
    const h = Math.round(camVideo.videoHeight * scale);
    hiddenCanvas.width = w;
    hiddenCanvas.height = h;
    ctx.drawImage(camVideo, 0, 0, w, h);
    const photoDataUrl = hiddenCanvas.toDataURL("image/jpeg", 0.72);

    const snapshot = formSnapshot;
    formSnapshot = null;
    closeCamera();
    cameraStage.hidden = true;
    saveAndSync(snapshot, photoCaptureTime, photoDataUrl);
  });

  async function saveAndSync(snapshot, photoCaptureTime, photoDataUrl) {
    const record = {
      clientUuid: crypto.randomUUID(),
      ...snapshot,
      photoCaptureTime,
      photoDataUrl,
      status: "pending",
      syncTime: null,
    };
    await putRecord(record);
    renderLog();
    trySync(record);
  }

  // ---------- sync ----------
  const syncing = new Set();
  async function trySync(record) {
    if (record.status === "synced" || syncing.has(record.clientUuid) || !isConnected) return;
    syncing.add(record.clientUuid);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientUuid: record.clientUuid,
          facultyName: record.facultyName,
          campus: record.campus,
          batch: record.batch,
          className: record.className,
          subject: record.subject,
          checkinTime: record.checkinTime,
          photoCaptureTime: record.photoCaptureTime,
          photoDataUrl: record.photoDataUrl,
        }),
      });
      if (!res.ok) throw new Error("sync_failed");
      const data = await res.json();
      record.status = "synced";
      record.syncTime = data.syncTime || new Date().toISOString();
      await putRecord(record);
      renderLog();
    } catch {
      // stays pending, retried by flushQueue
    } finally {
      syncing.delete(record.clientUuid);
    }
  }
  async function flushQueue() {
    if (!isConnected) return;
    const all = await getAllRecords();
    for (const r of all) if (r.status !== "synced") await trySync(r);
  }

  // ---------- log ----------
  const logList = document.getElementById("logList");
  const emptyLog = document.getElementById("emptyLog");

  async function renderLog() {
    const all = await getAllRecords();
    const todayKey = new Date().toDateString();
    const todays = all
      .filter((r) => new Date(r.checkinTime).toDateString() === todayKey)
      .sort((a, b) => new Date(b.checkinTime) - new Date(a.checkinTime));

    logList.innerHTML = "";
    emptyLog.hidden = todays.length > 0;

    for (const r of todays) {
      const li = document.createElement("li");
      const chipClass = r.status === "synced" ? "synced" : "pending";
      const chipText = r.status === "synced" ? "Synced " + formatTime(r.syncTime) : "Pending sync";
      li.innerHTML =
        '<img class="thumb" src="' + r.photoDataUrl + '" alt="" />' +
        '<div class="info"><div class="who">' + escapeHtml(r.subject) + " · " + escapeHtml(r.className) + '</div>' +
        '<div class="sub">' + escapeHtml(r.campus) + " · " + escapeHtml(r.batch) + " · " + formatTime(r.checkinTime) + "</div></div>" +
        '<div class="chip ' + chipClass + '"><span class="dot"></span>' + chipText + "</div>";
      logList.appendChild(li);
    }
  }

  function formatTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : s;
    return d.innerHTML;
  }

  renderLog();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
})();
