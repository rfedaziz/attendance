(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const KEY_ME = "att_me", KEY_REC = "att_records";

  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
  }
  function latin(t) { return String(t).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6F0); }
  function msg(el, text, kind) { el.textContent = text; el.className = "msg show " + kind; }
  function fmt(t) {
    const d = new Date(t);
    return d.toLocaleDateString("ar-IQ", { month: "short", day: "numeric" }) + " " +
           d.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
  }

  async function post(body) {
    if (!window.SERVER_URL || SERVER_URL.indexOf("http") !== 0) throw new Error("لم يُضبط رابط الخادم في config.js");
    let res;
    try {
      res = await fetch(SERVER_URL, { method: "POST", body: JSON.stringify(body) }); // text/plain: no CORS preflight
    } catch (e) {
      throw new Error("ما وصل الطلب للخادم. تأكد من الإنترنت، ومن أن رابط الخادم صحيح وأن النشر بصلاحية Anyone.");
    }
    try { return await res.json(); }
    catch (e) { throw new Error("الخادم ردّ بشي غير متوقع. تأكد أن الرابط ينتهي بـ /exec وأن النشر بصلاحية Anyone."); }
  }

  // ---------- التسجيل ----------
  $("regBtn").onclick = async () => {
    const name = $("name").value.trim(), sno = latin($("sno").value.trim());
    if (name.split(/\s+/).length < 2) return msg($("regMsg"), "اكتب اسمك الكامل.", "err");
    if (!sno) return msg($("regMsg"), "اكتب رقمك الجامعي.", "err");
    if (!navigator.onLine) return msg($("regMsg"), "التسجيل يحتاج إنترنت أول مرة فقط.", "err");
    const deviceId = (load(KEY_ME, {}).deviceId) || uid();
    save(KEY_ME, { deviceId: deviceId, pending: true });
    $("regBtn").disabled = true; msg($("regMsg"), "جارٍ التسجيل…", "info");
    try {
      const r = await post({ action: "register", name: name, studentNo: sno, deviceId: deviceId });
      if (!r.ok) throw new Error(r.error);
      save(KEY_ME, { deviceId: deviceId, name: r.name, studentNo: sno });
      show();
    } catch (e) {
      msg($("regMsg"), "تعذّر التسجيل: " + e.message, "err");
    } finally { $("regBtn").disabled = false; }
  };

  // ---------- الشاشة الرئيسية ----------
  function render() {
    const me = load(KEY_ME, {});
    const recs = load(KEY_REC, []);
    $("hello").textContent = "أهلاً " + me.name.split(" ")[0];
    $("who").textContent = me.name + " · " + me.studentNo;
    $("net").textContent = navigator.onLine ? "🟢 متصل" : "⚪ بدون إنترنت";
    const pend = recs.filter(r => r.status === "pending").length;
    $("pendCount").textContent = pend ? pend + " بانتظار الإرسال" : "";
    $("syncBtn").style.display = pend ? "" : "none";
    const st = {
      pending: ["⏳ بانتظار الإرسال", "st-pend"],
      ok: ["✓ وصل للأستاذ", "st-ok"],
      duplicate: ["✓ مسجّل مسبقاً", "st-ok"],
      invalid: ["✗ رمز غير صالح", "st-bad"]
    };
    $("list").innerHTML = recs.length ? "" : '<li class="muted">لا يوجد حضور بعد.</li>';
    recs.slice().reverse().slice(0, 40).forEach(r => {
      const li = document.createElement("li");
      const a = document.createElement("span"); a.textContent = r.label + " — " + fmt(r.scannedAt);
      const b = document.createElement("span"); b.textContent = st[r.status][0]; b.className = st[r.status][1];
      li.append(a, b); $("list").appendChild(li);
    });
  }

  let syncing = false;
  async function sync(manual) {
    const me = load(KEY_ME, {});
    const pend = load(KEY_REC, []).filter(r => r.status === "pending");
    if (!pend.length || syncing) return;
    if (!navigator.onLine) { if (manual) msg($("mainMsg"), "لا يوجد إنترنت. سيُرسل الحضور تلقائياً عند الاتصال.", "info"); return; }
    syncing = true;
    try {
      const r = await post({ action: "attend", deviceId: me.deviceId, studentNo: me.studentNo,
                             records: pend.map(p => ({ id: p.id, qr: p.qr, scannedAt: p.scannedAt })) });
      if (!r.ok) throw new Error(r.error);
      const recs = load(KEY_REC, []);
      r.results.forEach(x => { const t = recs.find(y => y.id === x.id); if (t) t.status = x.status; });
      save(KEY_REC, recs);
      const okN = r.results.filter(x => x.status === "ok").length;
      if (okN) msg($("mainMsg"), "✓ تم إرسال " + okN + " حضور إلى الأستاذ.", "ok");
    } catch (e) {
      if (manual) msg($("mainMsg"), "تعذّر الإرسال: " + e.message, "err");
    } finally { syncing = false; render(); }
  }

  // ---------- الماسح ----------
  let stream = null, raf = 0;
  const video = $("video"), canvas = $("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });

  async function openScanner() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch (e) {
      return msg($("mainMsg"), "لا يمكن فتح الكاميرا. اسمح للتطبيق باستخدام الكاميرا من إعدادات التلفون.", "err");
    }
    video.srcObject = stream; await video.play();
    $("scanner").classList.add("on");
    tick();
  }
  function closeScanner() {
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; $("scanner").classList.remove("on");
  }
  function tick() {
    if (!stream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const s = Math.min(video.videoWidth, video.videoHeight, 720);
      const sx = (video.videoWidth - s) / 2, sy = (video.videoHeight - s) / 2;
      canvas.width = s; canvas.height = s;
      ctx.drawImage(video, sx, sy, s, s, 0, 0, s, s);
      const img = ctx.getImageData(0, 0, s, s);
      const code = jsQR(img.data, s, s, { inversionAttempts: "dontInvert" });
      if (code && code.data) { if (handle(code.data)) return; }
    }
    raf = requestAnimationFrame(tick);
  }

  function handle(text) {
    const p = text.split(".");
    if (p.length !== 5 || p[0] !== "A1") return false; // not our code, keep scanning
    closeScanner();
    let label = p[2];
    try {
      const b = atob(p[2].replace(/-/g, "+").replace(/_/g, "/"));
      label = new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0)));
    } catch (e) {}
    const recs = load(KEY_REC, []);
    if (recs.some(r => r.lid === p[1] && r.status !== "invalid")) {
      msg($("mainMsg"), "حضورك في «" + label + "» مسجّل مسبقاً.", "info"); return true;
    }
    recs.push({ id: uid(), qr: text, lid: p[1], label: label, slot: Number(p[3]), scannedAt: Date.now(), status: "pending" });
    save(KEY_REC, recs);
    if (navigator.vibrate) navigator.vibrate(150);
    msg($("mainMsg"), "✓ تم تسجيل حضورك في «" + label + "». سيصل للأستاذ عند اتصالك بالإنترنت.", "ok");
    render(); sync(false);
    return true;
  }

  $("scanBtn").onclick = openScanner;
  $("closeScan").onclick = closeScanner;
  $("syncBtn").onclick = () => sync(true);
  window.addEventListener("online", () => { render(); sync(false); });
  window.addEventListener("offline", render);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { render(); sync(false); } });

  function show() {
    const me = load(KEY_ME, {});
    const reg = !!(me.name && me.studentNo && me.deviceId);
    $("regView").style.display = reg ? "none" : "";
    $("mainView").style.display = reg ? "" : "none";
    if (reg) { render(); sync(false); }
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  show();
})();
