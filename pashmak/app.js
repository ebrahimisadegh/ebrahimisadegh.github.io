/* Safar: Farsi Road Trip. Plain JS, no build step. Open index.html in Chrome. */
(function () {
"use strict";
const LESSONS = window.LESSONS;
const $app = document.getElementById("app");
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.random() * a.length | 0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, "0");

/* ---------------- storage ---------------- */
const LS_KEY = "safar-farsi-v1";
let S = { lessons: {}, xp: 0, streak: 0, lastDay: null, settings: { name: "", translit: true, recognition: true, familyVoice: true } };
try { const raw = localStorage.getItem(LS_KEY); if (raw) { const o = JSON.parse(raw); S = Object.assign(S, o); S.settings = Object.assign({ name: "", translit: true, recognition: true, familyVoice: true }, o.settings || {}); } } catch (e) {}
const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} };
function bumpStreak() {
  const today = new Date().toDateString();
  if (S.lastDay === today) return;
  const y = new Date(Date.now() - 864e5).toDateString();
  S.streak = S.lastDay === y ? S.streak + 1 : 1;
  S.lastDay = today; save();
}

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open("safar-farsi", 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("exams", { keyPath: "id" }); d.createObjectStore("blobs"); d.createObjectStore("kv"); d.createObjectStore("voices"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}
async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction(store, mode); const st = tx.objectStore(store); const r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); });
}
const idbGet = (s, k) => idb(s, "readonly", st => st.get(k)).catch(() => undefined);
const idbPut = (s, v, k) => idb(s, "readwrite", st => k === undefined ? st.put(v) : st.put(v, k));
const idbDel = (s, k) => idb(s, "readwrite", st => st.delete(k));
const idbAll = s => idb(s, "readonly", st => st.getAll()).catch(() => []);
const idbKeys = s => idb(s, "readonly", st => st.getAllKeys()).catch(() => []);

/* ---------------- results folder (File System Access API) ---------------- */
const FS = {
  supported: "showDirectoryPicker" in window,
  handle: null,
  async load() { try { this.handle = (await idbGet("kv", "dir")) || null; } catch (e) {} },
  async choose() {
    const hnd = await window.showDirectoryPicker({ id: "farsi-lessons", mode: "readwrite", startIn: "documents" });
    this.handle = hnd; await idbPut("kv", hnd, "dir"); return hnd;
  },
  async ready(ask) {
    if (!this.handle) return false;
    try {
      let p = await this.handle.queryPermission({ mode: "readwrite" });
      if (p !== "granted" && ask) p = await this.handle.requestPermission({ mode: "readwrite" });
      return p === "granted";
    } catch (e) { return false; }
  },
  async dir(path) {
    let d = this.handle;
    for (const part of path.split("/").filter(Boolean)) d = await d.getDirectoryHandle(part, { create: true });
    return d;
  },
  async write(path, data) {
    const parts = path.split("/"); const name = parts.pop();
    const d = await this.dir(parts.join("/"));
    const f = await d.getFileHandle(name, { create: true });
    const w = await f.createWritable(); await w.write(data); await w.close();
  }
};

/* ---------------- audio ---------------- */
window.AUDIO = window.AUDIO || {};
const loaded = {};
function loadAudio(n) {
  if (loaded[n]) return loaded[n];
  loaded[n] = new Promise((res) => {
    const s = document.createElement("script");
    s.src = "audio/L" + pad(n) + ".js";
    s.onload = () => res(true); s.onerror = () => res(false);
    document.head.append(s);
  });
  return loaded[n];
}
const familyVoices = {};
async function loadFamilyVoices() {
  try { const keys = await idbKeys("voices"); for (const k of keys) familyVoices[k] = true; } catch (e) {}
}
let player = new Audio();
let playToken = 0;
async function play(key, opts = {}) {
  if (!key) return;
  const tok = ++playToken;
  player.pause();
  let src = window.AUDIO[key];
  if (S.settings.familyVoice && familyVoices[key] && !opts.robot) {
    const b = await idbGet("voices", key); if (b) src = URL.createObjectURL(b);
  }
  if (!src) return;
  if (tok !== playToken) return;
  player = new Audio(src);
  player.playbackRate = opts.rate || 1;
  return new Promise(res => { player.onended = res; player.onerror = res; player.play().catch(res); });
}
function stopAudio() { playToken++; player.pause(); }
function playBlob(blob) { stopAudio(); player = new Audio(URL.createObjectURL(blob)); return new Promise(res => { player.onended = res; player.onerror = res; player.play().catch(res); }); }

/* little game sounds */
let actx = null;
function beep(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === "good" ? [660, 880, 1320] : kind === "bad" ? [300, 220] : kind === "win" ? [523, 659, 784, 1046, 1318] : [500];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === "bad" ? "sawtooth" : "triangle"; o.frequency.value = f;
      const t = actx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch (e) {}
}

/* ---------------- microphone + recorder ---------------- */
let micStream = null;
async function getMic() {
  if (micStream && micStream.active) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  return micStream;
}
function bestMime() {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const m of c) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}
const extFor = m => m.includes("ogg") ? "ogg" : m.includes("mp4") ? "m4a" : "webm";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let srBroken = false;

/* Recorder widget: a mic button + level meter. onDone({blob, mime, duration, heard}) */
function Recorder({ maxSec = 20, onDone, label = "Tap to record", listen = true }) {
  const meter = h("div", { class: "meter" }, Array.from({ length: 18 }, () => h("i")));
  const status = h("div", { class: "muted", style: "font-weight:800" }, label);
  const btn = h("button", { class: "mic", "aria-label": "Record", html: ICON.mic });
  let rec = null, chunks = [], t0 = 0, raf = 0, timer = 0, recog = null, heard = "", an = null, srcNode = null;
  async function start() {
    stopAudio();
    let stream;
    try { stream = await getMic(); } catch (e) { toast("I can't hear you! Allow the microphone (click the icon in the address bar), then try again."); return; }
    const mime = bestMime();
    chunks = []; heard = "";
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
      const duration = (performance.now() - t0) / 1000;
      const finish = () => onDone && onDone({ blob, mime: blob.type, duration: Math.round(duration * 10) / 10, heard: heard.trim() });
      if (recog) { const r = recog; recog = null; let done = false; r.onend = () => { if (!done) { done = true; finish(); } }; try { r.stop(); } catch (e) {} setTimeout(() => { if (!done) { done = true; finish(); } }, 1600); }
      else finish();
    };
    rec.start(250); t0 = performance.now();
    btn.classList.add("rec"); btn.innerHTML = ICON.stop; status.textContent = "Recording... tap to stop";
    // level meter
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      srcNode = actx.createMediaStreamSource(stream); an = actx.createAnalyser(); an.fftSize = 64; srcNode.connect(an);
      const data = new Uint8Array(an.frequencyBinCount); const bars = meter.children;
      const loop = () => { an.getByteFrequencyData(data); for (let i = 0; i < bars.length; i++) bars[i].style.height = (4 + data[i + 2] / 255 * 36) + "px"; raf = requestAnimationFrame(loop); };
      loop();
    } catch (e) {}
    // speech recognition (rough pronunciation check, Chrome only, needs internet)
    if (listen && SR && S.settings.recognition && !srBroken) {
      try {
        recog = new SR(); recog.lang = "fa-IR"; recog.continuous = true; recog.interimResults = false;
        recog.onresult = e => { heard = Array.from(e.results).map(r => r[0].transcript).join(" "); };
        recog.onerror = e => { if (e.error === "network" || e.error === "not-allowed" || e.error === "service-not-allowed") srBroken = true; };
        recog.start();
      } catch (e) { recog = null; }
    }
    timer = setTimeout(stop, maxSec * 1000);
  }
  function stop() {
    clearTimeout(timer); cancelAnimationFrame(raf);
    try { srcNode && srcNode.disconnect(); } catch (e) {}
    for (const b of meter.children) b.style.height = "4px";
    btn.classList.remove("rec"); btn.innerHTML = ICON.mic; status.textContent = label;
    if (rec && rec.state !== "inactive") rec.stop();
  }
  btn.addEventListener("click", () => (rec && rec.state === "recording") ? stop() : start());
  const el = h("div", { style: "display:flex;flex-direction:column;align-items:center;gap:8px" }, btn, meter, status);
  el.stop = stop;
  return el;
}

/* compare what Chrome heard with what we expected */
function normFa(s) {
  return (s || "").replace(/[ً-ْٰ]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌‏‎]/g, "")
    .replace(/[^؀-ۿ\s]/g, "").replace(/[،؟؛]/g, "").replace(/\s+/g, "");
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function matchScore(heard, expected) {
  const H = normFa(heard); if (!H) return null;
  let best = 0;
  for (const alt of expected.split("/")) { const E = normFa(alt.replace(/…|\(.*?\)/g, "")); if (!E) continue; best = Math.max(best, 1 - lev(H, E) / Math.max(H.length, E.length)); }
  return Math.round(best * 100) / 100;
}
function heardBox(heard, expected) {
  if (!heard) return null;
  const sc = matchScore(heard, expected);
  const cls = sc >= 0.75 ? "good" : sc >= 0.45 ? "mid" : "low";
  const msg = sc >= 0.75 ? "Pashmak understood you!" : sc >= 0.45 ? "Close! Pashmak almost got it." : "Hmm, Pashmak heard something different.";
  return h("div", { class: "heard " + cls }, msg + " ", h("span", { class: "muted" }, "Heard: "), h("span", { class: "fa" }, heard));
}

/* ---------------- icons + mascot ---------------- */
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="#1a1d3a"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3" fill="#fff"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="#fff"/></svg>',
};
function mascot(mood = "happy", cls = "") {
  const eyes = mood === "wow"
    ? '<circle cx="78" cy="98" r="11" fill="#1a1d3a"/><circle cx="122" cy="98" r="11" fill="#1a1d3a"/><circle cx="82" cy="94" r="4" fill="#fff"/><circle cx="126" cy="94" r="4" fill="#fff"/>'
    : mood === "think"
    ? '<path d="M66 100q12-9 24 0M110 100q12-9 24 0" stroke="#1a1d3a" stroke-width="5" fill="none" stroke-linecap="round"/>'
    : '<ellipse cx="78" cy="98" rx="10" ry="12" fill="#f3a51b"/><ellipse cx="122" cy="98" rx="10" ry="12" fill="#f3a51b"/><ellipse cx="78" cy="99" rx="4" ry="9" fill="#1a1d3a"/><ellipse cx="122" cy="99" rx="4" ry="9" fill="#1a1d3a"/><circle cx="81" cy="93" r="2.5" fill="#fff"/><circle cx="125" cy="93" r="2.5" fill="#fff"/>';
  const mouth = mood === "wow" ? '<ellipse cx="100" cy="128" rx="7" ry="9" fill="#d6304a"/>' : '<path d="M88 124q6 7 12 0q6 7 12 0" stroke="#1a1d3a" stroke-width="3.5" fill="none" stroke-linecap="round"/>';
  let fluff = ""; for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; fluff += `<circle cx="${100 + Math.cos(a) * 58}" cy="${105 + Math.sin(a) * 50}" r="17" fill="#f7f4ff" stroke="#1a1d3a" stroke-width="3"/>`; }
  return `<svg class="mascot ${cls}" viewBox="0 0 200 200" role="img" aria-label="Pashmak the cat">
  <path d="M52 70L48 18l42 30z" fill="#f7f4ff" stroke="#1a1d3a" stroke-width="3.5" stroke-linejoin="round"/><path d="M58 60l-2-28 22 17z" fill="#f7b3c2"/>
  <path d="M148 70l4-52-42 30z" fill="#f7f4ff" stroke="#1a1d3a" stroke-width="3.5" stroke-linejoin="round"/><path d="M142 60l2-28-22 17z" fill="#f7b3c2"/>
  ${fluff}<ellipse cx="100" cy="105" rx="60" ry="52" fill="#f7f4ff"/>
  ${eyes}<path d="M94 114h12l-6 7z" fill="#e3768f"/>${mouth}
  <g stroke="#1a1d3a" stroke-width="2.5" stroke-linecap="round"><path d="M60 116l-26-4M60 122l-25 6M140 116l26-4M140 122l25 6"/></g>
  <circle cx="64" cy="118" r="7" fill="#f7b3c2" opacity=".7"/><circle cx="136" cy="118" r="7" fill="#f7b3c2" opacity=".7"/>
  <path d="M46 150q54 26 108 0l4 16q-58 26-116 0z" fill="#13a39c" stroke="#1a1d3a" stroke-width="3.5" stroke-linejoin="round"/>
  <circle cx="100" cy="166" r="7" fill="#f3a51b" stroke="#1a1d3a" stroke-width="3"/></svg>`;
}
const mascotEl = (mood, cls) => { const d = h("div", { html: mascot(mood, cls) }); return d.firstChild; };
function guide(text, mood = "happy") { return h("div", { class: "guide" }, mascotEl(mood, "bob"), h("div", { class: "bubble" }, text)); }

const PRAISE = ["Afarin! (Bravo!)", "Aali! (Excellent!)", "Damet garm! (You rock!)", "Ey val! (Way to go!)", "Kheyli khoob! (Very good!)", "Mashallah!"];
const OOPS = ["Oops! Pashmak spilled his tea.", "Not quite! Try again next time.", "Close, but no kebab.", "Eh! Next one's yours."];

function toast(msg, ms = 3200) { const t = h("div", { class: "toast", role: "status" }, msg); document.body.append(t); setTimeout(() => t.remove(), ms); }

/* confetti */
function confetti() {
  const c = document.getElementById("confetti"); const x = c.getContext("2d");
  c.width = innerWidth; c.height = innerHeight;
  const cols = ["#13a39c", "#f3a51b", "#d6304a", "#1c3478", "#fff"];
  const P = Array.from({ length: 160 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5, vx: (Math.random() - .5) * 4, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 6, a: Math.random() * 6, c: pick(cols) }));
  let f = 0;
  (function loop() { x.clearRect(0, 0, c.width, c.height); for (const p of P) { p.x += p.vx; p.y += p.vy; p.a += .1; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); x.restore(); } if (++f < 220) requestAnimationFrame(loop); else x.clearRect(0, 0, c.width, c.height); })();
}

/* ---------------- shell ---------------- */
function starsHtml(n) { let s = ""; for (let i = 0; i < 3; i++) s += i < n ? "★" : '<span class="off">★</span>'; return s; }
function header(inner) {
  return h("header", { class: "band" }, h("div", { class: "wrap" }, inner));
}
function topbar() {
  const done = Object.values(S.lessons).filter(l => l.done).length;
  return h("div", { class: "topbar" },
    h("button", { class: "brand", onclick: () => go("home") }, h("span", { class: "fa" }, "سفر"), "Safar"),
    h("div", { class: "spacer" }),
    h("span", { class: "chip" }, "Lessons ", h("b", null, done + "/20")),
    h("span", { class: "chip" }, "XP ", h("b", null, String(S.xp))),
    h("span", { class: "chip" }, "Streak ", h("b", null, S.streak + (S.streak === 1 ? " day" : " days"))),
    h("button", { class: "navbtn", onclick: () => go("results") }, "My recordings"),
    h("button", { class: "navbtn", onclick: () => go("settings") }, "Settings"));
}
let cleanup = null;
function mount(...nodes) {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  stopAudio();
  $app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}
function go(view, arg) {
  if (view === "home") return Home();
  if (view === "lesson") return Lesson(arg);
  if (view === "results") return Results();
  if (view === "settings") return Settings();
  if (view === "voices") return Voices(arg || 1);
}

/* ---------------- home ---------------- */
function nextLesson() { for (const l of LESSONS) if (!(S.lessons[l.n] || {}).done) return l.n; return 20; }
function Home() {
  const nx = nextLesson();
  const greet = S.settings.name ? `Salaam, ${S.settings.name}!` : "Salaam, traveler!";
  const hero = h("div", { class: "hero" }, mascotEl("happy", "bob"),
    h("div", null,
      h("div", { class: "eyebrow", style: "color:var(--saffron)" }, "20 stops · 15-20 minutes each"),
      h("h1", null, greet),
      h("p", null, "I'm Pashmak, your fluffy tour guide across Iran. Each stop teaches you real things to say to taxi drivers, shopkeepers and, most importantly, your new family. Lots of listening, lots of speaking, a little reading."),
      h("div", { class: "row" },
        h("button", { class: "btn saffron", onclick: () => go("lesson", nx) }, (S.lessons[1] || {}).done ? `Continue: Stop ${nx}` : "Start the trip"),
        h("button", { class: "btn ghost", onclick: () => go("results") }, "My recordings"))));
  const done = Object.values(S.lessons).filter(l => l.done).length;
  const stars = Object.values(S.lessons).reduce((a, l) => a + (l.stars || 0), 0);
  const stats = h("div", { class: "stats" },
    h("div", { class: "stat" }, h("div", { class: "v" }, done + "/20"), h("div", { class: "k" }, "Stops done")),
    h("div", { class: "stat" }, h("div", { class: "v" }, String(stars)), h("div", { class: "k" }, "Stars earned")),
    h("div", { class: "stat" }, h("div", { class: "v" }, String(S.xp)), h("div", { class: "k" }, "XP")),
    h("div", { class: "stat" }, h("div", { class: "v" }, String(S.streak)), h("div", { class: "k" }, "Day streak")));
  const road = h("div", { class: "road" });
  const tools = h("div", { class: "tools" },
    h("div", { class: "card tool", onclick: () => go("results") }, h("div", { class: "eyebrow" }, "Exams"), h("h3", null, "My recordings"), h("p", { class: "muted" }, "Every final exam answer is saved with notes, so new lessons can target the tricky bits.")),
    h("div", { class: "card tool", onclick: () => go("voices", nx) }, h("div", { class: "eyebrow" }, "For the family"), h("h3", null, "Record family voices"), h("p", { class: "muted" }, "Sadegh or a relative can re-record any phrase. The app then plays their voice instead of the computer voice.")),
    h("div", { class: "card tool", onclick: () => go("settings") }, h("div", { class: "eyebrow" }, "Setup"), h("h3", null, "Results folder"), h("p", { class: "muted" }, FS.handle ? "Connected. Exams save into your Farsi_lessons folder." : "Choose your Farsi_lessons folder so exam recordings save there automatically.")));
  mount(header(h("div", null, topbar(), hero)), h("main", { class: "wrap" }, stats, h("h2", { style: "margin-top:34px" }, "Your road trip"), road, tools));
  drawRoad(road, nx);
  const onR = () => drawRoad(road, nx); addEventListener("resize", onR); cleanup = () => removeEventListener("resize", onR);
}
function drawRoad(road, nx) {
  road.replaceChildren();
  const W = road.clientWidth || 900; const narrow = W < 560;
  const gapY = narrow ? 150 : 165; const amp = narrow ? W * 0.22 : W * 0.32;
  const pts = LESSONS.map((l, i) => ({ x: W / 2 + Math.sin(i * 1.05) * amp, y: 50 + i * gapY }));
  road.style.height = (pts[pts.length - 1].y + 140) + "px";
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const my = (a.y + b.y) / 2; d += ` C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`; }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "path");
  svg.innerHTML = `<path d="${d}" stroke="#1a1d3a" stroke-width="26" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#4c5178" stroke-width="20" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#f3a51b" stroke-width="3" stroke-dasharray="14 12" fill="none"/>`;
  road.append(svg);
  LESSONS.forEach((l, i) => {
    const st = S.lessons[l.n] || {};
    const cls = "stop" + (st.done ? " done" : "") + (l.n === nx && !st.done ? " next" : "");
    const b = h("button", { class: cls, style: `left:${pts[i].x}px;top:${pts[i].y - 37}px`, onclick: () => go("lesson", l.n), "aria-label": `Stop ${l.n}: ${l.title}` },
      h("div", { class: "disc" }, String(l.n)),
      h("div", { class: "lbl" }, l.title, h("small", null, l.city + " · ", h("span", { class: "fa" }, l.fa)), st.done ? h("div", { class: "stars", html: starsHtml(st.stars || 0) }) : null));
    road.append(b);
  });
}

/* ---------------- lesson ---------------- */
const STEPS = ["Hello", "Learn", "Ear game", "Speak up", "Story", "Read", "Final exam"];
function Lesson(n) {
  const L = LESSONS[n - 1];
  const audioReady = loadAudio(n);
  let step = 0;
  const bar = h("div", { class: "steps" });
  const stepName = h("span", { class: "chip" });
  const stage = h("main", { class: "wrap stage" });
  const lesson = { L, n, audioReady, t0: Date.now(), weak: new Set() };
  function setBar() {
    bar.replaceChildren(...STEPS.map((_, i) => h("i", { class: i < step ? "on" : i === step ? "cur" : "" })));
    stepName.replaceChildren(`${step + 1}/${STEPS.length} · ${STEPS[step]}`);
  }
  function next() { step++; render(); }
  function render() {
    setBar(); stopAudio(); window.scrollTo(0, 0);
    const fns = [StepIntro, StepLearn, StepEar, StepSpeak, StepStory, StepRead, StepExam];
    stage.replaceChildren(fns[step](lesson, next));
  }
  const head = header(h("div", null, topbar(), h("div", { class: "lessonbar", style: "margin-top:16px" },
    h("button", { class: "navbtn", onclick: () => go("home") }, "Exit"), bar, stepName)));
  mount(head, stage);
  // allow jumping between steps with the step bar
  bar.addEventListener("click", e => { const i = Array.from(bar.children).indexOf(e.target); if (i >= 0) { step = i; render(); } });
  render();
}

function title(L, sub) {
  return h("div", { style: "margin-bottom:18px" }, h("div", { class: "eyebrow" }, `Stop ${L.n} · ${L.city} · ${sub}`), h("h2", null, L.title));
}
function trEl(text, cls = "tr") { return S.settings.translit ? h("div", { class: cls }, text) : null; }

function StepIntro(ls, next) {
  const L = ls.L;
  const nLetters = L.script.letters.length;
  return h("div", null,
    title(L, L.place),
    guide(L.quip, "wow"),
    h("div", { class: "card" },
      h("div", { class: "grid2" },
        h("div", null, h("div", { class: "eyebrow" }, "Today's Farsi word"), h("div", { class: "fa", style: "font-size:54px;font-weight:800;color:var(--lapis);text-align:left" }, L.fa)),
        h("div", null, h("div", { class: "eyebrow" }, "On this stop"),
          h("ul", { style: "margin:6px 0 0;padding-left:20px;font-weight:700" },
            h("li", null, `${L.phrases.length} phrases to hear and say`),
            h("li", null, "Two games: Ear game and Speak up"),
            h("li", null, "A mini story: " + L.dialogue.scene),
            h("li", null, nLetters ? `${nLetters} new Persian letter${nLetters > 1 ? "s" : ""} and words to read` : "Reading real words and signs"),
            h("li", null, "A recorded final exam (about 4 minutes)")))),
      h("div", { class: "row", style: "margin-top:20px" },
        h("button", { class: "btn saffron", onclick: () => { bumpStreak(); next(); } }, "Let's go!"),
        h("span", { class: "muted" }, "Tip: use headphones, and say everything OUT LOUD. Pashmak can tell."))));
}

function StepLearn(ls, next) {
  const L = ls.L; let i = 0;
  const box = h("div");
  function card() {
    const p = L.phrases[i];
    const fb = h("div");
    const rec = Recorder({
      label: "Tap, then say it", onDone: async r => {
        fb.replaceChildren(heardBox(r.heard, p.fa) || h("span"));
        await playBlob(r.blob); await sleep(250); await play(p.a);
      }
    });
    const c = h("div", { class: "card phrase" },
      h("div", { class: "eyebrow" }, `Phrase ${i + 1} of ${L.phrases.length}`),
      h("div", { class: "fa big" }, p.fa),
      trEl(p.tr), h("div", { class: "en" }, p.en),
      p.note ? h("div", { class: "note" }, p.note) : null,
      h("div", { class: "row center", style: "margin-top:20px" },
        h("button", { class: "btn", onclick: () => play(p.a) }, "Listen"),
        h("button", { class: "btn ghost", onclick: () => play(p.s) }, "Slow")),
      h("div", { style: "margin-top:20px" }, rec),
      h("p", { class: "muted", style: "margin:6px 0 0;font-size:14px" }, "After you record, you'll hear yourself, then the model. Compare!"),
      fb,
      h("div", { class: "row center", style: "margin-top:18px" },
        i > 0 ? h("button", { class: "btn small ghost", onclick: () => { i--; card(); } }, "Back") : null,
        h("button", { class: "btn saffron", onclick: () => { if (i < L.phrases.length - 1) { i++; card(); } else next(); } }, i < L.phrases.length - 1 ? "Next phrase" : "Play the Ear game")),
      h("div", { class: "dots" }, L.phrases.map((_, k) => h("i", { class: k <= i ? "on" : "" }))));
    box.replaceChildren(c);
    ls.audioReady.then(() => play(p.a));
  }
  card();
  return h("div", null, title(L, "Learn"), guide(i === 0 ? "Listen, repeat out loud, record yourself. Persians LOVE when you try, even if it's wobbly." : "Keep going!"), box);
}

function StepEar(ls, next) {
  const L = ls.L; const rounds = shuffle(L.phrases).slice(0, 8); let i = 0, score = 0;
  const box = h("div");
  function round() {
    if (i >= rounds.length) {
      beep("win");
      box.replaceChildren(h("div", { class: "card", style: "text-align:center" }, mascotEl(score >= 6 ? "wow" : "happy", "bob"),
        h("h2", null, `${score} / ${rounds.length}`), h("p", { class: "muted" }, score >= 7 ? "Golden ears! Pashmak is impressed." : score >= 5 ? "Nice listening!" : "Good warm-up. Your ears will get faster."),
        h("button", { class: "btn saffron", onclick: next }, "Next: Speak up")));
      return;
    }
    const p = rounds[i];
    const opts = shuffle([p, ...shuffle(L.phrases.filter(q => q !== p)).slice(0, 3)]);
    const flash = h("div", { class: "flash" }, " ");
    let answered = false;
    const optEls = opts.map(o => h("button", { class: "opt", onclick: e => {
      if (answered) return; answered = true;
      if (o === p) { score++; e.currentTarget.classList.add("right"); flash.className = "flash good"; flash.textContent = pick(PRAISE); beep("good"); }
      else { e.currentTarget.classList.add("wrong"); optEls[opts.indexOf(p)].classList.add("right"); flash.className = "flash bad"; flash.textContent = pick(OOPS); beep("bad"); ls.weak.add(p.fa); }
      reveal.classList.remove("hidden");
      setTimeout(() => { i++; round(); }, 1900);
    } }, o.en));
    const reveal = h("div", { class: "hidden", style: "margin-top:10px" }, h("span", { class: "fa", style: "font-size:24px;font-weight:700" }, p.fa), " ", S.settings.translit ? h("b", { style: "color:var(--pom)" }, p.tr) : null);
    box.replaceChildren(h("div", { class: "card task" },
      h("div", { class: "eyebrow" }, `Round ${i + 1} of ${rounds.length} · Score ${score}`),
      h("p", { style: "font-weight:800" }, "What does this mean?"),
      h("button", { class: "bigplay", "aria-label": "Play again", html: ICON.play, onclick: () => play(p.a) }),
      h("div", { class: "opts" }, optEls), flash, reveal));
    play(p.a);
  }
  ls.audioReady.then(round);
  return h("div", null, title(L, "Ear game"), guide("Listen only. No peeking at the Persian! Pick what it means. Tap the big button to hear it again."), box);
}

function StepSpeak(ls, next) {
  const L = ls.L; const queue = shuffle(L.phrases).slice(0, 6); let i = 0; let retry = [];
  const box = h("div");
  function round() {
    if (i >= queue.length && retry.length) { queue.push(...retry); retry = []; }
    if (i >= queue.length) {
      beep("win");
      box.replaceChildren(h("div", { class: "card", style: "text-align:center" }, mascotEl("wow", "bob"), h("h2", null, "Your mouth is warmed up!"), h("p", { class: "muted" }, "Time for a little story."), h("button", { class: "btn saffron", onclick: next }, "Next: The story")));
      return;
    }
    const p = queue[i];
    const fb = h("div");
    const ans = h("div", { class: "hidden", style: "margin-top:14px" }, h("div", { class: "fa", style: "font-size:34px;font-weight:800;color:var(--lapis)" }, p.fa), trEl(p.tr),
      h("div", { class: "rate" },
        h("button", { onclick: () => { i++; beep("good"); round(); } }, "Nailed it"),
        h("button", { onclick: () => { i++; round(); } }, "Almost"),
        h("button", { onclick: () => { retry.push(p); ls.weak.add(p.fa); i++; round(); } }, "Not yet (again later)")));
    const showAns = () => { ans.classList.remove("hidden"); revealBtn.classList.add("hidden"); play(p.a); };
    const revealBtn = h("button", { class: "btn small ghost", onclick: showAns }, "Show the answer");
    const rec = Recorder({ label: "Tap, say it in Farsi", onDone: async r => { fb.replaceChildren(heardBox(r.heard, p.fa) || h("span")); await playBlob(r.blob); showAns(); } });
    box.replaceChildren(h("div", { class: "card task" },
      h("div", { class: "eyebrow" }, `Say it · ${i + 1} of ${queue.length}`),
      h("div", { class: "prompt" }, `How do you say: "${p.en}"`),
      h("div", { style: "margin-top:18px" }, rec), fb,
      h("div", { style: "margin-top:12px" }, revealBtn), ans));
  }
  round();
  return h("div", null, title(L, "Speak up"), guide("I'll give you English, you say it in Farsi. Record it, then compare with the answer. Be honest with your rating. Pashmak brings back the tricky ones."), box);
}

function StepStory(ls, next) {
  const L = ls.L; const D = L.dialogue;
  const box = h("div");
  let mode = "listen";
  function listenView() {
    const lines = D.lines.map((ln, k) => h("div", { class: "line " + ln.who },
      h("div", { class: "who" }, ln.who === "Y" ? "You" : "Them"),
      h("div", { class: "msg", onclick: () => play(ln.a) }, h("span", { class: "fa" }, ln.fa), trEl(ln.tr, "t"), h("div", { class: "e" }, ln.en))));
    let playing = false;
    const playAll = async () => {
      if (playing) return; playing = true;
      for (let k = 0; k < D.lines.length; k++) {
        if (mode !== "listen" || !lines[k].isConnected) break;
        lines.forEach(x => x.classList.remove("playing")); lines[k].classList.add("playing");
        await play(D.lines[k].a); await sleep(350);
      }
      lines.forEach(x => x.classList.remove("playing")); playing = false;
    };
    box.replaceChildren(h("div", { class: "card" },
      h("div", { class: "eyebrow" }, "Scene"), h("p", { style: "font-weight:800;margin-top:2px" }, D.scene),
      h("div", { class: "row", style: "margin-bottom:16px" }, h("button", { class: "btn", onclick: playAll }, "Play the whole story"), h("span", { class: "muted" }, "Tap any bubble to replay it.")),
      h("div", { class: "dlg" }, lines),
      h("div", { class: "row", style: "margin-top:22px" }, h("button", { class: "btn saffron", onclick: () => { mode = "role"; roleView(0); } }, "Your turn: play the role!"))));
    ls.audioReady.then(playAll);
  }
  function roleView(k) {
    stopAudio();
    if (k >= D.lines.length) {
      beep("win");
      box.replaceChildren(h("div", { class: "card", style: "text-align:center" }, mascotEl("wow", "bob"), h("h2", null, "Bravo! Oscar-worthy Farsi."), h("button", { class: "btn saffron", onclick: next }, "Next: Reading")));
      return;
    }
    const ln = D.lines[k];
    const done = h("div", { class: "dlg" }, D.lines.slice(0, k).map(x => h("div", { class: "line " + x.who }, h("div", { class: "who" }, x.who === "Y" ? "You" : "Them"), h("div", { class: "msg", onclick: () => play(x.a) }, h("span", { class: "fa" }, x.fa), h("div", { class: "e" }, x.en)))));
    let cur;
    if (ln.who === "A") {
      cur = h("div", { class: "card task" }, h("div", { class: "eyebrow" }, "They say..."), h("div", { class: "fa", style: "font-size:30px;font-weight:700" }, ln.fa), trEl(ln.tr), h("div", { class: "muted", style: "font-weight:700" }, ln.en),
        h("div", { class: "row center", style: "margin-top:14px" }, h("button", { class: "btn small ghost", onclick: () => play(ln.a) }, "Hear again"), h("button", { class: "btn saffron", onclick: () => roleView(k + 1) }, "Continue")));
      play(ln.a);
    } else {
      const hint = h("div", { class: "hidden", style: "margin-top:8px" }, h("div", { class: "fa", style: "font-size:28px;font-weight:700" }, ln.fa), trEl(ln.tr));
      const fb = h("div");
      const rec = Recorder({ label: "Tap, say your line", onDone: async r => { fb.replaceChildren(heardBox(r.heard, ln.fa) || h("span")); await playBlob(r.blob); hint.classList.remove("hidden"); await play(ln.a); } });
      cur = h("div", { class: "card task" }, h("div", { class: "eyebrow" }, "Your line"), h("div", { class: "prompt" }, ln.en),
        h("div", { style: "margin-top:16px" }, rec), fb,
        h("div", { class: "row center", style: "margin-top:12px" }, h("button", { class: "btn small ghost", onclick: () => { hint.classList.remove("hidden"); play(ln.a); } }, "Hint"), h("button", { class: "btn saffron", onclick: () => roleView(k + 1) }, "Continue")), hint);
    }
    box.replaceChildren(h("div", { class: "card", style: "margin-bottom:16px" }, h("div", { class: "eyebrow" }, `Role-play · line ${k + 1} of ${D.lines.length}`), done.childElementCount ? done : h("p", { class: "muted" }, D.scene)), cur);
  }
  listenView();
  return h("div", null, title(L, "Story"), guide("First just listen to the story. Then YOU play your part. Pashmak plays everyone else (he's very talented)."), box);
}

function StepRead(ls, next) {
  const L = ls.L; const S2 = L.script;
  const box = h("div");
  function lettersView() {
    if (!S2.letters.length) return wordsView();
    box.replaceChildren(h("div", { class: "card", style: "margin-bottom:16px" }, h("p", { style: "margin:0;font-weight:700" }, S2.intro)),
      h("div", { class: "letters" }, S2.letters.map(l => h("div", { class: "card letter" }, h("div", { class: "g" }, l.g), h("div", { class: "n" }, l.name), h("div", { class: "s" }, l.sound), h("p", null, l.tip)))),
      h("div", { class: "row", style: "margin-top:22px" }, h("button", { class: "btn saffron", onclick: wordsView }, "Now read some words")));
  }
  function wordsView() {
    const W = shuffle(S2.words); let i = 0, score = 0;
    function q() {
      if (i >= W.length) {
        beep("win");
        box.replaceChildren(h("div", { class: "card", style: "text-align:center" }, mascotEl("wow", "bob"), h("h2", null, `You read ${score} of ${W.length}!`), h("p", { class: "muted" }, "Persian script, conquered (a little bit more)."), h("button", { class: "btn pom", onclick: next }, "Start the final exam")));
        return;
      }
      const w = W[i];
      const pool = LESSONS.flatMap(x => x.script.words).filter(x => x.tr !== w.tr);
      const opts = shuffle([w, ...shuffle(pool).slice(0, 2)]);
      let answered = false;
      const flash = h("div", { class: "flash" }, " ");
      const els = opts.map(o => h("button", { class: "opt", onclick: e => {
        if (answered) return; answered = true;
        if (o === w) { score++; e.currentTarget.classList.add("right"); flash.className = "flash good"; flash.textContent = pick(PRAISE); beep("good"); }
        else { e.currentTarget.classList.add("wrong"); els[opts.indexOf(w)].classList.add("right"); flash.className = "flash bad"; flash.textContent = "It's " + w.tr + "!"; beep("bad"); ls.weak.add(w.fa); }
        mean.classList.remove("hidden"); play(w.a);
        setTimeout(() => { i++; q(); }, 2000);
      } }, o.tr));
      const mean = h("div", { class: "hidden muted", style: "font-weight:800;margin-top:6px" }, `"${w.en}"`);
      box.replaceChildren(h("div", { class: "card task" }, h("div", { class: "eyebrow" }, `Word ${i + 1} of ${W.length}`), h("p", { style: "font-weight:800" }, "Read it out loud first. Then pick how it sounds:"),
        h("div", { class: "fa", style: "font-size:64px;font-weight:800;color:var(--lapis)" }, w.fa), mean, h("div", { class: "opts" }, els), flash));
    }
    q();
  }
  lettersView();
  return h("div", null, title(L, "Read"), guide(S2.letters.length ? "Reading time! Persian goes right to left. Look at each letter's shape, then try to read real words." : S2.intro, "think"), box);
}

/* ---------------- final exam ---------------- */
function StepExam(ls) {
  const L = ls.L;
  const box = h("div");
  const exam = {
    id: `L${pad(L.n)}-${Date.now()}`, lesson: L.n, lessonTitle: L.title, startedAt: new Date().toISOString(), learner: S.settings.name || "",
    listening: [], items: [], weakDuringLesson: Array.from(ls.weak), browser: navigator.userAgent
  };
  const blobs = {};
  // build tasks: 3 listening + authored speaking + 1 reading
  const listen = shuffle(L.phrases).slice(0, 3);
  const speak = L.exam.map(e => Object.assign({}, e));
  const rw = pick(L.script.words);
  speak.push({ type: "read", fa: rw.fa, tr: rw.tr, en: rw.en, efa: rw.fa, etr: rw.tr, ea: rw.a });
  const total = listen.length + speak.length; let idx = 0;

  function intro() {
    box.replaceChildren(h("div", { class: "card", style: "text-align:center" },
      mascotEl("think", "bob"), h("h2", null, "Final exam time!"),
      h("p", { style: "max-width:52ch;margin:10px auto;font-weight:700" }, `${listen.length} quick listening questions, then ${speak.length} speaking tasks. Pashmak records your answers so the next lessons can focus on what's tricky. Don't worry about mistakes. They're useful!`),
      h("p", { class: "muted" }, FS.handle ? "Recordings will save into your Farsi_lessons folder." : "Recordings are kept in this browser. Choose your results folder in Settings to also save them as files."),
      h("button", { class: "btn pom", onclick: async () => { if (FS.handle) await FS.ready(true); try { await getMic(); } catch (e) { toast("Please allow the microphone for the exam."); } listenQ(0); } }, "I'm ready, start recording")));
  }
  function progress() { return h("div", { class: "eyebrow" }, `Question ${idx + 1} of ${total}`); }
  function listenQ(k) {
    if (k >= listen.length) return speakQ(0);
    idx = k;
    const p = listen[k];
    const opts = shuffle([p, ...shuffle(L.phrases.filter(q => q !== p)).slice(0, 3)]);
    let answered = false; let plays = 0;
    const doPlay = () => { plays++; play(p.a); };
    const els = opts.map(o => h("button", { class: "opt", onclick: e => {
      if (answered) return; answered = true;
      const ok = o === p;
      exam.listening.push({ fa: p.fa, tr: p.tr, en: p.en, chose: o.en, correct: ok, plays });
      e.currentTarget.classList.add(ok ? "right" : "wrong"); if (!ok) els[opts.indexOf(p)].classList.add("right");
      beep(ok ? "good" : "bad");
      setTimeout(() => listenQ(k + 1), 1300);
    } }, o.en));
    box.replaceChildren(h("div", { class: "card task" }, progress(), h("span", { class: "pill t" }, "Listen"), h("p", { style: "font-weight:800" }, "What did you hear?"),
      h("button", { class: "bigplay", html: ICON.play, "aria-label": "Play", onclick: doPlay }), h("div", { class: "opts" }, els)));
    doPlay();
  }
  function speakQ(k) {
    if (k >= speak.length) return finish();
    idx = listen.length + k;
    const t = speak[k];
    const item = { n: k + 1, type: t.type, prompt_en: t.en, prompt_fa: t.fa || "", prompt_tr: t.tr || "", expected_fa: t.efa, expected_tr: t.etr,
      attempts: 0, usedTextHint: false, promptPlays: 0, heard: "", match: null, selfRating: null, durationSec: 0, file: null };
    let blob = null;
    const kind = t.type === "respond" ? h("span", { class: "pill t" }, "Listen & reply") : t.type === "say" ? h("span", { class: "pill s" }, "Say it in Farsi") : h("span", { class: "pill p" }, "Read out loud");
    let promptEl;
    if (t.type === "respond") {
      const txt = h("div", { class: "hidden", style: "margin-top:6px" }, h("div", { class: "fa", style: "font-size:28px;font-weight:700" }, t.fa), trEl(t.tr), h("div", { class: "muted", style: "font-weight:700" }, t.en));
      promptEl = h("div", null, h("p", { style: "font-weight:800" }, "Someone says this to you. Answer them in Farsi!"),
        h("button", { class: "bigplay", html: ICON.play, "aria-label": "Play", onclick: () => { item.promptPlays++; play(t.a); } }),
        h("button", { class: "btn small ghost", onclick: e => { item.usedTextHint = true; txt.classList.remove("hidden"); e.currentTarget.remove(); } }, "I need to see it written"), txt);
      setTimeout(() => { item.promptPlays++; play(t.a); }, 300);
    } else if (t.type === "say") {
      promptEl = h("div", { class: "prompt" }, t.en);
    } else {
      promptEl = h("div", null, h("p", { style: "font-weight:800" }, "Read this word out loud:"), h("div", { class: "fa", style: "font-size:64px;font-weight:800;color:var(--lapis)" }, t.fa));
    }
    const after = h("div", { class: "hidden", style: "margin-top:14px" });
    const nextBtn = h("button", { class: "btn saffron", disabled: true, onclick: () => {
      item.selfRating = item.selfRating || "unrated";
      exam.items.push(item); if (blob) blobs[item.file] = blob;
      speakQ(k + 1);
    } }, k < speak.length - 1 ? "Next question" : "Finish exam");
    const rec = Recorder({ maxSec: 25, label: "Tap to record your answer", onDone: r => {
      blob = r.blob; item.attempts++; item.durationSec = r.duration; item.mime = r.mime; item.heard = r.heard; item.match = r.heard ? matchScore(r.heard, t.efa) : null;
      item.file = `${pad(item.n)}-${t.type}.${extFor(r.mime)}`;
      nextBtn.disabled = false;
      const rateBtns = ["Nailed it", "Almost", "Not sure"].map(lbl => h("button", { class: item.selfRating === lbl ? "sel" : "", onclick: e => { item.selfRating = lbl; rateRow.querySelectorAll("button").forEach(b => b.classList.remove("sel")); e.currentTarget.classList.add("sel"); } }, lbl));
      const rateRow = h("div", { class: "rate" }, rateBtns);
      after.replaceChildren(
        h("div", { class: "row center" }, h("button", { class: "btn small ghost", onclick: () => playBlob(blob) }, "Hear my answer"),
          h("button", { class: "btn small", onclick: () => { modelShown.classList.remove("hidden"); play(t.ea); } }, "Compare with a model answer")),
        modelShown, h("p", { style: "font-weight:800;margin:12px 0 0" }, "How did it go?"), rateRow);
      after.classList.remove("hidden");
    } });
    const modelShown = h("div", { class: "hidden", style: "margin-top:10px" }, h("div", { class: "fa", style: "font-size:26px;font-weight:700" }, t.efa), trEl(t.etr));
    box.replaceChildren(h("div", { class: "card task" }, progress(), kind, promptEl, h("div", { style: "margin-top:18px" }, rec), after,
      h("div", { class: "row center", style: "margin-top:16px" }, nextBtn)));
  }
  async function finish() {
    exam.finishedAt = new Date().toISOString();
    exam.durationMin = Math.round((Date.parse(exam.finishedAt) - Date.parse(exam.startedAt)) / 6000) / 10;
    const lc = exam.listening.filter(x => x.correct).length;
    const pts = { "Nailed it": 2, "Almost": 1, "Not sure": 0, "unrated": 1 };
    const sp = exam.items.reduce((a, it) => a + (it.file ? pts[it.selfRating] : 0), 0) / (exam.items.length * 2);
    const ratio = (lc / exam.listening.length) * 0.4 + sp * 0.6;
    const stars = ratio >= 0.8 ? 3 : ratio >= 0.5 ? 2 : 1;
    exam.scores = { listeningCorrect: lc, listeningTotal: exam.listening.length, speakingSelfScore: Math.round(sp * 100), stars };
    exam.needsWork = [
      ...exam.listening.filter(x => !x.correct).map(x => `Listening: ${x.fa} (${x.tr}) = ${x.en}`),
      ...exam.items.filter(x => !x.file || x.selfRating === "Not sure" || x.usedTextHint || (x.match != null && x.match < 0.45)).map(x => `${x.type}: ${x.prompt_en} -> ${x.expected_tr}`)
    ];
    const canFolder = FS.handle ? await FS.ready(true) : false;
    box.replaceChildren(h("div", { class: "card", style: "text-align:center" }, h("p", { style: "font-weight:800" }, "Saving your recordings...")));
    let where = "this browser";
    try { await idbPut("exams", exam); for (const f in blobs) await idbPut("blobs", blobs[f], exam.id + "/" + f); } catch (e) { console.warn(e); }
    try { if (canFolder) { await saveExamToFolder(exam, blobs); where = "your Farsi_lessons/results folder"; } } catch (e) { console.warn(e); toast("Couldn't write to the folder. Your answers are still saved in the browser."); }
    const st = S.lessons[L.n] || {};
    S.lessons[L.n] = { done: true, stars: Math.max(st.stars || 0, stars), last: exam.finishedAt, exams: (st.exams || 0) + 1 };
    S.xp += 50 + stars * 25 + lc * 5; save();
    beep("win"); confetti();
    const nextN = L.n < 20 ? L.n + 1 : null;
    box.replaceChildren(h("div", { class: "card", style: "text-align:center" },
      mascotEl("wow", "bob"),
      h("div", { class: "stars", style: "font-size:54px", html: starsHtml(stars) }),
      h("h2", null, stars === 3 ? "Superstar! Afarin!" : stars === 2 ? "Great job! Kheyli khoob!" : "You did it! Every recording helps."),
      h("p", { style: "font-weight:700" }, `Listening: ${lc}/${exam.listening.length} · Speaking recordings: ${exam.items.filter(i => i.file).length} saved to ${where}.`),
      exam.needsWork.length ? h("div", { class: "note", style: "text-align:left" }, h("b", null, "Pashmak's notes for next time:"), h("ul", { style: "margin:4px 0 0;padding-left:20px" }, exam.needsWork.slice(0, 6).map(x => h("li", null, x)))) : h("div", { class: "note" }, "No weak spots on this one. Show-off!"),
      h("div", { class: "row center", style: "margin-top:20px" },
        nextN ? h("button", { class: "btn saffron", onclick: () => go("lesson", nextN) }, `On to Stop ${nextN}`) : null,
        h("button", { class: "btn ghost", onclick: () => go("results") }, "See my recordings"),
        h("button", { class: "btn ghost", onclick: () => go("home") }, "Back to the map"))));
  }
  intro();
  return h("div", null, title(L, "Final exam"), box);
}

function examFolder(ex) { const d = new Date(ex.startedAt); return `Lesson-${pad(ex.lesson)}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`; }
async function saveExamToFolder(exam, blobs) {
  const base = "results/" + examFolder(exam);
  for (const f in blobs) await FS.write(`${base}/${f}`, blobs[f]);
  await FS.write(`${base}/exam.json`, JSON.stringify(exam, null, 2));
  await writeSummary();
}
async function writeSummary() {
  const all = (await idbAll("exams")).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  await FS.write("results/all-exams.json", JSON.stringify({ updated: new Date().toISOString(), progress: S, exams: all.map(e => Object.assign({ folder: examFolder(e) }, e)) }, null, 2));
  await FS.write("results/SUMMARY.md", summaryMd(all));
}
function summaryMd(all) {
  let md = `# Farsi exam summary\n\nUpdated ${new Date().toLocaleString()}. ${all.length} exam(s).\n\nEach exam folder has the audio answers plus exam.json with what was asked, the expected answer, self-rating, whether the written text was needed, and what Chrome's speech recognition heard (a rough check).\n\n`;
  const weak = {};
  for (const e of all) {
    md += `## Lesson ${e.lesson}: ${e.lessonTitle} (${new Date(e.startedAt).toLocaleString()})\n\n`;
    md += `Folder: results/${examFolder(e)}  \nListening ${e.scores.listeningCorrect}/${e.scores.listeningTotal}, speaking self-score ${e.scores.speakingSelfScore}%, stars ${e.scores.stars}\n\n`;
    md += `| # | Task | Expected | Self-rating | Needed text | Heard (speech rec.) | Match |\n|---|---|---|---|---|---|---|\n`;
    for (const it of e.items) md += `| ${it.n} | ${it.type}: ${it.prompt_en.replace(/\|/g, "/")} | ${it.expected_tr} | ${it.selfRating || ""} | ${it.usedTextHint ? "yes" : ""} | ${it.heard || ""} | ${it.match == null ? "" : Math.round(it.match * 100) + "%"} |\n`;
    if (e.needsWork.length) { md += `\nNeeds work:\n` + e.needsWork.map(x => `- ${x}`).join("\n") + "\n"; e.needsWork.forEach(x => weak[x] = (weak[x] || 0) + 1); }
    if (e.weakDuringLesson && e.weakDuringLesson.length) md += `\nMissed during the lesson games: ${e.weakDuringLesson.join("، ")}\n`;
    md += "\n";
  }
  return md;
}

/* ---------------- results ---------------- */
async function Results() {
  const main = h("main", { class: "wrap stage results" });
  mount(header(topbar()), main);
  const exams = (await idbAll("exams")).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const folderLine = FS.supported
    ? h("div", { class: "row" }, h("span", { style: "font-weight:800" }, FS.handle ? "Saving to your chosen folder (results/ inside it)." : "Not saving to a folder yet."),
        h("button", { class: "btn small", onclick: async () => { try { await FS.choose(); await FS.ready(true); toast("Folder connected!"); Results(); } catch (e) {} } }, FS.handle ? "Change folder" : "Choose Farsi_lessons folder"),
        exams.length && FS.handle ? h("button", { class: "btn small saffron", onclick: async () => { if (!(await FS.ready(true))) return; for (const e of exams) { const bl = {}; for (const it of e.items) if (it.file) { const b = await idbGet("blobs", e.id + "/" + it.file); if (b) bl[it.file] = b; } await saveExamToFolder(e, bl); } toast("All exams saved to the folder."); } }, "Save everything to folder again") : null)
    : h("p", { class: "muted" }, "This browser can't save straight into a folder. Use Chrome or Edge for that, or download a .zip below.");
  main.append(h("div", { style: "margin-bottom:20px" }, h("div", { class: "eyebrow" }, "Final exams"), h("h2", null, "My recordings")),
    h("div", { class: "card", style: "margin-bottom:20px" }, folderLine,
      exams.length ? h("div", { class: "row", style: "margin-top:12px" }, h("button", { class: "btn small ghost", onclick: () => downloadZip(exams) }, "Download all as .zip")) : null));
  if (!exams.length) { main.append(guide("No exams yet! Finish your first stop and your recorded answers will show up here.", "think")); return; }
  for (const e of exams) {
    const items = h("div");
    const det = h("details", { class: "card ex" }, h("summary", null,
      h("div", { class: "disc", style: "width:48px;height:48px;border-radius:50%;border:2px solid var(--ink);display:grid;place-items:center;font-family:var(--display);font-size:22px;background:var(--turq-soft)" }, String(e.lesson)),
      h("div", { style: "flex:1;min-width:0" }, h("div", { style: "font-weight:900" }, e.lessonTitle), h("div", { class: "muted", style: "font-size:14px" }, new Date(e.startedAt).toLocaleString() + ` · listening ${e.scores.listeningCorrect}/${e.scores.listeningTotal}`)),
      h("div", { class: "stars", style: "font-size:22px", html: starsHtml(e.scores.stars) })), items);
    det.addEventListener("toggle", async () => {
      if (!det.open || items.childElementCount) return;
      for (const it of e.items) {
        const b = it.file ? await idbGet("blobs", e.id + "/" + it.file) : null;
        items.append(h("div", { class: "item" },
          h("div", { style: "min-width:0" }, h("div", { style: "font-weight:800" }, `${it.n}. ${it.prompt_en}`), it.prompt_fa ? h("div", { class: "fa", style: "text-align:left" }, it.prompt_fa) : null,
            h("div", { class: "muted", style: "font-size:14px" }, `Expected: ${it.expected_tr} · Self: ${it.selfRating || "-"}${it.usedTextHint ? " · needed the text" : ""}${it.heard ? " · heard: " : ""}`, it.heard ? h("span", { class: "fa" }, it.heard) : null)),
          b ? h("audio", { controls: true, src: URL.createObjectURL(b) }) : h("span", { class: "muted" }, "no recording")));
      }
      if (e.needsWork.length) items.append(h("div", { class: "note" }, h("b", null, "Needs work: "), e.needsWork.join(" · ")));
    });
    main.append(det);
  }
}

/* tiny zip writer (stored, no compression) */
function crc32(buf) { let c, crc = 0xFFFFFFFF; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; }
async function makeZip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const f of files) {
    const data = new Uint8Array(await (f.data instanceof Blob ? f.data.arrayBuffer() : new Blob([f.data]).arrayBuffer()));
    const name = enc.encode(f.name); const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(lh, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, p) => a + (p.byteLength || p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
async function downloadZip(exams) {
  const files = [];
  for (const e of exams) {
    const base = "results/" + examFolder(e);
    for (const it of e.items) if (it.file) { const b = await idbGet("blobs", e.id + "/" + it.file); if (b) files.push({ name: `${base}/${it.file}`, data: b }); }
    files.push({ name: `${base}/exam.json`, data: JSON.stringify(e, null, 2) });
  }
  files.push({ name: "results/SUMMARY.md", data: summaryMd(exams.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt))) });
  const z = await makeZip(files);
  const a = h("a", { href: URL.createObjectURL(z), download: "farsi-results.zip" }); document.body.append(a); a.click(); a.remove();
}

/* ---------------- settings ---------------- */
function Settings() {
  const st = S.settings;
  const nameIn = h("input", { id: "learner-name", value: st.name, placeholder: "Your first name" });
  nameIn.addEventListener("change", () => { st.name = nameIn.value.trim(); save(); toast("Saved!"); });
  const sw = (key, label, desc) => { const c = h("input", { type: "checkbox", id: "set-" + key }); c.checked = !!st[key]; c.addEventListener("change", () => { st[key] = c.checked; save(); }); return h("label", { class: "switch", for: "set-" + key }, c, h("span", null, label, h("div", { class: "muted", style: "font-weight:600;font-size:14px" }, desc))); };
  mount(header(topbar()), h("main", { class: "wrap stage" },
    h("div", { style: "margin-bottom:20px" }, h("div", { class: "eyebrow" }, "Setup"), h("h2", null, "Settings")),
    h("div", { class: "grid2" },
      h("div", { class: "card" }, h("h3", null, "About you"), h("div", { class: "field", style: "margin-top:12px" }, h("label", { for: "learner-name" }, "Your name"), nameIn),
        h("div", { style: "display:flex;flex-direction:column;gap:14px;margin-top:18px" },
          sw("translit", "Show transliteration", "The English-letter spelling under Persian words, like 'salaam'."),
          sw("recognition", "Pronunciation check", "Chrome listens and shows what it understood. Needs internet. A rough guide only."),
          sw("familyVoice", "Prefer family voices", "Play phrases recorded by family instead of the computer voice."))),
      h("div", { class: "card" }, h("h3", null, "Results folder"),
        h("p", { class: "muted" }, "Exam answers save as audio files plus notes into a results folder inside the folder you choose. Pick Documents/Farsi_lessons (make the folder first if it isn't there)."),
        FS.supported ? h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => { try { await FS.choose(); await FS.ready(true); toast("Folder connected!"); Settings(); } catch (e) {} } }, FS.handle ? "Change folder" : "Choose folder"), FS.handle ? h("span", { style: "font-weight:800" }, "Connected: " + FS.handle.name) : null)
          : h("p", { style: "font-weight:800" }, "Your browser can't save to folders. Open this app in Google Chrome or Microsoft Edge for that. You can still download a .zip from My recordings."),
        h("h3", { style: "margin-top:22px" }, "Family voices"), h("p", { class: "muted" }, "Let Sadegh or a relative record phrases in their own voice."), h("button", { class: "btn ghost", onclick: () => go("voices", nextLesson()) }, "Record family voices"),
        h("h3", { style: "margin-top:22px" }, "Start over"), h("p", { class: "muted" }, "Clears stars and progress on this computer. Recordings are kept."),
        resetBtn()))));
}
function resetBtn() {
  let armed = false;
  const b = h("button", { class: "btn small ghost", onclick: () => { if (!armed) { armed = true; b.textContent = "Tap again to confirm reset"; b.className = "btn small pom"; return; } S.lessons = {}; S.xp = 0; S.streak = 0; save(); toast("Progress reset."); go("home"); } }, "Reset progress");
  return b;
}

/* ---------------- family voices ---------------- */
function Voices(n) {
  const L = LESSONS[n - 1];
  loadAudio(n);
  const sel = h("select", { id: "voice-lesson" }, LESSONS.map(l => { const o = h("option", { value: l.n }, `Stop ${l.n}: ${l.title}`); if (l.n === n) o.selected = true; return o; }));
  sel.addEventListener("change", () => Voices(+sel.value));
  const list = h("div");
  const rows = [
    ...L.phrases.map(p => ({ fa: p.fa, tr: p.tr, en: p.en, key: p.a, extra: p.s })),
    ...L.dialogue.lines.map(x => ({ fa: x.fa, tr: x.tr, en: x.en, key: x.a })),
    ...L.exam.filter(e => e.a).map(e => ({ fa: e.fa, tr: e.tr, en: e.en, key: e.a })),
  ];
  for (const r of rows) {
    const status = h("span", { class: "pill " + (familyVoices[r.key] ? "t" : "s") }, familyVoices[r.key] ? "Family voice" : "Computer voice");
    const ctrl = h("div", { class: "row" });
    const draw = () => {
      ctrl.replaceChildren(
        h("button", { class: "btn small ghost", onclick: () => play(r.key) }, "Play"),
        h("button", { class: "btn small ghost", onclick: () => play(r.key, { robot: true }) }, "Computer"),
        recBtn(),
        familyVoices[r.key] ? h("button", { class: "btn small ghost", onclick: async () => { await idbDel("voices", r.key); if (r.extra) await idbDel("voices", r.extra); delete familyVoices[r.key]; delete familyVoices[r.extra]; status.className = "pill s"; status.textContent = "Computer voice"; draw(); } }, "Remove") : null);
    };
    const recBtn = () => {
      let rec = null, chunks = [];
      const b = h("button", { class: "btn small pom", onclick: async () => {
        if (rec) { rec.stop(); return; }
        let s; try { s = await getMic(); } catch (e) { toast("Allow the microphone first."); return; }
        const mime = bestMime(); chunks = [];
        rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
        rec.ondataavailable = e => e.data.size && chunks.push(e.data);
        rec.onstop = async () => {
          const blob = new Blob(chunks, { type: rec.mimeType }); rec = null;
          await idbPut("voices", blob, r.key); familyVoices[r.key] = true;
          if (r.extra) { await idbPut("voices", blob, r.extra); familyVoices[r.extra] = true; }
          if (await FS.ready(false)) { try { await FS.write(`family-voices/${r.key}.${extFor(blob.type)}`, blob); } catch (e) {} }
          status.className = "pill t"; status.textContent = "Family voice"; draw(); playBlob(blob);
        };
        rec.start(); b.textContent = "Stop"; stopAudio();
      } }, "Record");
      return b;
    };
    draw();
    list.append(h("div", { class: "vrow" }, h("div", { style: "min-width:0" }, h("div", { class: "fa", style: "font-size:22px;font-weight:700;text-align:left" }, r.fa), h("div", { class: "muted", style: "font-weight:700" }, `${r.tr} · ${r.en}`), status), ctrl));
  }
  mount(header(topbar()), h("main", { class: "wrap stage" },
    h("div", { style: "margin-bottom:16px" }, h("div", { class: "eyebrow" }, "For Sadegh and the family"), h("h2", null, "Record family voices")),
    guide("The computer voice is good, but a real family voice is better! Pick a stop, tap Record, say the phrase naturally, tap Stop. From then on the lessons play your voice.", "happy"),
    h("div", { class: "card" }, h("div", { class: "field" }, h("label", { for: "voice-lesson" }, "Stop"), sel), list)));
}

/* ---------------- boot ---------------- */
(async function boot() {
  try { await FS.load(); await loadFamilyVoices(); } catch (e) {}
  const m = location.hash.match(/^#lesson-(\d+)$/);
  if (m) go("lesson", Math.min(20, Math.max(1, +m[1]))); else go("home");
})();
})();
