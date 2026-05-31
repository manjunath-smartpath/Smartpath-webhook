// ============================================================
// SECTION 8b: QUIZ ENGINE
// Smartpath Kalike Phase 3
// ============================================================
// MCQ one-by-one with instant feedback + score tracking.
// Uses same getCurrentSections() logic to pick MCQ source:
//   topic tap → topic MCQ ; subtopic tap → subtopic MCQ ;
//   chapter → chapter MCQ
// 4 options → LIST message (reply buttons max 3).
// ============================================================

const N = require('./notesLoader');
const S = require('./sendHelpers');
const C = require('./contentDisplay');  // for getCurrentSections

// ============================================================
// START QUIZ — load MCQ list, show intro
// ============================================================
async function startQuiz(to, st) {
  const { sections, label } = C.getCurrentSections(st);
  const mcqList = N.collectMCQ(sections);

  if (!mcqList.length) {
    await S.sendText(to, 'ℹ️ ಈ topic ಗೆ quiz (MCQ) ಸಿಗಲಿಲ್ಲ.');
    return;
  }

  st.quizList = mcqList;
  st.quizIndex = 0;
  st.quizScore = 0;
  st.quizResults = [];   // [{n, correct}]
  st.quizLabel = label;
  st.flow = 'quiz';

  await S.sendButtons(to,
    `📝 *Quiz: ${label}*\n${mcqList.length} questions ಇದೆ. Ready?`,
    [
      { id: 'QUIZ_START', title: '✅ Start' },
      { id: 'NAV_BACK', title: '🔙 Back' }
    ]);
}

// ============================================================
// SEND ONE QUESTION (as list message — 4 options)
// ============================================================
async function sendQuizQuestion(to, st) {
  const q = st.quizList[st.quizIndex];
  const total = st.quizList.length;
  const n = st.quizIndex + 1;

  const diff = q.difficulty ? ` [${q.difficulty}]` : '';
  const body = `📝 *Q${n}/${total}*${diff}\n\n${q.question}`;

  // Build option rows (A/B/C/D)
  const rows = ['A', 'B', 'C', 'D']
    .filter(k => q.options && q.options[k] !== undefined)
    .map(k => ({
      id: `QUIZ_ANS_${k}`,
      title: `${k}) ${q.options[k]}`.substring(0, 24),
      description: q.options[k].length > 18 ? q.options[k].substring(0, 70) : undefined
    }));

  await S.sendList(to, body, 'Select Answer', rows, `Question ${n}`);
}

// ============================================================
// HANDLE ANSWER — instant feedback + explanation
// ============================================================
async function handleQuizAnswer(to, st, chosenLetter) {
  const q = st.quizList[st.quizIndex];
  const total = st.quizList.length;
  const n = st.quizIndex + 1;
  const correct = (chosenLetter === q.answer);

  if (correct) st.quizScore++;
  st.quizResults.push({ n, correct });

  // Clean explanation trailing separators
  const expl = String(q.explanation || '').replace(/[\s\-=_]+$/, '').trim();

  let msg;
  if (correct) {
    msg = `✅ *ಸರಿ! Correct!*\n\n`;
  } else {
    msg = `❌ *ತಪ್ಪು. Wrong.*\nಸರಿ ಉತ್ತರ / Correct: *${q.answer}) ${q.options[q.answer]}*\n\n`;
  }
  if (expl) msg += `💡 ${expl}\n\n`;
  msg += `📊 Score: ${st.quizScore}/${n}`;

  await S.sendText(to, msg.substring(0, 4000));

  // Next or finish
  if (st.quizIndex < total - 1) {
    await S.sendButtons(to, `${n}/${total} ಮುಗಿಯಿತು. ಮುಂದಿನ ಪ್ರಶ್ನೆ?`, [
      { id: 'QUIZ_NEXT', title: '➡️ Next Question' },
      { id: 'NAV_BACK', title: '🔙 Back' }
    ]);
  } else {
    await showQuizResult(to, st);
  }
}

// ============================================================
// NEXT QUESTION
// ============================================================
async function nextQuizQuestion(to, st) {
  if (!st.quizList || st.quizIndex >= st.quizList.length - 1) {
    await showQuizResult(to, st);
    return;
  }
  st.quizIndex++;
  await sendQuizQuestion(to, st);
}

// ============================================================
// FINAL RESULT
// ============================================================
async function showQuizResult(to, st) {
  const total = st.quizList.length;
  const score = st.quizScore;
  const pct = Math.round((score / total) * 100);

  // Star rating
  const stars = '⭐'.repeat(Math.max(1, Math.round(pct / 20)));

  // Encouragement
  let remark;
  if (pct >= 80) remark = 'ಅದ್ಭುತ! Excellent! 🎉';
  else if (pct >= 60) remark = 'ಒಳ್ಳೆಯದು! Good! 👍';
  else if (pct >= 40) remark = 'ಪರವಾಗಿಲ್ಲ. Keep practicing! 💪';
  else remark = 'ಇನ್ನೂ ಅಭ್ಯಾಸ ಬೇಕು. Try again! 📚';

  const correctNs = st.quizResults.filter(r => r.correct).map(r => 'Q' + r.n);
  const wrongNs = st.quizResults.filter(r => !r.correct).map(r => 'Q' + r.n);

  let msg = `🎉 *Quiz Complete!*\n\n`;
  msg += `📊 Score: *${score}/${total}* (${pct}%)\n${stars}\n\n`;
  msg += `${remark}\n\n`;
  if (correctNs.length) msg += `✅ Correct: ${correctNs.join(', ')}\n`;
  if (wrongNs.length) msg += `❌ Wrong: ${wrongNs.join(', ')}`;

  await S.sendText(to, msg);

  await S.sendButtons(to, 'ಮುಂದೇನು? / What next?', [
    { id: 'QUIZ_RETRY', title: '🔄 Retry Quiz' },
    { id: 'NAV_BACK', title: '📋 Topics' },
    { id: 'NAV_MENU', title: '🏠 Menu' }
  ]);
}

// ============================================================
// RETRY — reset same quiz
// ============================================================
async function retryQuiz(to, st) {
  st.quizIndex = 0;
  st.quizScore = 0;
  st.quizResults = [];
  st.flow = 'quiz';
  await sendQuizQuestion(to, st);
}

module.exports = {
  startQuiz,
  sendQuizQuestion,
  handleQuizAnswer,
  nextQuizQuestion,
  showQuizResult,
  retryQuiz
};
