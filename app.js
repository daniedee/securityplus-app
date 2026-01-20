// Security+ Practice: Flags + Incorrect review + Domains + Weak-area training
const DATA = { questions: [], answersById: new Map(), domainsById: new Map() };

const STORAGE_SESSION = "secplus_session_v2";
const STORAGE_FLAGS = "secplus_flags_v1";
const STORAGE_PERF  = "secplus_perf_v1";
const STORAGE_LAST_MISSED = "secplus_last_missed_v1";

const el = (id) => document.getElementById(id);

const views = { home: el("viewHome"), quiz: el("viewQuiz"), results: el("viewResults") };

const ui = {
  statusPill: el("statusPill"),

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
  btnRetestMissedStudy: el("btnRetestMissedStudy"),
  btnRetestMissedExam: el("btnRetestMissedExam"),

  modeLabel: el("modeLabel"),
  progressLabel: el("progressLabel"),
  domainLabel: el("domainLabel"),
  questionBox: el("questionBox"),
  btnPrev: el("btnPrev"),
  btnNext: el("btnNext"),
  btnQuit: el("btnQuit"),
  btnFlag: el("btnFlag"),

  resultsSummary: el("resultsSummary"),
  resultsReview: el("resultsReview"),
  chkIncorrectOnly: el("chkIncorrectOnly"),
  btnHome: el("btnHome"),
  btnStartOver: el("btnStartOver"),
};

const DOMAIN_NAMES = {
  1: "Domain 1: General Security Concepts",
  2: "Domain 2: Threats, Vulnerabilities, and Mitigations",
  3: "Domain 3: Security Architecture",
  4: "Domain 4: Security Operations",
  5: "Domain 5: Security Program Management and Oversight",
};

let FLAGS = new Set();
let PERF = {};
let state = null;


function getMissedIdsFromState(){
  if (!state) return [];
  const answeredIds = Object.keys(state.answers).map(Number);
  const missed = answeredIds.filter(id => state.answers[id]?.isCorrect === false);
  return missed.sort((a,b)=>a-b);
}
function saveLastMissed(ids){
  try { localStorage.setItem(STORAGE_LAST_MISSED, JSON.stringify(ids)); } catch {}
}
function loadLastMissed(){
  const raw = localStorage.getItem(STORAGE_LAST_MISSED);
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}
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
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#39;");
}

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
  return d ? Number(d) : null;
}
function domainMatchesFilter(id, filterValue){
  const d = getDomainForId(id);
  if (filterValue === "all") return true;
  if (filterValue === "unassigned") return d === null;
  return d === Number(filterValue);
}

// ---------- question selection ----------
function eligibleIds(explainedOnly, domainFilter){
  let ids = DATA.questions.map(q => q.id);
  if (explainedOnly) ids = ids.filter(id => DATA.answersById.has(id));
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
  return (p.wrong || 0) - (p.correct || 0);
}
function pickIdsWeak(ids, count){
  const scored = ids
    .map(id => ({id, score: weaknessScore(id)}))
    .sort((a,b) => b.score - a.score);

  if (scored.length === 0 || scored[0].score <= 0){
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
  if (setType === "incorrect"){
    const wrongIds = ids.filter(id => (PERF[id]?.wrong || 0) > 0);
    if (wrongIds.length === 0) return [];
    return pickIdsRandom(wrongIds, count);
  }
  return pickIdsRandom(ids, count);
}

// ---------- session ----------
function startSession({mode, setType, explainedOnly, domainFilter, count, idsOverride=null}){
  let ids = idsOverride ? [...idsOverride] : buildSessionIds({setType, explainedOnly, domainFilter, count});
  // keep only valid questions
  ids = ids.filter(id => DATA.questionsById.has(id));
  // honor explainedOnly filter if requested
  if (explainedOnly) ids = ids.filter(id => DATA.answersById.has(id));
  // honor domain filter if a specific domain was selected
  if (domainFilter && domainFilter !== "all") ids = ids.filter(id => domainMatchesFilter(id, domainFilter));
  // apply count
  ids = pickIdsRandom(ids, count);

  if (ids.length === 0){
    if (setType === "flagged"){
      alert("No flagged questions found for this filter. Flag a few questions first.");
    } else if (domainFilter !== "all"){
      alert("No questions match this Domain filter yet. Try 'All domains' or 'Unassigned' until domains.json is filled.");
    } else {
      alert("No questions available. Check that data/questions.json and data/answers_1_25.json are loading.");
    }
    return;
  }

  state = {
    version: 2,
    mode,
    setType,
    explainedOnly: !!explainedOnly,
    domainFilter,
    startedAt: nowISO(),
    finishedAt: null,
    ids,
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

  state.answers[questionId] = { selected: letter, isCorrect, answeredAt: new Date().toISOString() };
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

// ---------- navigation ----------
function next(){ if (state.index < state.ids.length-1){ state.index++; saveSession(); renderQuiz(); } }
function prev(){ if (state.index > 0){ state.index--; saveSession(); renderQuiz(); } }

// ---------- results ----------
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
  const missedIds = getMissedIdsFromState();
  saveLastMissed(missedIds);
  // enable/disable retest buttons
  if (ui.btnRetestMissedStudy) ui.btnRetestMissedStudy.disabled = missedIds.length === 0;
  if (ui.btnRetestMissedExam) ui.btnRetestMissedExam.disabled = missedIds.length === 0;

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

    const d = getDomainForId(id);
    const domainText = d ? DOMAIN_NAMES[d] : "Domain: Unassigned";

    const choicesHtml = ["A","B","C","D"].map(L => {
      const text = q?.choices?.[L] || "";
      const isChosen = ans?.selected === L;
      const isCorr = correct === L;
      const cls = ["reviewChoice"];
      if (isChosen) cls.push("chosen");
      if (isCorr) cls.push("correct");
      if (isChosen && correct && !isCorr) cls.push("wrong");
      return `<div class="${cls.join(" ")}"><span class="letter">${L}.</span><span class="text">${escapeHtml(text)}</span></div>`;
    }).join("");

    const card = document.createElement("div");
    card.className = "panel";
    card.innerHTML = `
      <div class="row space">
        <div><b>Q${id}</b> ${FLAGS.has(id) ? `<span class="pill warn">Flagged</span>` : ""}</div>
        <div class="pill ${correct ? (isCorrect ? "ok" : "bad") : "warn"}">${correct ? (isCorrect ? "Correct" : "Incorrect") : "Answered"}</div>
      </div>
      <div class="muted small" style="margin-top:6px">${escapeHtml(domainText)}</div>
      <div style="margin-top:8px">${escapeHtml(q?.question || "")}</div>
      <div class="reviewChoices" style="margin-top:10px">${choicesHtml}</div>
      <div class="muted" style="margin-top:10px"><b>Your answer:</b> ${ans.selected}${correct ? ` • <b>Correct:</b> ${correct}` : ""}</div>
    `;
    ui.resultsReview.appendChild(card);
  });
}

// ---------- robust data loading ----------
async function safeJson(url, fallback){
  try{
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return fallback;

    const ct = (res.headers.get("content-type") || "").toLowerCase();

    // GitHub 404 pages often return HTML; avoid JSON parse crash
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
  const domains   = await safeJson("data/domains.json", {});

  DATA.questions = questions;
  DATA.answersById = new Map(answers.map(x => [x.id, x]));
  DATA.domainsById = new Map(Object.entries(domains));

  if (DATA.questions.length === 0){
    setStatus("ERROR: questions.json not loaded. Check /data/questions.json path.", "bad");
    alert("Data load error: questions.json could not be loaded. Verify /data/questions.json exists and refresh.");
    return;
  }

  setStatus(`Loaded ${DATA.questions.length} questions • ${DATA.answersById.size} explanations`, "ok");
  setTimeout(()=>setStatus("", ""), 2200);
}

// ---------- UI wiring ----------
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

// ---------- init ----------
(async function init(){
  FLAGS = loadFlags();
  PERF = loadPerf();
  wireUI();
  await loadData();
  showView("home");
})();
