// Manual lookup (view only). Fetches a consignee record and shows it.
// Saving into the ERP happens from the order page's own "تحديث من بوسطة" button.

const phoneEl = document.getElementById("phone");
const goEl = document.getElementById("go");
const outEl = document.getElementById("out");

const ERRORS = {
  NO_BOSTA_LOGIN: "مش مسجّل دخول على بوسطة. افتح business.bosta.co وسجّل دخول.",
  BOSTA_UNAUTHORIZED: "بوسطة رفضت الطلب (401). افتح الداشبورد وسجّل دخول من جديد.",
  NO_BOSTA_TAB: "مفيش تابة بوسطة مفتوحة وماقدرناش نفتح واحدة.",
  BOSTA_TAB_NOT_READY: "تابة بوسطة لسه بتحمّل. جرّب تاني بعد ثانية.",
  PHONE_REQUIRED: "اكتب رقم الموبايل الأول.",
};

function msg(err) {
  return ERRORS[err] || (err && err.startsWith("BOSTA_HTTP_") ? `بوسطة ردّت بكود ${err.slice(11)}.` : "حصل خطأ غير متوقع.");
}

function render(data) {
  const pct = data.success_rate == null ? "—" : `${data.success_rate}%`;
  const cls = data.success_rate != null && data.success_rate < 70 ? "bad" : "ok";
  outEl.innerHTML = `
    <div class="card">
      <div style="font-weight:800">${data.full_name || "عميل بوسطة"}</div>
      <div class="muted">${data.phone || ""}</div>
      <div class="grid">
        <div class="stat"><div class="big ok">${data.delivered ?? "—"}</div><div class="muted">اتسلّم</div></div>
        <div class="stat"><div class="big bad">${data.returned ?? "—"}</div><div class="muted">رجع</div></div>
        <div class="stat"><div class="big ${cls}">${pct}</div><div class="muted">نسبة الاستلام</div></div>
        <div class="stat"><div class="big">${data.consecutive_returned ?? "—"}</div><div class="muted">مرتجع ورا بعض</div></div>
      </div>
    </div>`;
}

async function run() {
  const phone = phoneEl.value.trim();
  if (!phone) { outEl.innerHTML = `<div class="err">${msg("PHONE_REQUIRED")}</div>`; return; }
  goEl.disabled = true;
  outEl.innerHTML = `<div class="muted">بنجيب السجل من بوسطة…</div>`;
  try {
    const res = await chrome.runtime.sendMessage({ type: "FETCH_BOSTA", phone });
    if (res && res.ok) render(res.data);
    else outEl.innerHTML = `<div class="err">${msg(res && res.error)}</div>`;
  } catch (e) {
    outEl.innerHTML = `<div class="err">حصل خطأ: ${String(e.message || e)}</div>`;
  } finally {
    goEl.disabled = false;
  }
}

goEl.addEventListener("click", run);
phoneEl.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
phoneEl.focus();
