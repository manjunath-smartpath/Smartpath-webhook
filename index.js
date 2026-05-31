// ============================================================
// SECTION 1 + 3 + 9: SETUP + STATE + WEBHOOK ROUTER
// Smartpath Kalike Phase 3 — main index.js core
// ============================================================

const express = require('express');
const N = require('./notesLoader');
const S = require('./sendHelpers');
const NAV = require('./navigation');
const C = require('./contentDisplay');
const Q = require('./quizEngine');
const G = require('./sheetAndGpt');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Load all notes at startup
N.loadAllNotes();

// ============================================================
// WEBHOOK VERIFY (GET)
// ============================================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============================================================
// WEBHOOK RECEIVE (POST)
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    if (!message) return;

    const from = message.from;

    // Extract text OR interactive reply id
    let userText = null;
    let replyId = null;
    if (message.type === 'text') {
      userText = message.text.body.trim();
    } else if (message.type === 'interactive') {
      const it = message.interactive;
      replyId = it.button_reply?.id || it.list_reply?.id || null;
    } else {
      return; // ignore other types
    }

    // ---- Get / create student ----
    let student = await G.getStudent(from);
    if (!student) {
      await G.saveNewStudent(from);
      await S.sendText(from,
        `🙏 ನಮಸ್ಕಾರ! Smartpath Kalike ಗೆ ಸ್ವಾಗತ 🎓\n\nನಿಮ್ಮ ಹೆಸರು ಹೇಳಿ / Your name:`);
      return;
    }

    // ---- Registration flow ----
    const step = student.get('Registration_Step');
    if (step && step !== 'COMPLETE') {
      await handleRegistration(from, student, step, userText, replyId);
      return;
    }

    // ---- Access check (TRIAL valid / ACTIVE) ----
    if (!G.hasAccess(student)) {
      // Auto-block expired trials
      if (G.getStatus(student) === 'TRIAL' && G.isExpired(student)) {
        await G.updateStudent(student, 'Status', 'BLOCKED');
      }
      await S.sendButtons(from,
        `⏰ ನಿಮ್ಮ trial/plan ಮುಗಿದಿದೆ!\n\n💰 Upgrade: ₹99 / ₹199 / ₹299\n📞 7019068606`,
        [{ id: 'NAV_MENU', title: '🔄 Try Again' }]);
      return;
    }

    const cls = String(student.get('Class') || '').replace(/[^\d]/g, '') || '8';

    // ---- Interactive (button/list tap) routing ----
    if (replyId) {
      await routeInteractive(from, student, cls, replyId);
      return;
    }

    // ---- Text handling ----
    if (userText) {
      const lower = userText.toLowerCase();
      // Menu triggers
      if (['hi', 'hello', 'menu', 'start', 'ಮೆನು', 'hai', 'hey'].includes(lower)) {
        await NAV.showMainMenu(from, cls);
        return;
      }
      // Otherwise = a typed question → GPT (₹299 only)
      await handleTypedQuestion(from, student, cls, userText);
      return;
    }
  } catch (err) {
    console.error('Webhook error:', err.response?.data || err.message);
  }
});

// ============================================================
// REGISTRATION FLOW
// ============================================================
async function handleRegistration(from, student, step, userText, replyId) {
  if (step === 'PENDING_NAME') {
    if (!userText) { await S.sendText(from, 'ದಯವಿಟ್ಟು ಹೆಸರು type ಮಾಡಿ:'); return; }
    await G.updateStudent(student, 'Name', userText);
    await G.updateStudent(student, 'Registration_Step', 'PENDING_CLASS');
    await S.sendButtons(from, `ನಮಸ್ಕಾರ ${userText}! 😊\nಯಾವ class? / Which class?`, [
      { id: 'REG_CLASS_8', title: '8ನೇ / Class 8' },
      { id: 'REG_CLASS_9', title: '9ನೇ / Class 9' },
      { id: 'REG_CLASS_10', title: '10ನೇ / Class 10' }
    ]);
    return;
  }

  if (step === 'PENDING_CLASS') {
    let cls = null;
    if (replyId && replyId.startsWith('REG_CLASS_')) cls = replyId.replace('REG_CLASS_', '');
    else if (userText && ['8','9','10'].includes(userText.trim())) cls = userText.trim();
    if (!cls) {
      await S.sendButtons(from, '⚠️ Class ಆರಿಸಿ:', [
        { id: 'REG_CLASS_8', title: '8ನೇ / Class 8' },
        { id: 'REG_CLASS_9', title: '9ನೇ / Class 9' },
        { id: 'REG_CLASS_10', title: '10ನೇ / Class 10' }
      ]);
      return;
    }
    await G.updateStudent(student, 'Class', cls);
    await G.updateStudent(student, 'Registration_Step', 'PENDING_SCHOOL');
    await S.sendText(from, `${cls}ನೇ ತರಗತಿ ✅\n\nಶಾಲೆಯ ಹೆಸರು? / School name:`);
    return;
  }

  if (step === 'PENDING_SCHOOL') {
    if (!userText) { await S.sendText(from, 'ಶಾಲೆಯ ಹೆಸರು type ಮಾಡಿ:'); return; }
    await G.updateStudent(student, 'School', userText);
    await G.updateStudent(student, 'Registration_Step', 'PENDING_CITY');
    await S.sendText(from, `${userText} ✅\n\nಊರು? / City:`);
    return;
  }

  if (step === 'PENDING_CITY') {
    if (!userText) { await S.sendText(from, 'ಊರು type ಮಾಡಿ:'); return; }
    await G.updateStudent(student, 'City', userText);
    await G.updateStudent(student, 'Registration_Step', 'COMPLETE');
    const cls = String(student.get('Class') || '').replace(/[^\d]/g,'') || '8';
    await S.sendText(from,
      `🎉 ನೋಂದಣಿ ಪೂರ್ಣ! / Registered!\n\n` +
      `✅ 2 ದಿನ FREE Trial ಶುರು!\n\nಈಗ ಕಲಿಯೋಣ! 📚`);
    await NAV.showMainMenu(from, cls);
    return;
  }
}

// ============================================================
// INTERACTIVE ROUTING (button/list ID → action)
// ============================================================
async function routeInteractive(from, student, cls, id) {
  const st = NAV.getState(from);
  st.cls = cls;

  // --- Subject ---
  if (id === 'SUBJ_Maths') return NAV.showParts(from, 'Maths');
  if (id === 'SUBJ_Science') return NAV.showParts(from, 'Science');

  // --- Part ---
  if (id === 'PART_1') return NAV.showChapters(from, '1');
  if (id === 'PART_2') return NAV.showChapters(from, '2');

  // --- Chapter selected ---
  if (id.startsWith('CH_')) {
    const ch = id.replace('CH_', '');
    return NAV.showChapterMenu(from, ch);
  }

  // --- Chapter-level content menu ---
  if (id === 'CHCONTENT_TOPICS') return NAV.showTopics(from, st.ch);
  if (id === 'CHCONTENT_NOTES') { st.contentSource = 'chapter'; st.topicIndex=null; st.subtopicIndex=null; return C.showNotes(from, st); }
  if (id === 'CHCONTENT_QA')    { st.contentSource = 'chapter'; st.topicIndex=null; st.subtopicIndex=null; return C.startQA(from, st); }
  if (id === 'CHCONTENT_QUIZ')  { st.contentSource = 'chapter'; st.topicIndex=null; st.subtopicIndex=null; return Q.startQuiz(from, st); }

  // --- Topic selected ---
  if (id.startsWith('TOPIC_')) {
    const idx = parseInt(id.replace('TOPIC_', ''), 10);
    st.contentSource = null;
    return NAV.showTopicMenu(from, idx);
  }

  // --- Sub-topic list / selected ---
  if (id === 'CONTENT_SUBTOPICS') return NAV.showSubtopics(from);
  if (id.startsWith('SUBTOPIC_')) {
    const idx = parseInt(id.replace('SUBTOPIC_', ''), 10);
    return NAV.showSubtopicMenu(from, idx);
  }

  // --- Content type (Notes / Q&A / Quiz) ---
  if (id === 'CONTENT_NOTES')  { st.contentSource = null; return C.showNotes(from, st); }
  if (id === 'CONTENT_QA')     { st.contentSource = (st.contentSource==='chapter')?'chapter':null; return C.startQA(from, st); }
  if (id === 'CONTENT_QUIZ')   { return Q.startQuiz(from, st); }

  // --- Notes follow-ups ---
  if (id === 'NOTES_ACTIVITY') return C.showActivity(from, st);
  if (id === 'NOTES_DIAGRAMS') return C.showDiagrams(from, st);

  // --- Q&A next ---
  if (id === 'QA_NEXT') return C.nextQA(from, st);

  // --- Quiz ---
  if (id === 'QUIZ_START') return Q.sendQuizQuestion(from, st);
  if (id.startsWith('QUIZ_ANS_')) {
    const letter = id.replace('QUIZ_ANS_', '');
    return Q.handleQuizAnswer(from, st, letter);
  }
  if (id === 'QUIZ_NEXT') return Q.nextQuizQuestion(from, st);
  if (id === 'QUIZ_RETRY') return Q.retryQuiz(from, st);

  // --- Navigation ---
  if (id === 'NAV_BACK') return NAV.handleBack(from);
  if (id === 'NAV_MENU') return NAV.showMainMenu(from, cls);

  // Unknown → menu
  await NAV.showMainMenu(from, cls);
}

// ============================================================
// TYPED QUESTION → GPT (₹299 only, 10/day)
// ============================================================
async function handleTypedQuestion(from, student, cls, question) {
  const gpt = G.checkGptAccess(student);

  if (!gpt.allowed) {
    if (gpt.reason === 'plan') {
      await S.sendButtons(from,
        `💎 "Ask Question" is a Premium feature (₹299 plan).\n\n` +
        `Tap menu ಬಳಸಿ free browse ಮಾಡಿ, ಅಥವಾ ₹299 ಗೆ upgrade!\n📞 7019068606`,
        [{ id: 'NAV_MENU', title: '📚 Browse Topics' }]);
    } else if (gpt.reason === 'limit') {
      await S.sendButtons(from,
        `⏰ ಇಂದಿನ 10 questions ಮುಗಿದಿದೆ. ನಾಳೆ reset ಆಗುತ್ತೆ.\n\n` +
        `Tap menu ನಿಂದ unlimited browse ಮಾಡಿ!`,
        [{ id: 'NAV_MENU', title: '📚 Browse Topics' }]);
    }
    return;
  }

  // Allowed → call GPT
  await S.sendText(from, '🤔 ಯೋಚಿಸ್ತಿದೀನಿ... / Thinking...');
  const answer = await G.askKSEEB(question, cls, from);
  await G.incrementGptCount(student);
  await S.sendText(from, answer.substring(0, 4000));
  await S.sendButtons(from,
    `💎 ${gpt.remaining - 1} questions ಉಳಿದಿದೆ ಇಂದು.`,
    [{ id: 'NAV_MENU', title: '📚 Browse Topics' }]);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Smartpath Kalike running on port ${PORT}`));

module.exports = { app, routeInteractive, handleRegistration, handleTypedQuestion };
