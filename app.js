// Security+ Practice: Flags + Incorrect review + Domains + Weak-area training
const DATA = {
  questions: [],
  answersById: new Map(),
  domainsById: new Map(), // id -> 1..5
};

const STORAGE_SESSION = "secplus_session_v2";
const STORAGE_FLAGS = "secplus_flags_v1";
const STORAGE_PERF  = "secplus_perf_v1";

const el = (id) => document.getElementById(id);

const views = {
  home: el("viewHome"),
  quiz: el("viewQuiz"),
  results: el("viewResults"),
};

const ui = {
  statusPill: el("statusPill"),

  // Home
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

  // Quiz
  modeLabel: el("modeLabel"),
  progressLabel: el("progressLabel"),
  domainLabel: el("domainLabel"),
  questionBox: el("questionBox"),
  btnPrev: el("btnPrev"),
  btnNext: el("btnNext"),
  btnQuit: el("btnQuit"),
  btnFlag: el("btnFlag"),

  // Results
  resultsSummary: el("resultsSummary"),
  resultsReview: el("resultsReview"),
  chkIncorrectOnly: el("chkIncorrectOnly"),
  btnHome: el("btnHome"),
  btnStartOver: el("btnStartOver"),
};

// Persistent “learning engine” stores
let FLAGS = new Set();               // flagged question IDs
let PERF = {};                       // id -> {correct, wrong}
let state = null;                    // current session

const DOMAIN_NAMES = {
  1: "Domain 1: General Security Concepts",
  2: "Domain 2: Threats, Vulnerabilities, and Mitigations",
  3: "Domain 3: Security Architecture",
  4: "Domain 4: Security Operations",
  5: "Domain 5: Security Program Management and Oversight",
};

// ---------- Helpers ----------
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

// ---------- Storage ----------
function saveSession(){ if (state) localStorage.setItem(STORAGE_SESSION, JSON.stringify(state)); }
function loadSession(){
  const raw = localStorage.getItem(STORAGE_SESSION);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function clearSession(){
  localStorage.removeItem(STORAGE_SESSION);
  state = null;
}

function saveFlags(){
  localStorage.setItem(STORAGE_FLAGS, JSON.stringify([...FLAGS]));
}
function loadFlags(){
  const raw = localStorage.getItem(STORAGE_FLAGS);
  if (!raw) return new Set();
  try { return new Set(JSON.parse(raw)); } catch { return new Set(); }
}

function savePerf(){
  localStorage.setItem(STORAGE_PERF, JSON.stringify(PERF));
}
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

// ---------- Domain resolution ----------
function getDomainForId(id){
  const pack = DATA.answersById.get(id);
  if (pack && pack.domain) return pack.domain;              // if you later add pack.domain
  const d = DATA.domainsById.get(String(id));
  return d ? Number(d) : null;
}

function domainMatchesFilter(id, filterValue){
  const d = getDomainForId(id);
  if (filterValue === "all") return true;
  if (filterValue === "unassigned") return d === null;
  return d === Number(filterValue);
}

// ---------- Question set building ----------
function eligibleIds(explainedOnly, domainFilter){
  let ids = DATA.questions.map(q => q.id);

  if (explainedOnly){
    ids = ids.filter(id => DATA.answersById.has(id));
  }
  ids = ids.filter(id => domainMatchesFilter(id, domainFilter));
  return ids;
}

function pickIdsRandom(ids, count){
  const shuffled = shuffle([...ids]);
  if (count === "all") return shuffled;
  const n = Math.min(parseInt(count,10), shuffled.length);
  return shuffled.slice(0, n);
}

function pickIdsFlagged(ids, count){
  const flagged = ids.filter(id => FLAGS.has(id));
  if (flagged.length === 0) return [];
  return pickIdsRandom(flagged, count);
}

function weaknessScore(id){
  const p = PERF[id];
  if (!p) return 0;
  // prioritizes wrong answers; correct reduces priority
  return (p.wrong || 0) - (p.correct || 0);
}

function pickIdsWeak(ids, count){
  // Sort by highest weakness score, then randomize within that sorted order a bit
  const scored = ids
    .map(id => ({id, score: weaknessScore(id)}))
    .sort((a,b) => b.score - a.score);

  // If user has no wrong history, fallback to random
  if (scored.length === 0 || (scored[0].score <= 0)){
    return pickIdsRandom(ids, count);
  }

  const ordered = scored.map(x => x.id);
  if (count === "all") return ordered;
  const n = Math.min(parseInt(count,10), ordered.length);
  return ordered.slice(0, n);
}

function buildSessionIds({setType, explainedOnly, domainFilter, count}){
  const ids = eligibleIds(explainedOnly, domainFilter);

  if (ids.length === 0) return [];

  if (setType === "flagged") return pickIdsFlagged(ids, count);
  if (setType === "weak") return pickIdsWeak(ids, count);
  return pickIdsRandom(ids, count); // random
}

// ---------- Session ----------
function startSession({mode, setType, explainedOnly, domainFilter, count}){
  const ids = buildSessionIds({setType, explainedOnly, domainFilter, count});

  if (ids.length === 0){
    if (setType === "flagged"){
      alert("No flagged questions found for this filter. Flag a few questions first.");
    } else {
      alert("No questions available for this filter.");
    }
    return;
  }

  state = {
    version: 2,
    mode,                 // "study" | "exam"
    setType,              // "random" | "flagged" | "weak"
    explainedOnly: !!explainedOnly,
    domainFilter,         // "all" | "1".."5" | "unassigned"
    startedAt: nowISO(),
    finishedAt: null,
    ids,
    index: 0,
    answers: {},          // { [id]: { selected, isCorrect, answeredAt } }
  };

  saveSession();
  renderQuiz();
  showView("quiz");
}

function currentQuestion(){
  const id = state.ids[state.index];
  return DATA.questions.find(q => q.id === id);
}

// ---------- Flagging ----------
function updateFlagButton(){
  const q = currentQuestion();
  if (!q) return;
  const isFlagged = FLAGS.has(q.id);
  ui.btnFlag.textContent = isFlagged ? "Unflag" : "Flag";
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

// ---------- Quiz Rendering ----------
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
  ui.progressLabel.textContent = `Question ${state.index+1} of ${state.ids.length} • Answered ${answeredCount}`;

  const d = getDomainForId(q.id);
  ui.domainLabel.textContent = d ? DOMAIN_NAMES[d] : "Domain: Unassigned";

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

  // explanation only after selection exists
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

  // Update performance stats (weak-area engine)
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

  box.innerHTML = `
    <div><b>Correct answer:</b> ${pack.correctAnswer}</div>
    <div style="margin-top:8px">${escapeHtml(pack.explanation || "")}</div>
    <hr/>
    <b>Feedback:</b>
    <div class="stack" style="margin-top:8px">
      ${["A","B","C","D"].map(L => `
        <div class="panel">
          <div class="row space">
            <div><b>${L}</b></div>
            <div class="pill ${L===pack.correctAnswer ? "ok" : ""}">${L===pack.correctAnswer ? "Correct" : "Not correct"}</div>
          </div>
          <div class="muted" style="margin-top:6px">${escapeHtml(pack.feedback?.[L] || "")}</div>
        </div>
      `).join("")}
    </div>
  `;
  ui.questionBox.appendChild(box);
}

// ---------- Navigation ----------
function next(){ if (state.index < state.ids.length-1){ state.index++; saveSession(); renderQuiz(); } }
function prev(){ if (state.index > 0){ state.index--; saveSession(); renderQuiz(); } }

// ---------- Results ----------
function gradeAnswered(){
  const answered = Object.values(state.answers);
  const answeredCount = answered.length;
  const correctCount = answered.filter(a => a.isCorrect).length;
  const score = answeredCount ? (correctCount / answeredCount) : null;
  return { answeredCount, correctCount, score };
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
      <span class="pill">Session total: ${state.ids.length}</span>
      <span class="pill">Answered: ${answeredCount}</span>
      <span class="pill ${score===null ? "" : score>=0.8 ? "ok" : score>=0.6 ? "warn" : "bad"}">
        ${score===null ? "Score: N/A" : `Score: ${(score*100).toFixed(1)}%`}
      </span>
      <span class="pill">${score===null ? "" : `Correct: ${correctCount}/${answeredCount}`}</span>
    </div>
    <div class="muted small" style="margin-top:10px">
      Quit anytime: score is based only on answered questions.
    </div>
  `;

  renderResultsReview();
}

function renderResultsReview(){
  ui.resultsReview.innerHTML = "";

  const incorrectOnly = ui.chkIncorrectOnly.checked;

  const answeredIds = Object.keys(state.answers).map(Number).sort((a,b)=>a-b);

  const filteredIds = answeredIds.filter(id => {
    const pack = DATA.answersById.get(id);
    const correct = pack?.correctAnswer || null;
    const ans = state.answers[id];
    if (!incorrectOnly) return true;
    if (!correct) return false;
    return ans.selected !== correct;
  });

  if (filteredIds.length === 0){
    ui.resultsReview.innerHTML = `<div class="panel muted">No items to review for this filter.</div>`;
    return;
  }

  filteredIds.forEach(id => {
    const q = DATA.questions.find(x => x.id === id);
    const pack = DATA.answersById.get(id);
    const ans = state.answers[id];

    const correct = pack?.correctAnswer;
    const isCorrect = correct ? ans.selected === correct : false;

    const card = document.createElement("div");
    card.className = "panel";

    const d = getDomainForId(id);
    const domainText = d ? DOMAIN_NAMES[d] : "Domain: Unassigned";

    card.innerHTML = `
      <div class="row space">
        <div><b>Q${id}</b> ${FLAGS.has(id) ? `<span class="pill warn">Flagged</span>` : ""}</div>
        <div class="pill ${correct ? (isCorrect ? "ok" : "bad") : "warn"}">${correct ? (isCorrect ? "Correct" : "Incorrect") : "Answered"}</div>
      </div>
      <div class="muted small" style="margin-top:6px">${escapeHtml(domainText)}</div>
      <div style="margin-top:8px">${escapeHtml(q?.question || "")}</div>
      <div class="muted" style="margin-top:8px"><b>Your answer:</b> ${ans.selected}${correct ? ` • <b>Correct:</b> ${correct}` : ""}</div>
    `;
    ui.resultsReview.appendChild(card);
  });
}

// ---------- Data Loading ----------
async function loadData(){
  setStatus("Loading data…", "warn");

  const [qRes, aRes, dRes] = await Promise.all([
    fetch("data/questions.json"),
    fetch("data/answers_1_25.json"),
    fetch("data/domains.json"),
  ]);

  DATA.questions = await qRes.json();
  const answers = await aRes.json();
  const domains = await dRes.json();

  DATA.answersById = new Map(answers.map(x => [x.id, x]));
  DATA.domainsById = new Map(Object.entries(domains)); // keys are strings

  setStatus(`Loaded ${DATA.questions.length} questions • ${DATA.answersById.size} explanations`, "ok");
  setTimeout(()=>setStatus("", ""), 2000);
}

// ---------- UI Wiring ----------
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
}

(async function init(){
  FLAGS = loadFlags();
  PERF = loadPerf();

  wireUI();
  await loadData();
  showView("home");
})();
