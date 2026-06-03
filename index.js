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
    } else if (message.type === 'image') {
      // Payment screenshot — forward to admin
      let student0 = await G.getStudent(from);
      const name = student0 ? (student0.get('Name') || '') : '';
      const cls0 = student0 ? String(student0.get('Class') || '').replace(/[^\d]/g, '') : '';
      const adminPhone = process.env.ADMIN_PHONE;
      if (adminPhone) {
        // Forward the image to admin with a caption
        await S.sendText(adminPhone,
          `💳 *Payment Screenshot ಬಂದಿದೆ!*\n\n` +
          `👤 ${name || 'Unknown'}\n📱 ${from}\n🎓 Class ${cls0}\n\n` +
          `Verify ಮಾಡಿ → Sheet ನಲ್ಲಿ Plan + Status ACTIVE set ಮಾಡಿ.\n` +
          `(Image ಕೆಳಗೆ forward ಆಗ್ತಿದೆ)`);
        try {
          const mediaId = message.image?.id;
          if (mediaId) await S.sendImageById(adminPhone, mediaId,
            `From ${name} (${from}) - Class ${cls0}`);
        } catch (e) { console.error('img fwd:', e.message); }
      }
      // Acknowledge to student
      await S.sendButtons(from,
        `✅ Payment screenshot ಸಿಕ್ತು! 🙏\n\n` +
        `24 ಗಂಟೆಯೊಳಗೆ verify ಮಾಡಿ activate ಮಾಡ್ತೀವಿ.\n` +
        `ಸಹಾಯಕ್ಕೆ: ${process.env.SUPPORT_PHONE || '7019068606'}`,
        [{ id: 'NAV_MENU', title: '🏠 Home' }]);
      return;
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
        `⏰ ನಿಮ್ಮ trial/plan ಮುಗಿದಿದೆ!\n\n💰 Upgrade: ₹199 / ₹299\n📞 7019068606`,
        [{ id: 'UPGRADE', title: '💳 Upgrade Plan' }, { id: 'NAV_MENU', title: '🔄 Try Again' }]);
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
      const st = NAV.getState(from);

      // Feedback capture mode
      if (st.awaitingFeedback) {
        st.awaitingFeedback = false;
        await G.saveFeedback(from, student.get('Name'), userText);
        await S.sendButtons(from,
          '🙏 ಧನ್ಯವಾದ! ನಿಮ್ಮ feedback ತಲುಪಿದೆ.\n(Thank you for your feedback!)',
          [{ id: 'NAV_MENU', title: '🏠 Home' }]);
        return;
      }

      // Parent phone capture mode (for parent report)
      if (st.awaitingParentPhone) {
        st.awaitingParentPhone = false;
        const digits = userText.replace(/\D/g, '');
        if (digits.length < 10) {
          await S.sendButtons(from, '⚠️ ಸರಿಯಾದ 10-digit number type ಮಾಡಿ.',
            [{ id: 'PARENT_REPORT', title: '🔁 ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ' }, { id: 'NAV_MENU', title: '🏠 Home' }]);
          return;
        }
        const parentPhone = digits.length === 10 ? '91' + digits : digits;
        const prog = await G.getProgress(from);
        const evStats = await G.getEvalStats(from);
        const cls = String(student.get('Class') || '').replace(/[^\d]/g, '');
        const ok = await G.sendParentReport(parentPhone, student.get('Name'), cls, prog, evStats);
        await S.sendButtons(from,
          ok ? '✅ Parent ಗೆ report ಕಳಿಸಿದೆ!' : '⚠️ ಕಳಿಸೋಕೆ ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
          [{ id: 'NAV_MENU', title: '🏠 Home' }]);
        return;
      }

      // Evaluation answer capture mode (₹299)
      if (st.awaitingEvalAnswer) {
        st.awaitingEvalAnswer = false;
        if (userText.length < 5) {
          st.awaitingEvalAnswer = true;
          await S.sendText(from, '✏️ ಸ್ವಲ್ಪ ವಿವರವಾಗಿ answer ಬರೆಯಿರಿ:');
          return;
        }
        await S.sendText(from, '⏳ ನಿಮ್ಮ answer evaluate ಮಾಡ್ತಿದೀನಿ...');
        const report = await G.evaluateAnswer(
          cls, st.subject || '', st.evalQ, st.evalMarks, st.evalModel, userText);
        if (!report) {
          await S.sendButtons(from, '⚠️ Evaluate ಮಾಡೋಕೆ ಆಗಲಿಲ್ಲ. ಮತ್ತೆ try ಮಾಡಿ.',
            [{ id: 'EVAL_START', title: '✏️ ಮತ್ತೆ' }, { id: 'NAV_MENU', title: '🏠 Home' }]);
          return;
        }
        await G.incrementEvalCount(student);
        // Parse marks from report and save to EvalScores tab
        let evalPct = 0;
        try {
          const { score, total } = G.parseEvalMarks(report, st.evalMarks);
          evalPct = total > 0 ? Math.round((score / total) * 100) : 0;
          await G.saveEvalScore(from, student.get('Name'), cls, st.subject || '',
            st.evalLabel || '', st.evalQ || '', score, total);
        } catch (e) { console.error('eval save skip:', e.message); }

        // Attractive header (like quiz) + GPT report
        const stars = '⭐'.repeat(Math.max(1, Math.round(evalPct / 20)));
        let remark;
        if (evalPct >= 80) remark = 'ಅದ್ಭುತ! Excellent! 🎉';
        else if (evalPct >= 60) remark = 'ಒಳ್ಳೆಯದು! Well done! 👍';
        else if (evalPct >= 40) remark = 'ಪರವಾಗಿಲ್ಲ! Keep improving! 💪';
        else remark = 'ಪ್ರಯತ್ನ ಚೆನ್ನಾಗಿದೆ, ಇನ್ನೂ ಅಭ್ಯಾಸ ಮಾಡೋಣ! 📚';
        const header = `✏️ *EVALUATION RESULT*\n${stars}  (${evalPct}%)\n${remark}\n${'━'.repeat(12)}\n\n`;

        await S.sendText(from, (header + report).substring(0, 4000));
        await S.sendButtons(from, 'ಮುಂದೇನು? / What next?', [
          { id: 'EVAL_NEXT', title: '📝 Next Question' },
          { id: 'NAV_MENU', title: '🏠 Home' }
        ]);
        return;
      }

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
    await G.updateStudent(student, 'Registration_Step', 'PENDING_CODE');
    await S.sendText(from,
      `📋 School code ಇದ್ಯಾ?\n\n` +
      `ಇದ್ರೆ → code type ಮಾಡಿ (e.g. GHS10A)\n` +
      `ಇಲ್ಲ ಅಂದ್ರೆ → *NO* type ಮಾಡಿ (2 ದಿನ free trial)`);
    return;
  }

  if (step === 'PENDING_CODE') {
    const cls = String(student.get('Class') || '').replace(/[^\d]/g,'') || '8';
    const txt = (userText || '').trim();

    // Skip code → trial
    if (!txt || ['no', 'illa', 'ಇಲ್ಲ', 'skip', 'na'].includes(txt.toLowerCase())) {
      await G.updateStudent(student, 'Registration_Step', 'COMPLETE');
      await S.sendText(from,
        `🎉 ನೋಂದಣಿ ಪೂರ್ಣ! / Registered!\n\n✅ 2 ದಿನ FREE Trial ಶುರು!\n\nಈಗ ಕಲಿಯೋಣ! 📚`);
      await NAV.showMainMenu(from, cls);
      return;
    }

    // Validate code
    const res = await G.validateSchoolCode(txt, cls);
    if (!res.ok) {
      let msg;
      switch (res.reason) {
        case 'invalid': msg = '❌ Code ಸರಿ ಇಲ್ಲ. ಮತ್ತೆ type ಮಾಡಿ ಅಥವಾ *NO* ಅಂತ type ಮಾಡಿ.'; break;
        case 'inactive': msg = '❌ ಈ code ಈಗ active ಇಲ್ಲ. *NO* type ಮಾಡಿ ಅಥವಾ admin ನ ಸಂಪರ್ಕಿಸಿ.'; break;
        case 'expired': msg = '❌ ಈ code ನ ಅವಧಿ ಮುಗಿದಿದೆ. *NO* type ಮಾಡಿ.'; break;
        case 'limit_reached': msg = '❌ ಈ code ನ limit ಮುಗಿದಿದೆ. Admin ನ ಸಂಪರ್ಕಿಸಿ ಅಥವಾ *NO* type ಮಾಡಿ.'; break;
        case 'class_mismatch': msg = `❌ ಈ code ${res.codeClass}ನೇ ತರಗತಿಗೆ. ನೀವು ${cls}ನೇ ತರಗತಿ. ಸರಿಯಾದ code ಅಥವಾ *NO* type ಮಾಡಿ.`; break;
        default: msg = '⚠️ ಸಮಸ್ಯೆ ಆಯ್ತು. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ *NO* type ಮಾಡಿ.';
      }
      await S.sendText(from, msg);
      return;  // stay in PENDING_CODE
    }

    // Valid code → save code details in state, ask register no
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + res.months);
    // Save temporarily — complete after register no
    await G.updateStudent(student, 'Plan', res.plan);
    await G.updateStudent(student, 'Status', 'ACTIVE');
    await G.updateStudent(student, 'StartDate', new Date().toISOString().split('T')[0]);
    await G.updateStudent(student, 'ExpiryDate', expiry.toISOString().split('T')[0]);
    await G.updateStudent(student, 'Registration_Step', 'PENDING_REGNO');
    // Store code row index for redemption after regno
    const st0 = NAV.getState(from);
    st0._pendingCodeRow = res.row;
    st0._pendingSchool = res.school;
    st0._pendingPlan = res.plan;
    st0._pendingMonths = res.months;
    st0._pendingExpiry = expiry.toISOString().split('T')[0];

    await S.sendText(from,
      `✅ Code valid! ಒಂದು ಕ್ಷಣ...\n\n` +
      `🏫 ${res.school}\n\n` +
      `📋 ನಿಮ್ಮ School Register Number type ಮಾಡಿ:\n(e.g. REG042 ಅಥವಾ 42)\n\n` +
      `ಗೊತ್ತಿಲ್ಲ ಅಂದ್ರೆ → *SKIP* type ಮಾಡಿ`);
    return;
  }

  if (step === 'PENDING_REGNO') {
    const cls = String(student.get('Class') || '').replace(/[^\d]/g,'') || '8';
    const txt = (userText || '').trim();
    const regno = ['skip','no','illa','ಇಲ್ಲ'].includes(txt.toLowerCase()) ? '' : txt;
    const st0 = NAV.getState(from);

    // Save RegNo to Sheet1
    if (regno) await G.updateStudent(student, 'RegNo', regno);
    await G.updateStudent(student, 'Registration_Step', 'COMPLETE');

    // Redeem code + save phone+name+regno to SchoolCodes StudentNos
    if (st0._pendingCodeRow) {
      await G.redeemSchoolCode(st0._pendingCodeRow,
        from, student.get('Name') || '', regno);
    }

    const school = st0._pendingSchool || '';
    const plan = st0._pendingPlan || '';
    const expiry = st0._pendingExpiry || '';

    await S.sendText(from,
      `🎉 ಯಶಸ್ವಿ! Code activated!\n\n` +
      `🏫 ${school}\n` +
      `${regno ? `📋 Register No: ${regno}\n` : ''}` +
      `💎 Plan: ₹${plan} (${st0._pendingMonths || 12} ತಿಂಗಳು)\n` +
      `📅 ${expiry} ತನಕ\n\nಈಗ ಕಲಿಯೋಣ! 📚`);
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
  st.studentName = student.get('Name') || '';
  st.plan = String(student.get('Plan') || '').trim();

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
  if (id === 'NOTES_EXAMPLES') return C.showExamples(from, st);
  if (id === 'NOTES_EXERCISE') return C.showExercise(from, st);
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

  // --- Progress ---
  if (id === 'PROGRESS') return showProgress(from, student);

  // --- Evaluation (₹299, 5/day) ---
  if (id === 'EVAL_START' || id === 'EVAL_NEXT') return startEvaluation(from, student, st);
  if (id && id.startsWith('EVALQ_')) {
    const qIdx = parseInt(id.replace('EVALQ_', ''), 10);
    return askEvalQuestion(from, student, st, qIdx);
  }

  // --- Upgrade (manual UPI) ---
  if (id === 'UPGRADE') return showUpgrade(from, student);
  if (id === 'UPG_199' || id === 'UPG_299') {
    const planAmt = id === 'UPG_299' ? '299' : '199';
    const upiId = process.env.UPI_ID || 'PLACEHOLDER@upi';
    const payeeName = process.env.UPI_NAME || 'Smartpath Kalike';
    await S.sendText(from,
      `💳 *₹${planAmt} Plan Payment*\n\n` +
      `UPI ID: *${upiId}*\n` +
      `ಹೆಸರು: ${payeeName}\n` +
      `ಮೊತ್ತ: ₹${planAmt}\n\n` +
      `1️⃣ ಮೇಲಿನ UPI ID ಗೆ ₹${planAmt} pay ಮಾಡಿ (GPay/PhonePe/Paytm)\n` +
      `2️⃣ Payment screenshot ಇದೇ chat ಗೆ ಕಳಿಸಿ\n` +
      `3️⃣ 24 ಗಂಟೆಯೊಳಗೆ activate ಆಗುತ್ತೆ ✅\n\n` +
      `ಸಹಾಯಕ್ಕೆ: ${process.env.SUPPORT_PHONE || '7019068606'}`);
    await S.sendButtons(from, 'Payment ಆದ ಮೇಲೆ screenshot ಕಳಿಸಿ 📸',
      [{ id: 'NAV_MENU', title: '🏠 Home' }]);
    return;
  }

  // --- Parent Report (₹299 only) ---
  if (id === 'PARENT_REPORT') {
    if (String(student.get('Plan')) !== '299') {
      return S.sendButtons(from, '📤 Parent Report ₹299 plan ಗೆ ಮಾತ್ರ.',
        [{ id: 'NAV_MENU', title: '🏠 Home' }]);
    }
    st.awaitingParentPhone = true;
    return S.sendText(from,
      '📤 Parent ರ WhatsApp number type ಮಾಡಿ:\n(10 digits, e.g. 9876543210)');
  }

  // --- Feedback ---
  if (id === 'FEEDBACK') {
    st.awaitingFeedback = true;
    return S.sendText(from,
      '💬 ನಿಮ್ಮ feedback / ಸಲಹೆ type ಮಾಡಿ:\n(Please type your feedback or suggestion)');
  }

  // --- Navigation ---
  if (id === 'NAV_BACK') return NAV.showMainMenu(from, cls);
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

// ============================================================
// EVALUATION — GPT evaluates student's written answer (₹299, 5/day)
// ============================================================
async function startEvaluation(from, student, st) {
  // Access check
  const acc = G.checkEvalAccess(student);
  if (!acc.allowed) {
    if (acc.reason === 'plan') {
      await S.sendButtons(from,
        '✏️ Evaluation ₹299 Premium plan ಗೆ ಮಾತ್ರ.\n\nUpgrade ಮಾಡಿ — ನಿಮ್ಮ answer GPT check ಮಾಡಿ marks + feedback ಕೊಡುತ್ತೆ!',
        [{ id: 'UPGRADE', title: '💳 Upgrade ₹299' }, { id: 'NAV_MENU', title: '🏠 Home' }]);
    } else {
      await S.sendButtons(from,
        `✏️ ಇಂದಿನ Evaluation limit (5) ಮುಗಿದಿದೆ.\nನಾಳೆ ಮತ್ತೆ try ಮಾಡಿ! 📚`,
        [{ id: 'NAV_MENU', title: '🏠 Home' }]);
    }
    return;
  }

  // Show Q&A list — student picks the question
  const { sections, label } = C.getCurrentSections(st);
  const qaList = N.collectQA(sections);
  if (!qaList || qaList.length === 0) {
    await S.sendButtons(from, '⚠️ ಈ topic ನಲ್ಲಿ Q&A ಇಲ್ಲ. ಬೇರೆ topic try ಮಾಡಿ.',
      [{ id: 'NAV_MENU', title: '🏠 Home' }]);
    return;
  }

  // Save the QA list to state so we can fetch the chosen one
  st.evalQAList = qaList.map(q => ({
    question: q.question, marks: q.marks || 3, answer: q.answer || ''
  }));
  st.evalLabel = label || '';

  // Build list rows (max 10 questions)
  const rows = qaList.slice(0, 10).map((q, i) => ({
    id: `EVALQ_${i}`,
    title: `Q${i + 1} [${q.marks || 3}M]`.substring(0, 24),
    description: (q.question || '').substring(0, 70)
  }));
  rows.push({ id: 'NAV_MENU', title: '🏠 Home' });

  await S.sendList(from,
    `✏️ *EVALUATION* (${acc.remaining} ಉಳಿದಿದೆ ಇಂದು)\n\n` +
    `📚 ${label}\n\nಯಾವ ಪ್ರಶ್ನೆಗೆ answer ಬರೀತೀರಾ? ಆರಿಸಿ:`,
    'ಪ್ರಶ್ನೆ ಆರಿಸಿ', rows, 'Evaluation');
}

// Student picked a question → ask for their answer
async function askEvalQuestion(from, student, st, qIndex) {
  const acc = G.checkEvalAccess(student);
  if (!acc.allowed) {
    await S.sendButtons(from,
      acc.reason === 'plan'
        ? '✏️ Evaluation ₹299 plan ಗೆ ಮಾತ್ರ.'
        : '✏️ ಇಂದಿನ limit (5) ಮುಗಿದಿದೆ. ನಾಳೆ try ಮಾಡಿ!',
      [{ id: 'NAV_MENU', title: '🏠 Home' }]);
    return;
  }
  const list = st.evalQAList || [];
  const pick = list[qIndex];
  if (!pick) {
    await S.sendButtons(from, '⚠️ ಪ್ರಶ್ನೆ ಸಿಗಲಿಲ್ಲ. ಮತ್ತೆ ಆರಿಸಿ.',
      [{ id: 'EVAL_START', title: '✏️ Evaluation' }, { id: 'NAV_MENU', title: '🏠 Home' }]);
    return;
  }
  st.evalQ = pick.question;
  st.evalMarks = pick.marks || 3;
  st.evalModel = pick.answer || '';
  st.awaitingEvalAnswer = true;

  await S.sendText(from,
    `✏️ *Q [${st.evalMarks} marks]:*\n${pick.question}\n\n` +
    `👇 ನಿಮ್ಮ answer ಬರೆಯಿರಿ (type ಮಾಡಿ):`);
}

// ============================================================
// UPGRADE — show plan options (manual UPI)
// ============================================================
async function showUpgrade(from, student) {
  const plan = String(student.get('Plan') || '').trim();
  const status = String(student.get('Status') || '').trim();

  let header = '';
  if (plan === '299' && status === 'ACTIVE') {
    await S.sendButtons(from,
      '✅ ನೀವು ಈಗಾಗಲೇ ₹299 Premium plan ನಲ್ಲಿ ಇದ್ದೀರಿ!\nಎಲ್ಲ features ಲಭ್ಯ. 🎉',
      [{ id: 'NAV_MENU', title: '🏠 Home' }]);
    return;
  }
  if (plan === '199' && status === 'ACTIVE') {
    header = '💎 ನೀವು ₹199 plan ನಲ್ಲಿ ಇದ್ದೀರಿ.\n₹299 ಗೆ upgrade ಮಾಡಿ — GPT + Parent Report!\n\n';
  } else {
    header = '💎 Plan ಆರಿಸಿ — full access ಪಡೆಯಿರಿ!\n\n';
  }

  const msg = header +
    `📘 *₹199 Standard*\nNotes + Q&A + Quiz + Progress\n\n` +
    `💎 *₹299 Premium*\n₹199 ಎಲ್ಲ + AI Ask Question (10/day) + Parent Report\n\n` +
    `Durations: 1mo / 6mo (₹999/₹1499) / 12mo (₹1799/₹2699)`;

  await S.sendText(from, msg);

  const rows = [];
  if (!(plan === '199' && status === 'ACTIVE'))
    rows.push({ id: 'UPG_199', title: '📘 ₹199 Standard' });
  rows.push({ id: 'UPG_299', title: '💎 ₹299 Premium' });
  rows.push({ id: 'NAV_MENU', title: '🏠 Home' });

  await S.sendButtons(from, 'ಯಾವ plan ಬೇಕು?', rows);
}

// ============================================================
// PROGRESS — show quiz score history & stats (improved)
// ============================================================
async function showProgress(from, student) {
  const p = await G.getProgress(from);

  if (!p || p.count === 0) {
    await S.sendButtons(from,
      '📊 ಇನ್ನೂ quiz ಮಾಡಿಲ್ಲ!\nಒಂದು quiz ಮುಗಿಸಿ, ನಿಮ್ಮ progress ಇಲ್ಲಿ ಕಾಣುತ್ತೆ. 📚',
      [{ id: 'NAV_MENU', title: '🏠 Home' }]);
    return;
  }

  const name = student.get('Name') || '';
  const cls = String(student.get('Class') || '').replace(/[^\d]/g, '') || '';

  // Star rating + remark
  let stars, remark;
  if (p.avg >= 90) { stars = '⭐⭐⭐⭐⭐'; remark = 'Excellent!'; }
  else if (p.avg >= 75) { stars = '⭐⭐⭐⭐'; remark = 'Very Good!'; }
  else if (p.avg >= 60) { stars = '⭐⭐⭐'; remark = 'Good!'; }
  else if (p.avg >= 45) { stars = '⭐⭐'; remark = 'Keep trying!'; }
  else { stars = '⭐'; remark = 'Need more practice'; }

  let msg = `📊 *ನಿಮ್ಮ Progress — ${name}*\n\n`;
  msg += `${stars} ${remark} (${p.avg}% avg)\n`;
  if (p.streak >= 2) msg += `🔥 ${p.streak} days study streak!\n`;
  msg += `\n📝 ಒಟ್ಟು Quiz: *${p.count}*\n`;

  // subject-wise
  if (p.subjects && p.subjects.length) {
    for (const s of p.subjects) {
      const icon = s.subject === 'Maths' ? '📐' : (s.subject === 'Science' ? '🔬' : '📚');
      msg += `${icon} ${s.subject}: ${s.count} quizzes, avg ${s.avg}%\n`;
    }
  }

  if (p.best) msg += `\n🏆 Best: ${p.best.subject} Ch${p.best.chapter} → ${p.best.percent}%\n`;

  // weak topics
  if (p.weak && p.weak.length) {
    msg += `\n⚠️ *PRACTICE ಮಾಡಿ:*\n`;
    for (const w of p.weak) {
      msg += `• ${w.subject} Ch${w.chapter} ${w.topic || ''} (${w.percent}%)\n`;
    }
  }

  // recent
  if (p.recent && p.recent.length) {
    msg += `\n*ಇತ್ತೀಚಿನ Quiz:*\n`;
    for (const r of p.recent) {
      const icon = (parseInt(r.percent) >= 60) ? '✅' : '📚';
      msg += `${icon} ${r.subject} Ch${r.chapter} — ${r.score}/${r.total} (${r.percent}%)\n`;
    }
  }

  // Evaluation stats (₹299) — attractive section
  const plan = String(student.get('Plan') || '');
  if (plan === '299') {
    const ev = await G.getEvalStats(from);
    if (ev && ev.count > 0) {
      const evStars = '⭐'.repeat(Math.max(1, Math.round((ev.avg || 0) / 20)));
      let evRemark;
      if (ev.avg >= 80) evRemark = 'ಅದ್ಭುತ ಬರವಣಿಗೆ! 🎉';
      else if (ev.avg >= 60) evRemark = 'ಒಳ್ಳೆಯ ಉತ್ತರ! 👍';
      else if (ev.avg >= 40) evRemark = 'ಸುಧಾರಿಸ್ತಿದೆ! 💪';
      else evRemark = 'ಹೆಚ್ಚು ಬರೆದು ಅಭ್ಯಾಸ ಮಾಡಿ! 📝';

      msg += `\n${'━'.repeat(12)}\n`;
      msg += `✏️ *Writing Practice (Evaluation)*\n`;
      msg += `${evStars} ${evRemark}\n`;
      msg += `📝 ${ev.count} answers ಬರೆದಿದ್ದೀರಿ • avg ${ev.avg}%\n`;
      if (ev.recent && ev.recent.length) {
        msg += `\n*ಇತ್ತೀಚಿನ Answers:*\n`;
        for (const r of ev.recent) {
          const icon = (parseInt(r.percent) >= 60) ? '✅' : '📝';
          msg += `${icon} ${r.subject} ${r.topic} — ${r.score}/${r.total}\n`;
        }
      }
    }
  }

  await S.sendText(from, msg.substring(0, 4000));

  // Buttons: Parent Report (₹299 only) + Home
  const btns = [];
  if (plan === '299') btns.push({ id: 'PARENT_REPORT', title: '📤 Parent Report' });
  btns.push({ id: 'NAV_MENU', title: '🏠 Home' });
  await S.sendButtons(from, 'ಮುಂದೇನು? / What next?', btns);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Smartpath Kalike running on port ${PORT}`));

module.exports = { app, routeInteractive, handleRegistration, handleTypedQuestion };
