// Firebase + Barcode Scanner — مستر أحمد قطب
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, collection, collectionGroup, query, where, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAjzlzfwN-P2HJz4t9-mGj8g389aAGowJ8",
  authDomain: "ahmed-kotb-d4c57.firebaseapp.com",
  projectId: "ahmed-kotb-d4c57",
  storageBucket: "ahmed-kotb-d4c57.firebasestorage.app",
  messagingSenderId: "780749321595",
  appId: "1:780749321595:web:5dc2ace6c9a7b6107339de",
  measurementId: "G-VY0632SG7W"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// عناصر الصفحة
const $ = (id) => document.getElementById(id);
const openBtn = $("openScannerBtn"), scannerWrap = $("scannerWrap"),
  closeBtn = $("closeScannerBtn"), stopBtn = $("stopBtn"),
  statusEl = $("scanStatus"), resultWrap = $("resultWrap"),
  resEmail = $("resEmail"), resPass = $("resPass"), resCode = $("resCode"),
  resError = $("resError"), resTitle = $("resTitle"),
  loader = $("loader"), credsBox = $("credsBox"),
  manualCode = $("manualCode"), manualBtn = $("manualBtn");

let html5QrCode = null;
let scanning = false;
let passHidden = true;
let lastPass = "";
let lastEmail = "";
let lastName = "";

// هيكل الداتابيز: Teachers/{teacherId}/groups/{groupId}/students/{studentCode}
// كود الطالب نفسه مشفّر فيه المدرس والجروب:
// - 8 أرقام → teacherId = أول رقمين + groupId = الرقمين اللي بعدهم
// - 7 أرقام → teacherId = أول رقم + groupId = الرقمين اللي بعده
// - بنسرش بكود الطالب كامل كـ document ID
function parseCode(code) {
  const digits = String(code || "").replace(/\D/g, "");
  if (digits.length === 8) {
    return { teacherId: digits.slice(0, 2), groupId: digits.slice(2, 4), studentCode: digits };
  }
  if (digits.length === 7) {
    return { teacherId: digits.slice(0, 1), groupId: digits.slice(1, 3), studentCode: digits };
  }
  return null;
}

// بدائل الـ ID (عشان لو متخزن من غير الصفر اللي على الشمال، مثلا "03" vs "3")
function idVariants(id) {
  const out = [id];
  const n = String(Number(id));
  if (n && n !== "NaN" && !out.includes(n)) out.push(n);
  return out;
}

function pickCreds(d) {
  const email = d.email || d.mail || d.Email || "";
  const password = d.password || d.pass || d.Password || "";
  const name = d.name || d.studentName || d.fullName || d.username || "";
  return { email, password, name };
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function showResult({ code, email, password, name, error }) {
  resultWrap.classList.remove("hidden");
  loader.classList.add("hidden");
  resCode.textContent = "كود: " + (code || "—");
  if (error) {
    resTitle.textContent = "الكود مش متسجل 😕";
    credsBox.style.display = "none";
    resError.textContent = error;
    resError.classList.remove("hidden");
  } else {
    resTitle.textContent = name ? `أهلاً ${name}! 🎉` : "تم العثور على حسابك! 🎉";
    credsBox.style.display = "block";
    resError.classList.add("hidden");
    lastPass = password || "";
    lastEmail = email || "";
    lastName = name || "";
    passHidden = true;
    // الدوكيومنت ممكن مفيهوش email (زي مثال الطالب abdallah) — نخفي صف الإيميل لو فاضي
    $("emailRow").style.display = email ? "block" : "none";
    resEmail.textContent = email || "—";
    resPass.textContent = "••••••••";
    $("togglePass").textContent = "إظهار";
  }
  resultWrap.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showLoading(code) {
  resultWrap.classList.remove("hidden");
  loader.classList.remove("hidden");
  credsBox.style.display = "none";
  resError.classList.add("hidden");
  resTitle.textContent = "بنبحث عن الكود...";
  resCode.textContent = "كود: " + code;
  resultWrap.scrollIntoView({ behavior: "smooth", block: "center" });
}

// البحث في Firestore عن الطالب: Teachers/{teacherId}/groups/{groupId}/students/{code}
async function findAccount(rawCode) {
  const code = String(rawCode || "").trim();
  if (!code) throw new Error("الكود فاضي");

  const parsed = parseCode(code);
  if (!parsed) {
    throw new Error("الكود لازم يكون 7 أو 8 أرقام (اللي اتمسح: " + code + ")");
  }
  const { teacherId, groupId, studentCode } = parsed;
  const docIds = [...new Set([code, studentCode])];

  // 1) المسار المباشر بكذا variant (حساسية الحروف + الصفر الشمالي)
  // المسار الأساسي (مثال حقيقي): teachers/99/groups/01/students/99010001
  const teacherCols = ["teachers", "Teachers"];
  for (const tCol of teacherCols) {
    for (const tId of idVariants(teacherId)) {
      for (const gId of idVariants(groupId)) {
        for (const sId of docIds) {
          try {
            const ref = doc(db, tCol, tId, "groups", gId, "students", sId);
            const snap = await getDoc(ref);
            if (snap.exists()) {
              const c = pickCreds(snap.data());
              if (c.email || c.password) return { code: studentCode, email: c.email, password: c.password, name: c.name };
            }
          } catch (e) { /* كمّل */ }
        }
      }
    }
  }

  // 2) collectionGroup: دوّر على أي students في أي جروب بكود الطالب كامل
  const CODE_FIELDS = ["code", "studentCode", "barcode", "id"];
  for (const f of CODE_FIELDS) {
    for (const val of docIds) {
      try {
        const q = query(collectionGroup(db, "students"), where(f, "==", val));
        const qs = await getDocs(q);
        if (!qs.empty) {
          const c = pickCreds(qs.docs[0].data());
          if (c.email || c.password) return { code: studentCode, email: c.email, password: c.password, name: c.name };
        }
      } catch (e) { /* كمّل */ }
    }
  }

  // 3) fallback قديم: collection اسمها barcodes والـ ID = الكود
  try {
    const snap = await getDoc(doc(db, "barcodes", code));
    if (snap.exists()) {
      const c = pickCreds(snap.data());
      if (c.email || c.password) return { code: studentCode, email: c.email, password: c.password, name: c.name };
    }
  } catch (e) { /* كمّل */ }

  return null;
}

async function handleCode(code) {
  await stopScanner();
  showLoading(code);
  try {
    const acc = await findAccount(code);
    if (acc && (acc.email || acc.password)) {
      showResult(acc);
      toast("تم جلب حسابك بنجاح ✅");
    } else {
      showResult({ code, error: "الكود ده (" + code + ") مش لاقيينه في Teachers/{teacherId}/groups/{groupId}/students. اتأكد إن الـ teacherId والـ groupId مستخرجين صح من الكود وإن دوكيومنت الطالب معمول بالكود الكامل." });
    }
  } catch (err) {
    console.error(err);
    showResult({ code, error: "حصل خطأ أثناء الجلب: " + err.message });
  }
}

// ---- السكانر ----
async function startScanner() {
  scannerWrap.classList.remove("hidden");
  resultWrap.classList.add("hidden");
  scannerWrap.scrollIntoView({ behavior: "smooth", block: "center" });

  if (typeof Html5Qrcode === "undefined") {
    statusEl.textContent = "❌ مكتبة السكانر لم تُحمّل. اتأكد من الإنترنت وحدّث الصفحة.";
    return;
  }
  if (scanning) return;
  try {
    html5QrCode = new Html5Qrcode("reader");
    scanning = true;
    statusEl.textContent = "📸 الكاميرا شغالة... وجّهها على الباركود";
    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 160 } },
      (decodedText) => {
        if (!decodedText) return;
        statusEl.textContent = "✅ اتلقط الكود: " + decodedText;
        handleCode(decodedText);
      },
      () => { /* تجاهل فريمات فاضية */ }
    );
  } catch (err) {
    console.error(err);
    scanning = false;
    statusEl.textContent = "❌ مش قادر أشغّل الكاميرا: " + err.message + " — جرب من HTTPS أو Allow الكاميرا، أو دخل الكود يدوي تحت.";
  }
}

async function stopScanner() {
  if (html5QrCode && scanning) {
    try { await html5QrCode.stop(); await html5QrCode.clear(); }
    catch (e) { console.warn(e); }
  }
  scanning = false;
  scannerWrap.classList.add("hidden");
  statusEl.textContent = "جاري تشغيل الكاميرا...";
}

openBtn.addEventListener("click", startScanner);
closeBtn.addEventListener("click", stopScanner);
stopBtn.addEventListener("click", stopScanner);
$("scanAgainBtn").addEventListener("click", () => {
  resultWrap.classList.add("hidden");
  startScanner();
});

manualBtn.addEventListener("click", () => {
  const v = manualCode.value.trim();
  if (!v) return toast("اكتب الكود الأول ✍️");
  handleCode(v);
});
manualCode.addEventListener("keydown", (e) => {
  if (e.key === "Enter") manualBtn.click();
});

// نسخ
document.querySelectorAll(".copy[data-copy]").forEach(btn => {
  btn.addEventListener("click", async () => {
    let val = $(btn.dataset.copy).textContent;
    if (btn.dataset.copy === "resPass" && passHidden) val = lastPass;
    try { await navigator.clipboard.writeText(val); toast("اتنسخ ✅"); }
    catch { toast("انسخ يدوي: " + val); }
  });
});
$("copyAllBtn").addEventListener("click", async () => {
  const lines = [];
  if (lastName) lines.push(`Name: ${lastName}`);
  if (resCode) lines.push(resCode.textContent);
  if (lastEmail) lines.push(`Email: ${lastEmail}`);
  lines.push(`Password: ${lastPass}`);
  const txt = lines.join("\n");
  try { await navigator.clipboard.writeText(txt); toast("اتنسخ ✅"); }
  catch { toast(txt); }
});
$("togglePass").addEventListener("click", (e) => {
  passHidden = !passHidden;
  resPass.textContent = passHidden ? "••••••••" : lastPass;
  e.target.textContent = passHidden ? "إظهار" : "إخفاء";
});
