// ============================================================
// SECTION 8a: CONTENT DISPLAY — Notes + Q&A
// Smartpath Kalike Phase 3
// ============================================================
// Reads current state (chapter/topic/subtopic) → shows:
//   showNotes()  → definition + key points (+ Examples/Activity btns)
//   showActivity() → activity detail
//   showQA()     → Q&A one-by-one (with marks, Next button)
// Quiz is in a separate module (quizEngine.js)
// ============================================================

const N = require('./notesLoader');
const S = require('./sendHelpers');

// ---------- Resolve which sections to use based on state ----------
// Returns the sections array for the current location:
//   subtopic (if subtopicIndex set) > topic > chapter
function getCurrentSections(st) {
  const c = N.getChapter(st.cls, st.subject, st.ch);
  if (!c) return { sections: [], label: '' };

  // Chapter-level content requested?
  if (st.contentSource === 'chapter') {
    return { sections: c.chapter_sections, label: `Chapter ${st.ch}` };
  }

  const topic = c.topics[st.topicIndex];
  if (!topic) return { sections: [], label: '' };

  // Sub-topic level (Mode A)
  if (st.subtopicIndex !== null && st.subtopicIndex !== undefined) {
    const sub = (topic.subtopics || [])[st.subtopicIndex];
    if (sub) return { sections: sub.sections, label: `${sub.subtopic_num} ${sub.subtopic_name}` };
  }

  // Topic level
  return { sections: topic.sections, label: `${topic.topic_num} ${topic.topic_name}` };
}

// ============================================================
// NOTES DISPLAY: definition + key points
// ============================================================
async function showNotes(to, st) {
  const { sections, label } = getCurrentSections(st);

  const defs = N.getSections(sections, 'definition');
  const kps = N.getSections(sections, 'key_points');
  const activities = N.getSections(sections, 'activity');
  const experiments = N.getSections(sections, 'experiment');
  const examples = N.getSections(sections, 'formulas'); // formulas as "examples" for maths
  const diagrams = N.getSections(sections, 'diagrams');

  let msg = `📖 *${label}*\n\n`;

  // Definition
  if (defs.length && defs[0].text) {
    msg += `📌 *DEFINITION:*\n${defs[0].text}\n\n`;
  }

  // Key points
  if (kps.length && kps[0].points && kps[0].points.length) {
    msg += `🎯 *KEY POINTS:*\n`;
    kps[0].points.forEach(p => { msg += `• ${p}\n`; });
    msg += `\n`;
  }

  // If nothing found
  if (msg.trim() === `📖 *${label}*`) {
    msg += 'ℹ️ ಈ topic ಗೆ notes ಸಿಗಲಿಲ್ಲ.';
  }

  // Truncate if too long, offer Read More
  const TRUNC = 3500;
  let truncated = false;
  if (msg.length > TRUNC) {
    msg = msg.substring(0, TRUNC) + '\n\n…(devamu / continued)';
    truncated = true;
  }

  await S.sendText(to, msg);

  // Build follow-up buttons (max 3)
  const btns = [];
  if (activities.length || experiments.length) {
    btns.push({ id: 'NOTES_ACTIVITY', title: '🔬 Activity' });
  }
  if (diagrams.length) {
    btns.push({ id: 'NOTES_DIAGRAMS', title: '📐 Diagrams' });
  }
  btns.push({ id: 'CONTENT_QA', title: '❓ Q&A' });
  if (btns.length < 3) btns.push({ id: 'CONTENT_QUIZ', title: '📝 Quiz' });

  await S.sendButtons(to, 'ಮುಂದೇನು? / What next?', btns.slice(0, 3));
}

// ============================================================
// ACTIVITY DISPLAY
// ============================================================
async function showActivity(to, st) {
  const { sections, label } = getCurrentSections(st);
  const activities = [
    ...N.getSections(sections, 'activity'),
    ...N.getSections(sections, 'experiment')
  ];

  if (!activities.length) {
    await S.sendText(to, 'ℹ️ ಈ topic ಗೆ activity ಇಲ್ಲ.');
    return;
  }

  for (const a of activities) {
    let msg = `🔬 *${a.label || 'ACTIVITY'}*\n\n`;
    if (a.aim) msg += `🎯 *AIM:* ${a.aim}\n\n`;
    if (a.materials) msg += `🧰 *MATERIALS:* ${a.materials}\n\n`;
    if (a.procedure && a.procedure.length) {
      msg += `📋 *PROCEDURE:*\n`;
      a.procedure.forEach(p => { msg += `${p}\n`; });
      msg += `\n`;
    }
    if (a.observation) msg += `👁️ *OBSERVATION:* ${a.observation}\n\n`;
    if (a.conclusion) msg += `✅ *CONCLUSION:* ${a.conclusion}\n`;
    await S.sendText(to, msg.substring(0, 4000));
  }

  await S.sendButtons(to, 'ಮುಂದೇನು? / What next?', [
    { id: 'CONTENT_QA', title: '❓ Q&A' },
    { id: 'CONTENT_QUIZ', title: '📝 Quiz' },
    { id: 'NAV_BACK', title: '🔙 Back' }
  ]);
}

// ============================================================
// DIAGRAMS DISPLAY (10th Science new template)
// ============================================================
async function showDiagrams(to, st) {
  const { sections, label } = getCurrentSections(st);
  const diags = N.getSections(sections, 'diagrams');

  if (!diags.length) {
    await S.sendText(to, 'ℹ️ ಈ topic ಗೆ diagrams ಇಲ್ಲ.');
    return;
  }

  let msg = `📐 *DIAGRAMS — ${label}*\n\n`;
  for (const d of diags) {
    if (d.items && d.items.length) {
      d.items.forEach(fig => {
        msg += `*Fig ${fig.fig}:* ${fig.description}\n\n`;
      });
    } else if (d.raw) {
      msg += d.raw + '\n\n';
    }
  }
  await S.sendText(to, msg.substring(0, 4000));
  await S.sendButtons(to, 'ಮುಂದೇನು? / What next?', [
    { id: 'CONTENT_QA', title: '❓ Q&A' },
    { id: 'CONTENT_QUIZ', title: '📝 Quiz' },
    { id: 'NAV_BACK', title: '🔙 Back' }
  ]);
}

// ============================================================
// Q&A DISPLAY (one-by-one with marks + Next)
// ============================================================
async function startQA(to, st) {
  const { sections, label } = getCurrentSections(st);
  const qaList = N.collectQA(sections);

  if (!qaList.length) {
    await S.sendText(to, 'ℹ️ ಈ topic ಗೆ Q&A ಸಿಗಲಿಲ್ಲ.');
    return;
  }

  st.qaList = qaList;
  st.qaIndex = 0;
  st.qaLabel = label;
  st.flow = 'qa';

  await sendQAItem(to, st);
}

async function sendQAItem(to, st) {
  const qa = st.qaList[st.qaIndex];
  const total = st.qaList.length;
  const n = st.qaIndex + 1;

  const marks = qa.marks ? ` [${qa.marks} Marks]` : '';
  // Clean trailing separators (---, ===) from answer
  const cleanAnswer = String(qa.answer || '').replace(/[\s\-=_]+$/, '').trim();
  let msg = `❓ *Q&A (${n}/${total})*${marks}\n\n`;
  msg += `*Q:* ${qa.question}\n\n`;
  msg += `*A:* ${cleanAnswer}`;

  await S.sendText(to, msg.substring(0, 4000));

  // Navigation buttons
  const btns = [];
  if (st.qaIndex < total - 1) {
    btns.push({ id: 'QA_NEXT', title: '➡️ Next' });
  }
  btns.push({ id: 'CONTENT_QUIZ', title: '📝 Quiz' });
  btns.push({ id: 'NAV_BACK', title: '🔙 Back' });

  await S.sendButtons(to, st.qaIndex < total - 1
    ? `${n}/${total} — ಮುಂದಿನ Q&A?`
    : `✅ ಎಲ್ಲ ${total} Q&A ಮುಗಿಯಿತು!`,
    btns.slice(0, 3));
}

async function nextQA(to, st) {
  if (!st.qaList || st.qaIndex >= st.qaList.length - 1) {
    await S.sendButtons(to, '✅ ಎಲ್ಲ Q&A ಮುಗಿಯಿತು!', [
      { id: 'CONTENT_QUIZ', title: '📝 Take Quiz' },
      { id: 'NAV_BACK', title: '🔙 Topics' },
      { id: 'NAV_MENU', title: '🏠 Menu' }
    ]);
    return;
  }
  st.qaIndex++;
  await sendQAItem(to, st);
}

module.exports = {
  getCurrentSections,
  showNotes,
  showActivity,
  showDiagrams,
  startQA,
  nextQA,
  sendQAItem
};
