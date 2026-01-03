// Security+ Practice (Domains + Blueprint-weighted selection + Domain Audit + Results mix/warnings)
// Domains are OPTIONAL (safe): missing/empty domains.json will never break the app.

const DATA = {
  questions: [],
  answersById: new Map(),
  domainsById: new Map(), // id(string) -> domain number (1..5)
};

const STORAGE_SESSION = "secplus_session_v5";
const STORAGE_FLAGS   = "secplus_flags_v3";
const STORAGE_PERF    = "secplus_perf_v3";

const el = (id) => document.getElementById(id);

const views = {
  home: el("viewHome"),
  quiz: el("viewQuiz"),
  results: el("viewResults"),
};

const ui = {
  statusPill: el("statusPill"),

  // Home controls
  studyExplainedOnly: el("studyExplainedOnly"),
  studySetType: el("studySetType"),
  studyDomain: el("studyDomain"),
  studyCount: el("studyCount"),
  btnStartStudy: el("btnStartStudy"),

  examExplainedOnly: el("examExplainedOnly"),
  examSetType: el("examSetType"),
  examDomain: el("examDomain"),
  examCount: el("examCount"),
  btnStartExam: el("btnStartExam"),

  btnResume: el("btnResume"),
  btnResetSession: el("btnResetSession"),
  btnResetLearning: el("btnResetLearning"),

  // Domain Audit
  domainAuditSummary: el("domainAuditSummary"),
  auditMeterBar: el("auditMeterBar"),
  auditMeterLabel: el("auditMeterLabel"),
  auditReliabilityPill: el("auditReliabilityPill"),
  domainAuditTableWrap: el("domainAuditTableWrap"),
  blueprintTargets: el("blueprintTargets"),
  unassignedList: el("unassignedList"),
  btnRefreshAudit: el("btnRefreshAudit"),

  // Quiz controls
  modeLabel: el("modeLabel"),
  progressLabel: el("progressLabel"),
  domainLabel: el("domainLabel"),
  questionBox: el("questionBox"),
  btnPrev: el("btnPrev"),
  btnNext: el("btnNext"),
  btnQuit: el("btnQuit"),
  btnFlag: el("btnFlag"),

  // Results controls
  resultsSummary: el("resultsSummary"),
  sessionMix: el("sessionMix"),           // NEW
  domainWarnings: el("domainWarnings"),   // NEW
  domainBreakdown: el("domainBreakdown"),
  chkIncorrectOnly: el("chkIncorrectOnly"),
  resultsReview: el("resultsReview"),
  btnHome: el("btnHome"),
  btnStartOver: el("btnStartOver"),
};

const DOMAIN_NAMES_SHORT = {
  1: "Domain 1 (12%)",
  2: "Domain 2 (22%)",
  3: "Domain 3 (18%)",
  4: "Domain 4 (28%)",
  5: "Domain 5 (20%)",
};

const DOMAIN_NAMES_LONG = {
  1: "Domain 1: General Security Concepts (12%)",
  2: "Domain 2: Threats, Vulnerabilities, and Mitigations (22%)",
  3: "Domain 3: Security Architecture (18%)",
  4: "Domain 4: Security Operations (28%)",
  5: "Domain 5: Security Program Management and Oversight (20%)",
};

const DOMAIN_WEIGHTS = { 1: 0.12, 2: 0.22, 3: 0.18, 4: 0.28, 5: 0.20 };
const WEIGHT_MIN_TAG_COVERAGE = 0.60; // if less than 60% tagged for a given N, fall back to random

let state = null;
let FLAGS = new Set();
let PERF = {};

// ---------- helpers ----------
function showView(name){
  Object.entries(views).forEach(([k,v]) => v.classList.toggle("hidden", k !== name));
}
function setStatus(text, kind){
  ui.statusPill.textContent = text || "";
  ui.statusPill.className = "pill " + (kind || "");
  ui.statusPill.classList.toggle("hidden", !text);
}
function nowISO(){ return new Date().toISOString(); }
function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}
function pct(n){ return (n * 100).toFixed(1) + "%"; }

// ---------- storage ----------
function saveSession(){ if (state) localStorage.setItem(STORAGE_SESSION, JSON.stringify(state)); }
function loadSession(){
  const raw = localStorage.getItem(STORAGE_SESSION);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function clearSession(){ localStorage.removeItem(STORAGE_SESSION); state = null; }

function saveFlags(){ localStorage.setItem(STORAGE_FLAGS, JSON.stringify([...FLAGS])); }
function loadFlags(){
  const raw = localStorage.getItem(STORAGE_FLAGS);
  if (!raw) return new Set();
  try { return new Set(JSON.parse(raw)); } catch { return new Set(); }
}
function savePerf(){ localStorage.setItem(STORAGE_PERF, JSON.stringify(PERF)); }
function loadPerf(){
  const raw = localStorage.getItem(STORAGE_PERF);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
function clearLearning(){
  localStorage.removeItem(STORAGE_FLAGS);
  localStorage.removeItem(STORAGE_PERF);
  FLAGS = new Set();
  PERF = {};
}

// ---------- domains ----------
function getDomainForId(id){
  const d = DATA.domainsById.get(String(id));
  return (d === undefined || d === null) ? null : Number(d);
}
function domainMatchesFilter(id, filterValue){
  const d = getDomainForId(id);
  if (filterValue === "all") return true;
  if (filterValue === "unassigned") return d === null;
  return d === Number(filterValue);
}

// ---------- data loading ----------
async function safeJson(url, fallback){
  try{
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return fallback;

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (url.endsWith(".json") && !ct.includes("application/json") && !ct.includes("text/json")){
      const text = await res.text();
      if (text.trim().startsWith("<")) return fallback; // HTML
      try { return JSON.parse(text); } catch { return fallback; }
    }
    return await res.json();
  } catch {
    return fallback;
  }
}

async function loadData(){
  setStatus("Loading…", "warn");

  const questions = await safeJson("data/questions.json", []);
  const answers   = await safeJson("data/answers_1_25.json", []);
  const domains   = await safeJson("data/domains.json", {}); // optional

  DATA.questions = questions;
  DATA.answersById = new Map(answers.map(x => [x.id, x]));
  DATA.domainsById = new Map(Object.entries(domains));

  if (DATA.questions.length === 0){
    setStatus("ERROR: questions.json not loaded", "bad");
    alert("Data load error: questions.json could not be loaded. Verify /data/questions.json exists and refresh.");
    return false;
  }

  setStatus(`Loaded ${DATA.questions.length} • Explanations ${DATA.answersById.size} • Domains ${DATA.domainsById.size}`, "ok");
  setTimeout(()=>setStatus("", ""), 2000);

  renderDomainAudit();
  return true;
}

// ---------- Domain Audit ----------
function computeBlueprintCounts(N){
  // Largest remainder method
  const floorCounts = {};
  const remainders = [];
  let sumFloors = 0;

  for (const d of [1,2,3,4,5]){
    const raw = N * DOMAIN_WEIGHTS[d];
    const f = Math.floor(raw);
    floorCounts[d] = f;
    sumFloors += f;
    remainders.push({ d, r: raw - f });
  }

  let remaining = N - sumFloors;
  remainders.sort((a,b) => b.r - a.r);

  // Tie jitter
  for (let i=0; i<remainders.length; i++){
    for (let j=i+1; j<remainders.length; j++){
      if (Math.abs(remainders[i].r - remainders[j].r) < 1e-9 && Math.random() < 0.5){
        [remainders[i], remainders[j]] = [remainders[j], remainders[i]];
      }
    }
  }

  let idx = 0;
  while (remaining > 0){
    const d = remainders[idx % remainders.length].d;
    floorCounts[d] += 1;
    remaining -= 1;
    idx += 1;
  }
  return floorCounts;
}

function renderDomainAudit(){
  const total = DATA.questions.length;

  const counts = {1:0,2:0,3:0,4:0,5:0, unassigned:0};
  const unassignedIds = [];

  for (const q of DATA.questions){
    const d = getDomainForId(q.id);
    if (d && counts[d] !== undefined) counts[d] += 1;
    else { counts.unassigned += 1; unassignedIds.push(q.id); }
  }

  const tagged = total - counts.unassigned;
  const coverage = total ? (tagged / total) : 0;

  ui.domainAuditSummary.textContent =
    `Total questions: ${total} • Tagged: ${tagged} • Unassigned: ${counts.unassigned}`;

  ui.auditMeterBar.style.width = (coverage * 100).toFixed(1) + "%";
  ui.auditMeterLabel.textContent = `Tag coverage: ${pct(coverage)} (weighted selection becomes most reliable as coverage increases)`;

  if (coverage >= 0.80){
    ui.auditReliabilityPill.className = "pill ok";
    ui.auditReliabilityPill.textContent = "Excellent coverage";
  } else if (coverage >= WEIGHT_MIN_TAG_COVERAGE){
    ui.auditReliabilityPill.className = "pill warn";
    ui.auditReliabilityPill.textContent = "Usable coverage";
  } else {
    ui.auditReliabilityPill.className = "pill bad";
    ui.auditReliabilityPill.textContent = "Low coverage";
  }

  const rows = [
    { d: 1, label: DOMAIN_NAMES_SHORT[1], n: counts[1], w: DOMAIN_WEIGHTS[1] },
    { d: 2, label: DOMAIN_NAMES_SHORT[2], n: counts[2], w: DOMAIN_WEIGHTS[2] },
    { d: 3, label: DOMAIN_NAMES_SHORT[3], n: counts[3], w: DOMAIN_WEIGHTS[3] },
    { d: 4, label: DOMAIN_NAMES_SHORT[4], n: counts[4], w: DOMAIN_WEIGHTS[4] },
    { d: 5, label: DOMAIN_NAMES_SHORT[5], n: counts[5], w: DOMAIN_WEIGHTS[5] },
    { d: "ua", label: "Unassigned", n: counts.unassigned, w: null },
  ];

  ui.domainAuditTableWrap.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Domain</th>
          <th>Count</th>
          <th>% of bank</th>
          <th>Exam weight</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><b>${escapeHtml(r.label)}</b></td>
            <td><b>${r.n}</b></td>
            <td>${total ? pct(r.n / total) : "—"}</td>
            <td>${r.w === null ? "—" : pct(r.w)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  const t10 = computeBlueprintCounts(10);
  const t25 = computeBlueprintCounts(25);

  function targetBox(N, t){
    return `
      <div class="panel" style="margin-top:10px">
        <div class="row space">
          <b>${N} questions</b>
          <span class="pill">weighted</span>
        </div>
        <div class="muted small" style="margin-top:8px">
          D1 ${t[1]} • D2 ${t[2]} • D3 ${t[3]} • D4 ${t[4]} • D5 ${t[5]}
        </div>
      </div>
    `;
  }

  ui.blueprintTargets.innerHTML = targetBox(10, t10) + targetBox(25, t25);

  unassignedIds.sort((a,b) => a-b);
  ui.unassignedList.textContent = unassignedIds.length
    ? unassignedIds.join(", ")
    : "None — everything is tagged.";
}

// ---------- selection helpers ----------
function eligibleIds({explainedOnly, domainFilter}){
  let ids = DATA.questions.map(q => q.id);
  if (explainedOnly) ids = ids.filter(id => DATA.answersById.has(id));
  ids = ids.filter(id => domainMatchesFilter(id, domainFilter));
  return ids;
}

function pickIdsRandom(ids, count){
  const shuffled = shuffle([...ids]);
  if (count === "all") return { ids: shuffled, usedWeighted: false, note: "Random" };
  const n = Math.min(parseInt(count,10), shuffled.length);
  return { ids: shuffled.slice(0, n), usedWeighted: false, note: "Random" };
}

function pickIdsFlagged(ids, count){
  const flagged = ids.filter(id => FLAGS.has(id));
  if (flagged.length === 0) return { ids: [], usedWeighted: false, note: "Flagged (none)" };
  return { ...pickIdsRandom(flagged, count), usedWeighted: false, note: "Flagged" };
}

function weaknessScore(id){
  const p = PERF[id];
  if (!p) return 0;
  return (p.wrong || 0) - (p.correct || 0);
}

function pickIdsWeak(ids, count){
  const scored = ids
    .map(id => ({ id, score: weaknessScore(id) }))
    .sort((a,b) => b.score - a.score);

  if (scored.length === 0 || scored[0].score <= 0){
    const r = pickIdsRandom(ids, count);
    return { ...r, usedWeighted: false, note: "Weak (fallback to random)" };
  }

  const ordered = scored.map(x => x.id);
  if (count === "all") return { ids: ordered, usedWeighted: false, note: "Weak" };
  const n = Math.min(parseInt(count,10), ordered.length);
  return { ids: ordered.slice(0, n), usedWeighted: false, note: "Weak" };
}

function pickIdsBlueprintWeighted(ids, count){
  if (count === "all"){
    const r = pickIdsRandom(ids, count);
    return { ...r, usedWeighted: false, note: "All (no weighting needed)" };
  }

  const N = Math.min(parseInt(count,10), ids.length);

  const pools = {1:[],2:[],3:[],4:[],5:[]};
  for (const id of ids){
    const d = getDomainForId(id);
    if (d && pools[d]) pools[d].push(id);
  }

  const taggedCount = pools[1].length + pools[2].length + pools[3].length + pools[4].length + pools[5].length;
  const tagCoverageWithinFilter = ids.length ? (taggedCount / ids.length) : 0;

  // If too few tagged within this filtered set, fall back to random
  if (taggedCount < Math.ceil(N * WEIGHT_MIN_TAG_COVERAGE)){
    const r = pickIdsRandom(ids, N);
    return {
      ...r,
      usedWeighted: false,
      note: `Fallback random (tag coverage too low for weighting in this filter: ${pct(tagCoverageWithinFilter)})`,
      tagCoverageWithinFilter
    };
  }

  for (const d of [1,2,3,4,5]) shuffle(pools[d]);

  const targets = computeBlueprintCounts(N);
  const chosen = [];
  let shortfall = 0;

  for (const d of [1,2,3,4,5]){
    const want = targets[d];
    const take = Math.min(want, pools[d].length);
    chosen.push(...pools[d].slice(0, take));
    shortfall += (want - take);
    pools[d] = pools[d].slice(take);
  }

  function anyLeft(){
    return [1,2,3,4,5].some(d => pools[d].length > 0);
  }

  if (shortfall > 0){
    const order = [];
    for (const d of [4,2,5,3,1]){
      const reps = Math.max(1, Math.round(DOMAIN_WEIGHTS[d] * 10));
      for (let i=0; i<reps; i++) order.push(d);
    }
    shuffle(order);

    let i = 0;
    while (shortfall > 0 && anyLeft()){
      const d = order[i % order.length];
      if (pools[d].length > 0){
        chosen.push(pools[d].shift());
        shortfall -= 1;
      }
      i += 1;
    }
  }

  // Fill any remaining from other ids (including unassigned) without duplicates
  if (chosen.length < N){
    const remaining = ids.filter(x => !chosen.includes(x));
    chosen.push(...remaining.slice(0, N - chosen.length));
  }

  return {
    ids: shuffle(chosen).slice(0, N),
    usedWeighted: true,
    note: `Blueprint-weighted (tag coverage within filter: ${pct(tagCoverageWithinFilter)})`,
    tagCoverageWithinFilter
  };
}

function buildSessionSelection({setType, explainedOnly, domainFilter, count}){
  const ids = eligibleIds({ explainedOnly, domainFilter });
  if (ids.length === 0) return { ids: [], usedWeighted: false, note: "No eligible questions" };

  if (setType === "flagged") return pickIdsFlagged(ids, count);
  if (setType === "weak") return pickIdsWeak(ids, count);

  // Random mode = blueprint weighted by default (with safe fallback)
  return pickIdsBlueprintWeighted(ids, count);
}

// ---------- session ----------
function startSession({mode, setType, explainedOnly, domainFilter, count}){
  const selection = buildSessionSelection({ setType, explainedOnly, domainFilter, count });

  if (selection.ids.length === 0){
    if (setType === "flagged"){
      alert("No flagged questions found for this filter. Flag a few questions first.");
    } else if (domainFilter !== "all"){
      alert("No questions match this Domain filter yet. Try 'All domains' or 'Unassigned'.");
    } else {
      alert("No questions available. Check that data/questions.json and data/answers_1_25.json are loading.");
    }
    return;
  }

  state = {
    version: 5,
    mode,
    setType,
    explainedOnly: !!explainedOnly,
    domainFilter,
    startedAt: nowISO(),
    finishedAt: null,
    ids: selection.ids,
    selectionMeta: {
      usedWeighted: !!selection.usedWeighted,
      note: selection.note || "",
      tagCoverageWithinFilter: selection.tagCoverageWithinFilter ?? null
    },
    index: 0,
    answers: {},
  };

  saveSession();
  renderQuiz();
  showView("quiz");
}

function currentQuestion(){
  const id = state.ids[state.index];
  return DATA.questions.find(q => q.id === id);
}

// ---------- flagging ----------
function updateFlagButton(){
  const q = currentQuestion();
  if (!q) return;
  const isFlagged = FLAGS.has(q.id);
  ui.btnFlag.innerHTML = `${isFlagged ? "Unflag" : "Flag"}`;
  ui.btnFlag.className = "btn " + (isFlagged ? "primary" : "");
}
function toggleFlag(){
  const q = currentQuestion();
  if (!q) return;
  if (FLAGS.has(q.id)) FLAGS.delete(q.id);
  else FLAGS.add(q.id);
  saveFlags();
  updateFlagButton();
}

// ---------- quiz rendering ----------
function renderQuiz(){
  const q = currentQuestion();
  if (!q){
    ui.questionBox.innerHTML = "<p>No questions available.</p>";
    ui.btnPrev.disabled = true;
    ui.btnNext.disabled = true;
    return;
  }

  ui.modeLabel.textContent = state.mode === "study" ? "Study mode" : "Exam mode";
  ui.modeLabel.className = "pill " + (state.mode === "study" ? "ok" : "warn");

  const answeredCount = Object.keys(state.answers).length;
  ui.progressLabel.textContent = `Question ${state.index + 1} of ${state.ids.length} • Answered ${answeredCount}`;

  const d = getDomainForId(q.id);
  ui.domainLabel.textContent = d ? DOMAIN_NAMES_LONG[d] : "Domain: Unassigned";

  updateFlagButton();
  ui.questionBox.innerHTML = "";

  const pack = DATA.answersById.get(q.id) || null;
  const saved = state.answers[q.id]?.selected || null;

  const meta = document.createElement("div");
  meta.className = "qMeta";
  meta.innerHTML = `<span class="pill">Q${q.id}</span>` + (pack?.studyGuideTopic ? ` <span class="pill">${escapeHtml(pack.studyGuideTopic)}</span>` : "");
  ui.questionBox.appendChild(meta);

  const title = document.createElement("div");
  title.className = "qTitle";
  title.textContent = q.question;
  ui.questionBox.appendChild(title);

  const choiceEls = [];
  for (const letter of ["A","B","C","D"]){
    const div = document.createElement("div");
    div.className = "choice";
    div.dataset.letter = letter;
    div.innerHTML = `<div class="letter">${letter}</div><div>${escapeHtml(q.choices[letter] || "")}</div>`;
    div.addEventListener("click", () => onSelect(q.id, letter));
    ui.questionBox.appendChild(div);
    choiceEls.push(div);
  }

  if (saved){
    markChoices(choiceEls, q.id, saved);
    renderExplanation(q.id);
  }

  ui.btnPrev.disabled = state.index === 0;
  ui.btnNext.disabled = state.index >= state.ids.length - 1;
}

function markChoices(choiceEls, qid, selected){
  const pack = DATA.answersById.get(qid);
  const correct = pack?.correctAnswer || null;

  choiceEls.forEach(elm => {
    const letter = elm.dataset.letter;
    elm.classList.toggle("selected", letter === selected);

    if (correct){
      if (letter === correct) elm.classList.add("correct");
      if (letter === selected && selected !== correct) elm.classList.add("wrong");
    }
  });
}

function onSelect(questionId, letter){
  const pack = DATA.answersById.get(questionId);
  const correct = pack?.correctAnswer || null;
  const isCorrect = correct ? (letter === correct) : false;

  state.answers[questionId] = { selected: letter, isCorrect, answeredAt: nowISO() };
  saveSession();

  PERF[questionId] = PERF[questionId] || { correct: 0, wrong: 0 };
  if (correct){
    if (isCorrect) PERF[questionId].correct += 1;
    else PERF[questionId].wrong += 1;
    savePerf();
  }

  renderQuiz();
}

function renderExplanation(qid){
  const selected = state.answers[qid]?.selected;
  if (!selected) return;

  const pack = DATA.answersById.get(qid);
  const box = document.createElement("div");
  box.className = "explain";

  if (!pack){
    box.innerHTML = `<b>Explanation:</b> <span class="muted">Not available yet.</span>`;
    ui.questionBox.appendChild(box);
    return;
  }

  const isCorrect = selected === pack.correctAnswer;

  box.innerHTML = `
    <div class="row wrap" style="gap:10px; margin-bottom:10px">
      <span class="pill ${isCorrect ? "ok" : "bad"}">${isCorrect ? "Correct" : "Incorrect"}</span>
      <span class="pill">Correct answer: <b>${pack.correctAnswer}</b></span>
      ${FLAGS.has(qid) ? `<span class="pill warn">Flagged</span>` : ``}
    </div>

    <details open>
      <summary>
        Explanation
        <span class="summaryHint">tap to collapse</span>
      </summary>
      <div style="margin-top:10px">${escapeHtml(pack.explanation || "")}</div>
    </details>

    <details>
      <summary>
        Why the other options are wrong
        <span class="summaryHint">tap to expand</span>
      </summary>

      <div class="stack" style="margin-top:10px">
        ${["A","B","C","D"].map(L => `
          <div class="panel">
            <div class="row space">
              <div><b>${L}</b></div>
              <div class="pill ${L === pack.correctAnswer ? "ok" : ""}">
                ${L === pack.correctAnswer ? "Correct" : "Not correct"}
              </div>
            </div>
            <div class="muted" style="margin-top:6px">${escapeHtml(pack.feedback?.[L] || "")}</div>
          </div>
        `).join("")}
      </div>
    </details>
  `;

  ui.questionBox.appendChild(box);
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- navigation ----------
function next(){ if (state.index < state.ids.length - 1){ state.index++; saveSession(); renderQuiz(); } }
function prev(){ if (state.index > 0){ state.index--; saveSession(); renderQuiz(); } }

// ---------- results helpers (NEW) ----------
function countDomainsForIds(ids){
  const c = {1:0,2:0,3:0,4:0,5:0, unassigned:0};
  for (const id of ids){
    const d = getDomainForId(id);
    if (d && c[d] !== undefined) c[d] += 1;
    else c.unassigned += 1;
  }
  return c;
}
function mixToString(c){
  const parts = [`D1 ${c[1]}`, `D2 ${c[2]}`, `D3 ${c[3]}`, `D4 ${c[4]}`, `D5 ${c[5]}`];
  if (c.unassigned) parts.push(`Unassigned ${c.unassigned}`);
  return parts.join(" • ");
}
function blueprintTargetString(N){
  const t = computeBlueprintCounts(N);
  return `D1 ${t[1]} • D2 ${t[2]} • D3 ${t[3]} • D4 ${t[4]} • D5 ${t[5]}`;
}

// ---------- results ----------
function gradeAnswered(){
  const answered = Object.values(state.answers);
  const answeredCount = answered.length;
  const correctCount = answered.filter(a => a.isCorrect).length;
  const score = answeredCount ? (correctCount / answeredCount) : null;
  return { answeredCount, correctCount, score };
}

function renderSessionMixAndWarnings(){
  // Session mix (selected IDs)
  const selectedMix = countDomainsForIds(state.ids);

  // Answered mix
  const answeredIds = Object.keys(state.answers).map(Number);
  const answeredMix = countDomainsForIds(answeredIds);

  const N = state.ids.length;
  const blueprint = blueprintTargetString(N);

  const meta = state.selectionMeta || null;
  const weightingNote = meta?.note ? ` • ${meta.note}` : "";
  const weightingMode = meta?.usedWeighted ? "Blueprint-weighted" : "Random selection";

  ui.sessionMix.textContent =
    `Session domain mix (selected): ${mixToString(selectedMix)} • Blueprint target for ${N}: ${blueprint} • ${weightingMode}${weightingNote}
Answered mix: ${answeredIds.length ? mixToString(answeredMix) : "None answered yet"}`;

  // Warning: answered questions with missing domain tags
  if (answeredMix.unassigned > 0){
    const unassignedAnswered = answeredIds.filter(id => getDomainForId(id) === null).sort((a,b)=>a-b);
    const preview = unassignedAnswered.slice(0, 30).join(", ");
    const more = unassignedAnswered.length > 30 ? ` …(+${unassignedAnswered.length - 30} more)` : "";

    ui.domainWarnings.classList.remove("hidden");
    ui.domainWarnings.innerHTML =
      `<b>Domain tagging warning:</b> ${answeredMix.unassigned} answered question(s) are <b>Unassigned</b> (no domain tag). ` +
      `This can reduce how closely sessions mimic the exam blueprint. ` +
      `<div class="muted small" style="margin-top:6px">Unassigned answered IDs: ${escapeHtml(preview)}${escapeHtml(more)}</div>`;
  } else {
    ui.domainWarnings.classList.add("hidden");
    ui.domainWarnings.textContent = "";
  }
}

function renderDomainBreakdown(){
  const buckets = {1:{a:0,c:0},2:{a:0,c:0},3:{a:0,c:0},4:{a:0,c:0},5:{a:0,c:0},unassigned:{a:0,c:0}};
  for (const [idStr, ans] of Object.entries(state.answers)){
    const id = Number(idStr);
    const d = getDomainForId(id);
    const key = d ? d : "unassigned";
    buckets[key].a += 1;
    if (ans.isCorrect) buckets[key].c += 1;
  }
  const parts = [];
  for (const d of [1,2,3,4,5]){
    if (buckets[d].a > 0) parts.push(`D${d}: ${buckets[d].c}/${buckets[d].a}`);
  }
  if (buckets.unassigned.a > 0) parts.push(`Unassigned: ${buckets.unassigned.c}/${buckets.unassigned.a}`);
  ui.domainBreakdown.textContent = parts.length ? `By domain (correct/answered): ${parts.join(" • ")}` : "";
}

function quitAndGrade(){
  if (!confirm("Quit and grade answered questions?")) return;
  state.finishedAt = nowISO();
  saveSession();
  renderResults();
  showView("results");
}

function renderResults(){
  const { answeredCount, correctCount, score } = gradeAnswered();

  ui.resultsSummary.innerHTML = `
    <div class="row wrap">
      <span class="pill">${state.mode === "study" ? "Study" : "Exam"}</span>
      <span class="pill">Set: ${state.setType}</span>
      <span class="pill">Domain filter: ${state.domainFilter}</span>
      <span class="pill">Session total: ${state.ids.length}</span>
      <span class="pill">Answered: ${answeredCount}</span>
      <span class="pill ${score===null ? "" : score>=0.8 ? "ok" : score>=0.6 ? "warn" : "bad"}">
        ${score===null ? "Score: N/A" : `Score: ${(score*100).toFixed(1)}%`}
      </span>
      <span class="pill">${score===null ? "" : `Correct: ${correctCount}/${answeredCount}`}</span>
    </div>
  `;

  renderSessionMixAndWarnings();   // NEW
  renderDomainBreakdown();
  renderResultsReview();
}

function renderResultsReview(){
  ui.resultsReview.innerHTML = "";
  const incorrectOnly = ui.chkIncorrectOnly.checked;

  const answeredIds = Object.keys(state.answers).map(Number).sort((a,b)=>a-b);
  const filteredIds = answeredIds.filter(id => {
    if (!incorrectOnly) return true;
    const pack = DATA.answersById.get(id);
    const correct = pack?.correctAnswer || null;
    if (!correct) return false;
    return state.answers[id].selected !== correct;
  });

  if (filteredIds.length === 0){
    ui.resultsReview.innerHTML = `<div class="panel muted">No items to review for this filter.</div>`;
    return;
  }

  filteredIds.forEach(id => {
    const q = DATA.questions.find(x => x.id === id);
    const pack = DATA.answersById.get(id);
    const ans = state.answers[id];
    const correct = pack?.correctAnswer || null;
    const isCorrect = correct ? ans.selected === correct : false;

    const d = getDomainForId(id);
    const domainText = d ? DOMAIN_NAMES_LONG[d] : "Domain: Unassigned";

    const card = document.createElement("div");
    card.className = "panel";
    card.innerHTML = `
      <div class="row space">
        <div>
          <b>Q${id}</b>
          ${FLAGS.has(id) ? `<span class="pill warn" style="margin-left:8px">Flagged</span>` : ``}
        </div>
        <div class="pill ${correct ? (isCorrect ? "ok" : "bad") : "warn"}">
          ${correct ? (isCorrect ? "Correct" : "Incorrect") : "Answered"}
        </div>
      </div>
      <div class="muted small" style="margin-top:6px">${escapeHtml(domainText)}</div>
      <div style="margin-top:8px">${escapeHtml(q?.question || "")}</div>
      <div class="muted" style="margin-top:8px">
        <b>Your answer:</b> ${ans.selected}${correct ? ` • <b>Correct:</b> ${correct}` : ""}
      </div>
    `;
    ui.resultsReview.appendChild(card);
  });
}

// ---------- wiring ----------
function wireUI(){
  ui.btnStartStudy.addEventListener("click", () => {
    startSession({
      mode: "study",
      setType: ui.studySetType.value,
      explainedOnly: ui.studyExplainedOnly.checked,
      domainFilter: ui.studyDomain.value,
      count: ui.studyCount.value
    });
  });

  ui.btnStartExam.addEventListener("click", () => {
    startSession({
      mode: "exam",
      setType: ui.examSetType.value,
      explainedOnly: ui.examExplainedOnly.checked,
      domainFilter: ui.examDomain.value,
      count: ui.examCount.value
    });
  });

  ui.btnPrev.addEventListener("click", prev);
  ui.btnNext.addEventListener("click", next);
  ui.btnQuit.addEventListener("click", quitAndGrade);
  ui.btnFlag.addEventListener("click", toggleFlag);

  ui.btnResume.addEventListener("click", () => {
    const loaded = loadSession();
    if (!loaded) return alert("No saved session found.");
    state = loaded;
    renderQuiz();
    showView("quiz");
  });

  ui.btnResetSession.addEventListener("click", () => {
    if (!confirm("Reset session? This clears only the in-progress session.")) return;
    clearSession();
    alert("Session cleared.");
  });

  ui.btnResetLearning.addEventListener("click", () => {
    if (!confirm("Reset flags & learning? This clears flagged questions and weak-area history.")) return;
    clearLearning();
    alert("Flags & learning cleared.");
  });

  ui.chkIncorrectOnly.addEventListener("change", renderResultsReview);

  ui.btnHome.addEventListener("click", () => showView("home"));
  ui.btnStartOver.addEventListener("click", () => { clearSession(); showView("home"); });

  ui.btnRefreshAudit.addEventListener("click", () => renderDomainAudit());
}

// ---------- init ----------
(async function init(){
  FLAGS = loadFlags();
  PERF = loadPerf();

  wireUI();
  const ok = await loadData();
  if (ok) showView("home");
})();
