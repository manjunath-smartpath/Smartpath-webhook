// ============================================================
// SECTION 8a: CONTENT DISPLAY — Notes + Q&A (v2)
// Smartpath Kalike Phase 3
// ============================================================
// Notes now shows: definition + key_points + formulas(examples)
//   + theorem, and offers buttons for Activity/Diagrams/Exercise
//   + Topics + Q&A + Quiz + Back.
// ============================================================

const N = require('./notesLoader');
const S = require('./sendHelpers');

// ---------- Resolve current sections (subtopic > topic > chapter) ----------
function getCurrentSections(st) {
  const c = N.getChapter(st.cls, st.subject, st.ch);
  if (!c) return { sections: [], label: '' };

  if (st.contentSource === 'chapter') {
    return { sections: c.chapter_sections, label: `Chapter ${st.ch}` };
  }
  const topic = c.topics[st.topicIndex];
  if (!topic) return { sections: [], label: '' };

  if (st.subtopicIndex !== null && st.subtopicIndex !== undefined) {
    const sub = (topic.subtopics || [])[st.subtopicIndex];
    if (sub) return { sections: sub.sections, label: `${sub.subtopic_num} ${sub.subtopic_name}` };
  }
  return { sections: topic.sections, label: `${topic.topic_num} ${topic.topic_name}` };
}

// Build follow-up buttons based on what content exists + context
function buildFollowupButtons(st, sections) {
  const has = (type) => N.getSections(sections, type).length > 0;
  const rows = [];

  // Activity / Experiment
  if (has('activity') || has('experiment')) rows.push({ id: 'NOTES_ACTIVITY', title: '🔬 Activity' });
  // Examples (formulas) / Theorem
  if (has('formulas') || has('theorem')) rows.push({ id: 'NOTES_EXAMPLES', title: '📐 Examples' });
  // Exercise
  if (has('exercise') || has('textbook_exercises')) rows.push({ id: 'NOTES_EXERCISE', title: '✏️ Exercise' });
  // Diagrams
  if (has('diagrams')) rows.push({ id: 'NOTES_DIAGRAMS', title: '🖼️ Diagrams' });

  // Always: Q&A, Quiz
  rows.push({ id: 'CONTENT_QA', title: '❓ Q&A' });
  rows.push({ id: 'CONTENT_QUIZ', title: '📝 Quiz' });

  // Topics (if we're at chapter level, allow jump to topics)
  if (st.contentSource === 'chapter') {
    rows.push({ id: 'CHCONTENT_TOPICS', title: '📋 Topics' });
  }
  // Sub-topics (if topic has them and we're at topic level)
  if (st.contentSource !== 'chapter' && (st.subtopicIndex === null || st.subtopicIndex === undefined)) {
    const topic = N.getTopic(st.cls, st.subject, st.ch, st.topicIndex);
    if (topic && (topic.subtopics || []).length > 0) {
      rows.push({ id: 'CONTENT_SUBTOPICS', title: '📂 Sub-topics' });
    }
  }

  // Back
  rows.push({ id: 'NAV_MENU', title: '🏠 Home' });
  return rows;
}

// ============================================================
// NOTES DISPLAY
// ============================================================
async function showNotes(to, st) {
  const { sections, label } = getCurrentSections(st);

  const defs = N.getSections(sections, 'definition');
  const kps = N.getSections(sections, 'key_points');
  const facts = N.getSections(sections, 'additional_facts');

  let msg = `📖 *${label}*\n\n`;

  if (defs.length && defs[0].text) {
    msg += `📌 *DEFINITION:*\n${defs[0].text}\n\n`;
  }
  if (kps.length && kps[0].points && kps[0].points.length) {
    msg += `🎯 *KEY POINTS:*\n`;
    kps[0].points.forEach(p => { msg += `• ${p}\n`; });
    msg += `\n`;
  }
  if (facts.length && facts[0].points && facts[0].points.length) {
    msg += `💡 *DID YOU KNOW:*\n`;
    facts[0].points.forEach(p => { msg += `• ${p}\n`; });
    msg += `\n`;
  }

  if (msg.trim() === `📖 *${label}*`) {
    msg += 'ℹ️ ಈ section ಗೆ notes ಸಿಗಲಿಲ್ಲ.';
  }

  if (msg.length > 3800) msg = msg.substring(0, 3800) + '\n\n…(devamu)';
  await S.sendText(to, msg);

  // Follow-up buttons (max 3 per button-msg; use list if >3)
  const rows = buildFollowupButtons(st, sections);
  if (rows.length > 3) {
    await S.sendList(to, 'ಮುಂದೇನು? / What next?', 'Select', rows, label.substring(0,24));
  } else {
    await S.sendButtons(to, 'ಮುಂದೇನು? / What next?', rows);
  }
}

// ============================================================
// ACTIVITY DISPLAY
// ============================================================
async function showActivity(to, st) {
  const { sections } = getCurrentSections(st);
  const activities = [
    ...N.getSections(sections, 'activity'),
    ...N.getSections(sections, 'experiment')
  ];
  if (!activities.length) { await S.sendText(to, 'ℹ️ ಈ section ಗೆ activity ಇಲ್ಲ.'); }
  else {
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
  }
  await afterContentButtons(to, st);
}

// ============================================================
// EXAMPLES (formulas + theorem)
// ============================================================
async function showExamples(to, st) {
  const { sections, label } = getCurrentSections(st);
  const formulas = N.getSections(sections, 'formulas');
  const theorems = N.getSections(sections, 'theorem');

  if (!formulas.length && !theorems.length) {
    await S.sendText(to, 'ℹ️ ಈ section ಗೆ examples ಇಲ್ಲ.');
  } else {
    let msg = `📐 *EXAMPLES — ${label}*\n\n`;
    for (const f of formulas) {
      if (f.label) msg += `*${f.label}*\n`;
      if (f.text) msg += `${f.text}\n`;
      if (f.items) f.items.forEach(it => { msg += `• ${typeof it==='string'?it:JSON.stringify(it)}\n`; });
      msg += `\n`;
    }
    for (const t of theorems) {
      if (t.label) msg += `*${t.label}*\n`;
      if (t.statement) msg += `Statement: ${t.statement}\n`;
      if (t.proof) msg += `Proof: ${t.proof}\n`;
      msg += `\n`;
    }
    await S.sendText(to, msg.substring(0, 4000));
  }
  await afterContentButtons(to, st);
}

// ============================================================
// EXERCISE
// ============================================================
async function showExercise(to, st) {
  const { sections, label } = getCurrentSections(st);
  const exs = [
    ...N.getSections(sections, 'exercise'),
    ...N.getSections(sections, 'textbook_exercises')
  ];
  if (!exs.length) { await S.sendText(to, 'ℹ️ ಈ section ಗೆ exercise ಇಲ್ಲ.'); }
  else {
    let msg = `✏️ *EXERCISE — ${label}*\n\n`;
    for (const e of exs) {
      if (e.label) msg += `*${e.label}*\n`;
      if (e.text) msg += `${e.text}\n`;
      if (e.items) e.items.forEach(it => {
        if (typeof it === 'string') msg += `• ${it}\n`;
        else if (it.question) msg += `• ${it.question}${it.answer?` → ${it.answer}`:''}\n`;
      });
      msg += `\n`;
    }
    await S.sendText(to, msg.substring(0, 4000));
  }
  await afterContentButtons(to, st);
}

// ============================================================
// DIAGRAMS
// ============================================================
async function showDiagrams(to, st) {
  const { sections, label } = getCurrentSections(st);
  const diags = N.getSections(sections, 'diagrams');
  if (!diags.length) { await S.sendText(to, 'ℹ️ ಈ section ಗೆ diagrams ಇಲ್ಲ.'); }
  else {
    let msg = `🖼️ *DIAGRAMS — ${label}*\n\n`;
    for (const d of diags) {
      if (d.items && d.items.length) {
        d.items.forEach(fig => { msg += `*Fig ${fig.fig}:* ${fig.description}\n\n`; });
      } else if (d.raw) { msg += d.raw + '\n\n'; }
    }
    await S.sendText(to, msg.substring(0, 4000));
  }
  await afterContentButtons(to, st);
}

// Common follow-up buttons after Activity/Examples/Exercise/Diagrams
async function afterContentButtons(to, st) {
  await S.sendButtons(to, 'ಮುಂದೇನು? / What next?', [
    { id: 'CONTENT_QA', title: '❓ Q&A' },
    { id: 'CONTENT_QUIZ', title: '📝 Quiz' },
    { id: 'NAV_MENU', title: '🏠 Home' }
  ]);
}

// ============================================================
// Q&A DISPLAY
// ============================================================
async function startQA(to, st) {
  const { sections, label } = getCurrentSections(st);
  const qaList = N.collectQA(sections);
  if (!qaList.length) {
    await S.sendText(to, 'ℹ️ ಈ section ಗೆ Q&A ಸಿಗಲಿಲ್ಲ.');
    await afterContentButtons(to, st);
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
  const cleanAnswer = String(qa.answer || '').replace(/[\s\-=_]+$/, '').trim();

  let msg = `❓ *Q&A (${n}/${total})*${marks}\n\n*Q:* ${qa.question}\n\n*A:* ${cleanAnswer}`;
  await S.sendText(to, msg.substring(0, 4000));

  const btns = [];
  if (st.qaIndex < total - 1) btns.push({ id: 'QA_NEXT', title: '➡️ Next' });
  btns.push({ id: 'CONTENT_QUIZ', title: '📝 Quiz' });
  btns.push({ id: 'NAV_MENU', title: '🏠 Home' });

  await S.sendButtons(to,
    st.qaIndex < total - 1 ? `${n}/${total} — ಮುಂದಿನ Q&A?` : `✅ ಎಲ್ಲ ${total} Q&A ಮುಗಿಯಿತು!`,
    btns.slice(0, 3));
}

async function nextQA(to, st) {
  if (!st.qaList || st.qaIndex >= st.qaList.length - 1) {
    await S.sendButtons(to, '✅ ಎಲ್ಲ Q&A ಮುಗಿಯಿತು!', [
      { id: 'CONTENT_QUIZ', title: '📝 Take Quiz' },
      { id: 'NAV_MENU', title: '🏠 Home' },
      { id: 'NAV_MENU', title: '🏠 Menu' }
    ]);
    return;
  }
  st.qaIndex++;
  await sendQAItem(to, st);
}

module.exports = {
  getCurrentSections,
  showNotes, showActivity, showExamples, showExercise, showDiagrams,
  afterContentButtons,
  startQA, nextQA, sendQAItem
};
