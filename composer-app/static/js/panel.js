const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

$("#panel-toggle").onclick = () => $("#panel").classList.toggle("collapsed");

// --- NEW: Dynamically build the tabs to perfectly match our 3D scene ---
const availableInstruments = [
  "Violin", "Flute", "Oboe", "French Horn", 
  "Trumpet", "Trombone", "Drum", "Piano"
];

const addBtn = $("#add-instrument");
const tabsContainer = addBtn.parentElement;

// 1. Remove any hardcoded HTML tabs you don't actually have (except the add button)
$$(".tab:not(.add)").forEach(t => t.remove());

// 2. Generate the correct tabs
availableInstruments.forEach((name, i) => {
  const t = document.createElement("div");
  t.className = "tab" + (i === 0 ? " active" : "");
  t.textContent = name;
  
  t.onclick = () => {
    $$(".tab:not(.add)").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
  };
  
  // Insert them into the DOM right before the '+' button
  tabsContainer.insertBefore(t, addBtn);
});

$("#add-instrument").onclick = () => {
  const active = document.querySelector(".tab.active");
  const kind = active ? active.textContent.trim() : "Trumpet";
  window.dispatchEvent(new CustomEvent("instrument:add", { detail: { kind } }));
};

const rec = $("#rec"), sub = $("#sub"), note = $("#note"), cents = $("#cents");
const pool = ["F4", "G4", "A♭4", "B♭4", "C5", "D♭5", "E♭5", "F5"];
let iv;
rec.onclick = () => {
  const on = rec.classList.toggle("on");
  sub.textContent = on ? "Recording…" : "Ready to record";
  clearInterval(iv);
  if (on) {
    iv = setInterval(() => {
      note.textContent = pool[Math.floor(Math.random() * pool.length)];
      const c = Math.floor((Math.random() - 0.5) * 20);
      cents.textContent = (c >= 0 ? "+" : "") + c + "¢";
    }, 200);
  }
};

const data = [
  ["F4", "1/4"], ["A♭4", "1/8"], ["C5", "1/8"], ["D♭5", "1/4."], ["C5", "1/8"],
  ["B♭4", "1/4"], ["A♭4", "1/8"], ["F4", "1/2"], ["F4", "1/8"], ["G4", "1/8"],
  ["A♭4", "1/4"], ["C5", "1/8"], ["D♭5", "1/8"], ["F5", "1/2"],
];
const list = $("#notes");
data.forEach(([p, d], i) => {
  const el = document.createElement("div");
  el.className = "note" + (i === 3 ? " active" : "");
  el.innerHTML = `<div class="note-left"><span class="note-pitch">${p}</span><span class="note-dur">${d}</span></div>`;
  el.onclick = () => {
    $$(".note").forEach((n) => n.classList.remove("active"));
    el.classList.add("active");
  };
  list.appendChild(el);
});