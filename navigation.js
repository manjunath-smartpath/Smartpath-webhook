// ============================================================
// SECTION 3 + 7: STATE TRACKING + NAVIGATION ENGINE (v2)
// Smartpath Kalike Phase 3 — with proper BACK history stack
// ============================================================

const N = require('./notesLoader');
const S = require('./sendHelpers');

const userState = {};

function getState(phone) {
  if (!userState[phone]) userState[phone] = { history: [] };
  if (!userState[phone].history) userState[phone].history = [];
  return userState[phone];
}

function resetState(phone) {
  userState[phone] = { history: [] };
}

// ---------- BACK HISTORY ----------
// Each screen pushes a snapshot {view, data} so BACK can return one step.
// views: 'menu','parts','chapters','chapterMenu','topics','topicMenu',
//        'subtopics','subtopicMenu'
function pushHistory(st, view) {
  st.history = st.history || [];
  st.history.push({
    view,
    subject: st.subject, cls: st.cls, part: st.part,
    ch: st.ch, topicIndex: st.topicIndex, subtopicIndex: st.subtopicIndex,
    contentSource: st.contentSource
  });
  // cap history length
  if (st.history.length > 30) st.history.shift();
}

// ============================================================
// MAIN MENU
// ============================================================
async function showMainMenu(to, cls, track = true) {
  const st = getState(to);
  if (track) pushHistory(st, 'menu');
  st.flow = 'menu';
  st.cls = cls;
  st.subject = null; st.part = null; st.ch = null;
  st.topicIndex = null; st.subtopicIndex = null; st.contentSource = null;
  await S.sendButtons(to, '📚 ಏನು ಕಲಿಯಬೇಕು? / What to learn?', [
    { id: 'SUBJ_Maths', title: '📐 ಗಣಿತ Maths' },
    { id: 'SUBJ_Science', title: '🔬 ವಿಜ್ಞಾನ Science' },
    { id: 'FEEDBACK', title: '💬 Feedback' }
  ]);
}

// ============================================================
// PART SELECTION
// ============================================================
async function showParts(to, subject, track = true) {
  const st = getState(to);
  if (track) pushHistory(st, 'parts');
  st.flow = 'part';
  st.subject = subject;
  st.ch = null; st.topicIndex = null; st.subtopicIndex = null; st.contentSource = null;
  await S.sendButtons(to, `📚 ${subject} — Part ಆರಿಸಿ / Choose Part:`, [
    { id: 'PART_1', title: 'Part 1' },
    { id: 'PART_2', title: 'Part 2' },
    { id: 'NAV_MENU', title: '🏠 Home' }
  ]);
}

// ============================================================
// CHAPTER LIST
// ============================================================
async function showChapters(to, part, track = true) {
  const st = getState(to);
  if (track) pushHistory(st, 'chapters');
  st.flow = 'chapters';
  st.part = part;
  st.ch = null; st.topicIndex = null; st.subtopicIndex = null; st.contentSource = null;

  const chapters = N.getChapters(st.cls, st.subject, part);
  if (chapters.length === 0) {
    await S.sendText(to, '⚠️ ಈ part ನಲ್ಲಿ chapters ಇಲ್ಲ.');
    return;
  }
  const rows = chapters.map(ch => {
    const name = N.getChapterName(st.cls, st.subject, ch);
    return { id: `CH_${ch}`, title: `Ch${ch}: ${name}`.substring(0, 24),
             description: name.length > 18 ? name : undefined };
  });
  rows.push({ id: 'NAV_MENU', title: '🏠 Home' });

  await S.sendList(to, `📖 ${st.subject} Part ${part}\nChapter ಆರಿಸಿ / Choose Chapter:`,
    'Select Chapter', rows, `Part ${part} Chapters`);
}

// ============================================================
// CHAPTER MENU (conditional)
// ============================================================
async function showChapterMenu(to, ch, track = true) {
  const st = getState(to);
  if (track) pushHistory(st, 'chapterMenu');
  st.ch = ch;
  st.chapterKey = `${st.cls}_${st.subject}_${ch}`;
  st.topicIndex = null; st.subtopicIndex = null; st.contentSource = null;

  const chName = N.getChapterName(st.cls, st.subject, ch);
  const flags = N.chapterContentFlags(st.cls, st.subject, ch);
  const hasContent = flags.notes || flags.qa || flags.quiz;
  st.hasChContent = hasContent;

  if (hasContent) {
    st.flow = 'chapterMenu';
    const rows = [];
    if (flags.notes) rows.push({ id: 'CHCONTENT_NOTES', title: '📖 Chapter Notes' });
    rows.push({ id: 'CHCONTENT_TOPICS', title: '📋 Topics' });  // always
    if (flags.qa)   rows.push({ id: 'CHCONTENT_QA', title: '❓ Chapter Q&A' });
    if (flags.quiz) rows.push({ id: 'CHCONTENT_QUIZ', title: '📝 Chapter Quiz' });
    rows.push({ id: 'NAV_MENU', title: '🏠 Home' });
    await S.sendList(to, `📘 Chapter ${ch}: ${chName}\nಏನು ಬೇಕು? / What do you need?`,
      'Select', rows, 'Chapter Menu');
  } else {
    await showTopics(to, ch, false);  // no chapter content → go to topics
  }
}

// ============================================================
// TOPIC LIST
// ============================================================
async function showTopics(to, ch, track = true) {
  const st = getState(to);
  if (track) pushHistory(st, 'topics');
  st.flow = 'topics';
  if (ch) { st.ch = ch; st.chapterKey = `${st.cls}_${st.subject}_${ch}`; }
  st.topicIndex = null; st.subtopicIndex = null; st.contentSource = null;

  const topics = N.getTopics(st.cls, st.subject, st.ch);
  if (topics.length === 0) {
    await S.sendText(to, '⚠️ ಈ chapter ನಲ್ಲಿ topics ಇಲ್ಲ.');
    return;
  }
  const rows = topics.map((t, i) => ({
    id: `TOPIC_${i}`,
    title: `${t.num} ${t.name}`.substring(0, 24),
    description: t.name.length > 18 ? t.name.substring(0, 70) : undefined
  }));
  rows.push({ id: 'NAV_MENU', title: '🏠 Home' });

  await S.sendList(to, `🎯 Chapter ${st.ch}\nTopic ಆರಿಸಿ / Choose Topic:`,
    'Select Topic', rows, 'Topics');
}

// ============================================================
// TOPIC MENU
// ============================================================
async function showTopicMenu(to, topicIndex, track = true) {
  const st = getState(to);
  if (track) pushHistory(st, 'topicMenu');
  st.flow = 'topicMenu';
  st.topicIndex = topicIndex;
  st.subtopicIndex = null;
  st.contentSource = null;

  const topics = N.getTopics(st.cls, st.subject, st.ch);
  const topic = topics[topicIndex];
  if (!topic) { await S.sendText(to, '⚠️ Topic ಸಿಗಲಿಲ್ಲ.'); return; }

  const body = `📘 ${topic.num} ${topic.name}\nಏನು ಬೇಕು? / What do you need?`;

  const c = N.getChapter(st.cls, st.subject, st.ch);
  const flags = N.contentFlags(c.topics[topicIndex].sections);

  const rows = [];
  if (flags.notes) rows.push({ id: 'CONTENT_NOTES', title: '📖 Notes' });
  if (flags.qa)    rows.push({ id: 'CONTENT_QA', title: '❓ Q&A' });
  if (flags.quiz)  rows.push({ id: 'CONTENT_QUIZ', title: '📝 Quiz' });
  if (topic.hasSubtopics) rows.push({ id: 'CONTENT_SUBTOPICS', title: '📂 Sub-topics' });
  rows.push({ id: 'NAV_MENU', title: '🏠 Home' });

  if (rows.length > 4) {
    await S.sendList(to, body, 'Select', rows, 'Topic Menu');
  } else {
    await S.sendButtons(to, body, rows);
  }
}

// ============================================================
// SUB-TOPIC LIST
// ============================================================
async function showSubtopics(to, track = true) {
  const st = getState(to);
  if (track) pushHistory(st, 'subtopics');
  st.flow = 'subtopics';

  const subs = N.getSubtopics(st.cls, st.subject, st.ch, st.topicIndex);
  if (subs.length === 0) { await S.sendText(to, '⚠️ Sub-topics ಇಲ್ಲ.'); return; }

  const rows = subs.map((s, i) => ({
    id: `SUBTOPIC_${i}`,
    title: `${s.num} ${s.name}`.substring(0, 24),
    description: s.name.length > 18 ? s.name.substring(0, 70) : undefined
  }));
  rows.push({ id: 'NAV_MENU', title: '🏠 Home' });

  await S.sendList(to, `📂 Sub-topics ಆರಿಸಿ / Choose Sub-topic:`,
    'Select', rows, 'Sub-topics');
}

// ============================================================
// SUB-TOPIC MENU
// ============================================================
async function showSubtopicMenu(to, subIndex, track = true) {
  const st = getState(to);
  if (track) pushHistory(st, 'subtopicMenu');
  st.flow = 'subtopicMenu';
  st.subtopicIndex = subIndex;
  st.contentSource = null;

  const subs = N.getSubtopics(st.cls, st.subject, st.ch, st.topicIndex);
  const sub = subs[subIndex];
  if (!sub) { await S.sendText(to, '⚠️ Sub-topic ಸಿಗಲಿಲ್ಲ.'); return; }

  const subObj = N.getSubtopic(st.cls, st.subject, st.ch, st.topicIndex, subIndex);
  const flags = N.contentFlags(subObj.sections);
  const rows = [];
  if (flags.notes) rows.push({ id: 'CONTENT_NOTES', title: '📖 Notes' });
  if (flags.qa)    rows.push({ id: 'CONTENT_QA', title: '❓ Q&A' });
  if (flags.quiz)  rows.push({ id: 'CONTENT_QUIZ', title: '📝 Quiz' });
  rows.push({ id: 'NAV_MENU', title: '🏠 Home' });

  const body = `📘 ${sub.num} ${sub.name}\nಏನು ಬೇಕು? / What do you need?`;
  if (rows.length > 3) {
    await S.sendList(to, body, 'Select', rows, 'Sub-topic Menu');
  } else {
    await S.sendButtons(to, body, rows);
  }
}

// ============================================================
// BACK → now just goes Home (simplified, reliable)
// ============================================================
async function handleBack(to) {
  const st = getState(to);
  await showMainMenu(to, st.cls);
}

module.exports = {
  userState, getState, resetState, pushHistory,
  showMainMenu, showParts, showChapters, showChapterMenu,
  showTopics, showTopicMenu, showSubtopics, showSubtopicMenu,
  handleBack
};
