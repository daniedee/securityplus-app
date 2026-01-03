const DATA = { questions: [], answersById: new Map() };
const STORAGE_KEY = "secplus_mvp_state_v1";
const el = (id) => document.getElementById(id);

const views = {
  home: el("viewHome"),
  quiz: el("viewQuiz"),
  results: el("viewResults"),
};

const ui = {
  statusPill: el("statusPill"),
  modeLabel: el("modeLabel"),
  progressLabel: el("progressLabel"),
  questionBox: el("questionBox"),
  resultsSummary: el("resultsSummary"),
  resultsReview: el("resultsReview"),
  btnPrev: el("btnPrev"),
  btnNext: el("btnNext"),
};

let state = null;

function showView(name){
  Object.entries(views).forEach(([k,v]) => v.classList.toggle("hidden", k !== name));
}

function setStatus(text, kind){
  ui.statusPill.textContent = text || "";
  ui.statusPill.className = "pill " + (kind || "");
  ui.statusPill.classList.toggle("hidden", !text);
}

function saveState(){ if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function resetState(){ localStorage.removeItem(STORAGE_KEY); state = null; }

function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function nowISO(){ return new Date().toISOString(); }

function computeEligibleIds(explainedOnly){
  const allIds = DATA.questions.map(q => q.id);
  if (!explainedOnly) return allIds;
  return allIds.filter(id => DATA.answersById.has(id));
}
function pickSessionIds(eligible, count){
  const ids = shuffle([...eligible]);
  if (count === "all") return ids;
  const n = Math.min(parseInt(count,10), ids.length);
  return ids.slice(0, n);
}

function startSession(mode, count, explainedOnly){
  const eligible = computeEligibleIds(explainedOnly);
  const sessionIds = pickSessionIds(eligible, count);

  state = {
    mode, startedAt: nowISO(), finishedAt: null,
    ids: sessionIds, index: 0,
    answers: {} // { [id]: { selected, isCorrect, answeredAt } }
  };
  saveState();
  renderQuiz();
  showView("quiz");
}

function currentQuestion(){
  const id = state.ids[state.index];
  return DATA.questions.find(q => q.id === id);
}

function renderQuiz(){
  const q = currentQuestion();
  if (!q){ ui.questionBox.innerHTML = "<p>No questions available.</p>"; return; }

  ui.modeLabel.textContent = state.mode === "study" ? "Study mode" : "Exam mode";
  ui.modeLabel.className = "pill " + (state.mode === "study" ? "ok" : "warn");

  const answeredCount = Object.keys(state.answers).length;
  ui.progressLabel.textContent = `Question ${state.index+1} of ${state.ids.length} • Answered ${answeredCount}`;

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
    renderExplanation(q.id); // ✅ only after selection exists
  }

  ui.btnPrev.disabled = state.index === 0;
  ui.btnNext.disabled = state.index >= state.ids.length - 1;
}

function onSelect(questionId, letter){
  const pack = DATA.answersById.get(questionId);
  const correct = pack?.correctAnswer || null;
  const isCorrect = correct ? (letter === correct) : false;

  state.answers[questionId] = { selected: letter, isCorrect, answeredAt: nowISO() };
  saveState();
  renderQuiz();
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

function next(){ if (state.index < state.ids.length-1){ state.index++; saveState(); renderQuiz(); } }
function prev(){ if (state.index > 0){ state.index--; saveState(); renderQuiz(); } }

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
  saveState();
  renderResults();
  showView("results");
}

function renderResults(){
  const { answeredCount, correctCount, score } = gradeAnswered();

  ui.resultsSummary.innerHTML = `
    <div class="row wrap">
      <span class="pill">${state.mode === "study" ? "Study" : "Exam"}</span>
      <span class="pill">Session total: ${state.ids.length}</span>
      <span class="pill">Answered: ${answeredCount}</span>
      <span class="pill ${score===null ? "" : score>=0.8 ? "ok" : score>=0.6 ? "warn" : "bad"}">
        ${score===null ? "Score: N/A" : `Score: ${(score*100).toFixed(1)}%`}
      </span>
      <span class="pill">${score===null ? "" : `Correct: ${correctCount}/${answeredCount}`}</span>
    </div>
  `;

  ui.resultsReview.innerHTML = "";
  Object.keys(state.answers).map(Number).sort((a,b)=>a-b).forEach(id => {
    const q = DATA.questions.find(x => x.id === id);
    const pack = DATA.answersById.get(id);
    const ans = state.answers[id];

    const correct = pack?.correctAnswer;
    const isCorrect = correct ? ans.selected === correct : false;

    const card = document.createElement("div");
    card.className = "panel";
    card.innerHTML = `
      <div class="row space">
        <div><b>Q${id}</b></div>
        <div class="pill ${correct ? (isCorrect ? "ok" : "bad") : "warn"}">${correct ? (isCorrect ? "Correct" : "Incorrect") : "Answered"}</div>
      </div>
      <div style="margin-top:8px">${escapeHtml(q?.question || "")}</div>
      <div class="muted" style="margin-top:8px"><b>Your answer:</b> ${ans.selected}${correct ? ` • <b>Correct:</b> ${correct}` : ""}</div>
    `;
    ui.resultsReview.appendChild(card);
  });
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#39;");
}

async function loadData(){
  setStatus("Loading data…", "warn");
  const [qRes, aRes] = await Promise.all([
    fetch("data/questions.json"),
    fetch("data/answers_1_25.json"),
  ]);
  DATA.questions = await qRes.json();
  const answers = await aRes.json();
  DATA.answersById = new Map(answers.map(x => [x.id, x]));

  setStatus(`Loaded ${DATA.questions.length} questions • ${DATA.answersById.size} explanations`, "ok");
  setTimeout(()=>setStatus("", ""), 2000);
}

function wireUI(){
  el("btnStartStudy").addEventListener("click", () =>
    startSession("study", el("studyCount").value, el("studyExplainedOnly").checked)
  );
  el("btnStartExam").addEventListener("click", () =>
    startSession("exam", el("examCount").value, el("examExplainedOnly").checked)
  );

  el("btnPrev").addEventListener("click", prev);
  el("btnNext").addEventListener("click", next);
  el("btnQuit").addEventListener("click", quitAndGrade);

  el("btnHome").addEventListener("click", () => showView("home"));
  el("btnStartOver").addEventListener("click", () => { state = null; saveState(); showView("home"); });

  el("btnResume").addEventListener("click", () => {
    const loaded = loadState();
    if (!loaded) return alert("No saved session found.");
    state = loaded; renderQuiz(); showView("quiz");
  });

  el("btnReset").addEventListener("click", () => {
    if (!confirm("Reset saved data?")) return;
    resetState(); alert("Saved data cleared.");
  });
}

(async function init(){
  wireUI();
  await loadData();
  showView("home");
})();
