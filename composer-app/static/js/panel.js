const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

$("#panel-toggle").onclick = () => $("#panel").classList.toggle("collapsed");

// --- NEW: Dynamically build the tabs to perfectly match our 3D scene ---
const availableInstruments = [
  "Violin", "Flute", "Trumpet", "Drum", "Piano"
];

const addBtn = $("#add-instrument");
const tabsContainer = addBtn.parentElement;

function makeTab(name, active) {
  const t = document.createElement("div");
  t.className = "tab" + (active ? " active" : "");
  t.textContent = name;
  t.onclick = () => {
    $$(".tab:not(.add)").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
  };
  tabsContainer.insertBefore(t, addBtn);
  return t;
}

$$(".tab:not(.add)").forEach(t => t.remove());
availableInstruments.forEach((name, i) => makeTab(name, i === 0));

addBtn.onclick = () => {
  const active = document.querySelector(".tab.active");
  const kind = active ? active.textContent.trim() : "Trumpet";
  window.dispatchEvent(new CustomEvent("instrument:add", { detail: { kind } }));
};

const removeBtn = document.createElement("button");
removeBtn.className = "tab add";
removeBtn.id = "remove-instrument";
removeBtn.setAttribute("aria-label", "Remove instrument");
removeBtn.setAttribute("title", "Remove instrument");
removeBtn.textContent = "−";
tabsContainer.insertBefore(removeBtn, addBtn);

removeBtn.onclick = () => {
  const active = document.querySelector(".tab:not(.add).active");
  if (!active) return;
  const tabs = [...$$(".tab:not(.add)")];
  if (tabs.length <= 1) return;
  const idx = tabs.indexOf(active);
  active.remove();
  const remaining = [...$$(".tab:not(.add)")];
  const next = remaining[Math.min(idx, remaining.length - 1)];
  if (next) next.classList.add("active");
  window.dispatchEvent(new CustomEvent("instrument:remove", { detail: { kind: active.textContent.trim() } }));
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