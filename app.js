// Security+ Practice (Mobile-friendly)
// Features: Study + Exam, Quit-anytime grading, Random sessions,
// Flag questions + Review flagged, Weak-area training, Review incorrect-only.
// No Domains in this build (stable, fewer moving parts).

const DATA = { questions: [], answersById: new Map() };

const STORAGE_SESSION = "secplus_session_v3";
const STORAGE_FLAGS   = "secplus_flags_v2";
const STORAGE_PERF    = "secplus_perf_v2";

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
  studyCount: el("studyCount"),
  btnStartStudy: el("btnStartStudy"),

  examExplainedOnly: el("examExplainedOnly"),
  examSetType: el("examSetType"),
  examCount: el("examCount"),
  btnStartExam: el("btnStartExam"),

  btnResume: el("btnResume"),
  btnResetSession: el("btnResetSession"),
  btnResetLearning: el("btnResetLearning"),

  // Quiz controls
  modeLabel: el("modeLabel"),
  progressLabel: el("progressLabel"),
  questionBox: el("questionBox"),
  btnPrev: el("btnPrev"),
  btnNext: el("btnNext"),
  btnQuit: el("btnQuit"),
  btnFlag: el("btnFlag"),

  // Results controls
  resultsSummary: el("resultsSummary"),
  chkIncorrectOnly: el("chkIncorrectOnly"),
  resultsReview: el("resultsReview"),
  btnHome: el("btnHome"),
  btnStartOver: el("btnStartOver"),
};

let state = null;          // current session state
let FLAGS = new Set();     // flagged question IDs
let PERF = {};             // performance stats: { [id]: { correct, wrong } }

// ---------------- helpers ----------------
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

// ---------------- storage ----------------
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

// ---------------- selection logic ----------------
function eligibleIds(explainedOnly){
  let ids = DATA.questions.map(q => q.id);
  if (explainedOnly){
    ids = ids.filter(id => DATA.answersById.has(id));
  }
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
  return (p.wrong || 0) - (p.correct || 0);
}

function pickIdsWeak(ids, count){
  const scored = ids
    .map(id => ({ id, score: weaknessScore(id) }))
    .sort((a,b) => b.score - a.score);

  // If user has no wrong history, fall back to random
  if (scored.length === 0 || scored[0].score <= 0){
    return pickIdsRandom(ids, count);
  }

  const ordered = scored.map(x => x.id);
  if (count === "all") return ordered;
  const n = Math.min(parseInt(count,10), ordered.length);
  return ordered.slice(0, n);
}

function buildSessionIds({ setType, explainedOnly, count }){
  const ids = eligibleIds(explainedOnly);
  if (ids.length === 0) return [];

  if (setType === "flagged") return pickIdsFlagged(ids, count);
  if (setType === "weak") return pickIdsWeak(ids, count);
  return pickIdsRandom(ids, count);
}

// ---------------- session ----------------
function startSession({ mode, setType, explainedOnly, count }){
  const ids = buildSessionIds({ setType, explainedOnly, count });

  if (ids.length === 0){
    if (setType === "flagged"){
      alert("No flagged questions found. Start a session and flag a few questions first.");
    } else {
      alert("No questions available. Make sure data/questions.json and data/answers_1_25.json are loading correctly.");
    }
    return;
  }

  state = {
    version: 3,
    mode,            // "study" | "exam"
    setType,         // "random" | "flagged" | "weak"
    explainedOnly: !!explainedOnly,
    startedAt: nowISO(),
    finishedAt: null,
    ids,
    index: 0,
    answers: {}      // { [id]: { selected, isCorrect, answeredAt } }
  };

  saveSession();
  renderQuiz();
  showView("quiz");
}

function currentQuestion(){
  const id = state.ids[state.index];
  return DATA.questions.find(q => q.id === id);
}

// ---------------- flagging ----------------
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

// ---------------- quiz rendering ----------------
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

  // Explanation/feedback only after selection exists
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

  // Update weak-area stats (only if we know correct answer)
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

  // Keeps the result strip visible on mobile after answer
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------- navigation ----------------
function next(){
  if (state.index < state.ids.length - 1){
    state.index++;
    saveSession();
    renderQuiz();
  }
}
function prev(){
  if (state.index > 0){
    state.index--;
    saveSession();
    renderQuiz();
  }
}

// ---------------- results ----------------
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
      <div style="margin-top:8px">${escapeHtml(q?.question || "")}</div>
      <div class="muted" style="margin-top:8px">
        <b>Your answer:</b> ${ans.selected}${correct ? ` • <b>Correct:</b> ${correct}` : ""}
      </div>
    `;
    ui.resultsReview.appendChild(card);
  });
}

// ---------------- data loading ----------------
async function safeJson(url, fallback){
  try{
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return fallback;

    const ct = (res.headers.get("content-type") || "").toLowerCase();

    // If server returns HTML (like a 404 page), avoid JSON parsing crash
    if (url.endsWith(".json") && !ct.includes("application/json") && !ct.includes("text/json")){
      const text = await res.text();
      if (text.trim().startsWith("<")) return fallback;
      try { return JSON.parse(text); } catch { return fallback; }
    }

    return await res.json();
  } catch {
    return fallback;
  }
}

async function loadData(){
  setStatus("Loading data…", "warn");

  const questions = await safeJson("data/questions.json", []);
  const answers   = await safeJson("data/answers_1_25.json", []);

  DATA.questions = questions;
  DATA.answersById = new Map(answers.map(x => [x.id, x]));

  if (DATA.questions.length === 0){
    setStatus("ERROR: questions.json not loaded. Check /data/questions.json path.", "bad");
    alert("Data load error: questions.json could not be loaded. Verify /data/questions.json exists and refresh.");
    return false;
  }

  setStatus(`Loaded ${DATA.questions.length} questions • ${DATA.answersById.size} explanations`, "ok");
  setTimeout(()=>setStatus("", ""), 2000);
  return true;
}

// ---------------- wiring ----------------
function wireUI(){
  ui.btnStartStudy.addEventListener("click", () => {
    startSession({
      mode: "study",
      setType: ui.studySetType.value,
      explainedOnly: ui.studyExplainedOnly.checked,
      count: ui.studyCount.value
    });
  });

  ui.btnStartExam.addEventListener("click", () => {
    startSession({
      mode: "exam",
      setType: ui.examSetType.value,
      explainedOnly: ui.examExplainedOnly.checked,
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

// ---------------- init ----------------
(async function init(){
  FLAGS = loadFlags();
  PERF = loadPerf();

  wireUI();
  const ok = await loadData();
  if (ok) showView("home");
})();
