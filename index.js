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
        const cls = String(student.get('Class') || '').replace(/[^\d]/g, '');
        const ok = await G.sendParentReport(parentPhone, student.get('Name'), cls, prog);
        await S.sendButtons(from,
          ok ? '✅ Parent ಗೆ report ಕಳಿಸಿದೆ!' : '⚠️ ಕಳಿಸೋಕೆ ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
          [{ id: 'NAV_MENU', title: '🏠 Home' }]);
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

    // Valid code → activate
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + res.months);
    await G.updateStudent(student, 'Plan', res.plan);
    await G.updateStudent(student, 'Status', 'ACTIVE');
    await G.updateStudent(student, 'StartDate', new Date().toISOString().split('T')[0]);
    await G.updateStudent(student, 'ExpiryDate', expiry.toISOString().split('T')[0]);
    await G.updateStudent(student, 'Registration_Step', 'COMPLETE');
    await G.redeemSchoolCode(res.row);

    await S.sendText(from,
      `🎉 ಯಶಸ್ವಿ! Code activated!\n\n` +
      `🏫 ${res.school}\n` +
      `💎 Plan: ₹${res.plan} (${res.months} ತಿಂಗಳು)\n` +
      `📅 ${expiry.toISOString().split('T')[0]} ತನಕ\n\nಈಗ ಕಲಿಯೋಣ! 📚`);
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

  await S.sendText(from, msg.substring(0, 4000));

  // Buttons: Parent Report (₹299 only) + Home
  const plan = String(student.get('Plan') || '');
  const btns = [];
  if (plan === '299') btns.push({ id: 'PARENT_REPORT', title: '📤 Parent Report' });
  btns.push({ id: 'NAV_MENU', title: '🏠 Home' });
  await S.sendButtons(from, 'ಮುಂದೇನು? / What next?', btns);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Smartpath Kalike running on port ${PORT}`));

module.exports = { app, routeInteractive, handleRegistration, handleTypedQuestion };
