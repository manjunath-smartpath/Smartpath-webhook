// ============================================================
// SECTION 3 + 7: STATE TRACKING + NAVIGATION ENGINE
// Smartpath Kalike Phase 3
// ============================================================
// In-memory state + tap-navigation functions.
// Flow: MainMenu → Part → Chapters → (ChapterMenu) → Topics
//       → TopicMenu → (Subtopics) → Content (Notes/Q&A/Quiz)
// ============================================================

const N = require('./notesLoader');
const S = require('./sendHelpers');

// ---------- STATE TRACKING (in-memory) ----------
// userState[phone] = { flow, subject, cls, part, ch, chapterKey,
//                      hasChContent, topicIndex, subtopicIndex,
//                      qaList, qaIndex, qaSource,
//                      quizList, quizIndex, quizScore, quizResults }
const userState = {};

function getState(phone) {
  if (!userState[phone]) userState[phone] = {};
  return userState[phone];
}

function resetState(phone) {
  userState[phone] = {};
}

// ---------- ID ENCODING HELPERS ----------
// SUBJ_Maths, PART_1, CH_9, CHCONTENT_NOTES, TOPIC_2,
// SUBTOPIC_1, CONTENT_QUIZ, QA_NEXT, QUIZ_ANS_B, NAV_MENU

// ============================================================
// STAGE 3: MAIN MENU (Subject selection)
// ============================================================
async function showMainMenu(to, cls) {
  const st = getState(to);
  st.flow = 'menu';
  st.cls = cls;
  await S.sendButtons(to, '📚 ಏನು ಕಲಿಯಬೇಕು? / What to learn?', [
    { id: 'SUBJ_Maths', title: '📐 ಗಣಿತ Maths' },
    { id: 'SUBJ_Science', title: '🔬 ವಿಜ್ಞಾನ Science' }
  ]);
}

// ============================================================
// STAGE 4: PART SELECTION (always shown)
// ============================================================
async function showParts(to, subject) {
  const st = getState(to);
  st.flow = 'part';
  st.subject = subject;
  await S.sendButtons(to, `📚 ${subject} — Part ಆರಿಸಿ / Choose Part:`, [
    { id: 'PART_1', title: 'Part 1' },
    { id: 'PART_2', title: 'Part 2' }
  ]);
}

// ============================================================
// STAGE 5: CHAPTER LIST
// ============================================================
async function showChapters(to, part) {
  const st = getState(to);
  st.flow = 'chapters';
  st.part = part;

  const chapters = N.getChapters(st.cls, st.subject, part);
  if (chapters.length === 0) {
    await S.sendText(to, '⚠️ ಈ part ನಲ್ಲಿ chapters ಇಲ್ಲ. /menu ಒತ್ತಿ.');
    return;
  }

  const rows = chapters.map(ch => {
    const name = N.getChapterName(st.cls, st.subject, ch);
    return {
      id: `CH_${ch}`,
      title: `Ch${ch}: ${name}`.substring(0, 24),
      description: name.length > 18 ? name : undefined
    };
  });

  await S.sendList(to,
    `📖 ${st.subject} Part ${part}\nChapter ಆರಿಸಿ / Choose Chapter:`,
    'Select Chapter', rows, `Part ${part} Chapters`);
}

// ============================================================
// STAGE 6: CHAPTER MENU (CONDITIONAL)
// ============================================================
async function showChapterMenu(to, ch) {
  const st = getState(to);
  st.ch = ch;
  st.chapterKey = `${st.cls}_${st.subject}_${ch}`;

  const chName = N.getChapterName(st.cls, st.subject, ch);
  const hasContent = N.hasChapterContent(st.cls, st.subject, ch);
  st.hasChContent = hasContent;

  if (hasContent) {
    // Show chapter-level menu (list, 4 options)
    st.flow = 'chapterMenu';
    await S.sendList(to,
      `📘 Chapter ${ch}: ${chName}\nಏನು ಬೇಕು? / What do you need?`,
      'Select', [
        { id: 'CHCONTENT_NOTES', title: '📖 Chapter Notes' },
        { id: 'CHCONTENT_TOPICS', title: '📋 Topics' },
        { id: 'CHCONTENT_QA', title: '❓ Chapter Q&A' },
        { id: 'CHCONTENT_QUIZ', title: '📝 Chapter Quiz' }
      ], 'Chapter Menu');
  } else {
    // Skip directly to topics
    await showTopics(to, ch);
  }
}

// ============================================================
// STAGE 7: TOPIC LIST
// ============================================================
async function showTopics(to, ch) {
  const st = getState(to);
  st.flow = 'topics';
  if (ch) { st.ch = ch; st.chapterKey = `${st.cls}_${st.subject}_${ch}`; }

  const topics = N.getTopics(st.cls, st.subject, st.ch);
  if (topics.length === 0) {
    await S.sendText(to, '⚠️ ಈ chapter ನಲ್ಲಿ topics ಇಲ್ಲ. /menu ಒತ್ತಿ.');
    return;
  }

  const rows = topics.map((t, i) => ({
    id: `TOPIC_${i}`,
    title: `${t.num} ${t.name}`.substring(0, 24),
    description: t.name.length > 18 ? t.name.substring(0, 70) : undefined
  }));

  await S.sendList(to,
    `🎯 Chapter ${st.ch}\nTopic ಆರಿಸಿ / Choose Topic:`,
    'Select Topic', rows, 'Topics');
}

// ============================================================
// STAGE 8: TOPIC MENU (Mode A vs B)
// ============================================================
async function showTopicMenu(to, topicIndex) {
  const st = getState(to);
  st.flow = 'topicMenu';
  st.topicIndex = topicIndex;
  st.subtopicIndex = null;

  const topics = N.getTopics(st.cls, st.subject, st.ch);
  const topic = topics[topicIndex];
  if (!topic) {
    await S.sendText(to, '⚠️ Topic ಸಿಗಲಿಲ್ಲ. /menu ಒತ್ತಿ.');
    return;
  }

  const body = `📘 ${topic.num} ${topic.name}\nಏನು ಬೇಕು? / What do you need?`;

  if (topic.hasSubtopics) {
    // Mode A → 4 options → list message
    await S.sendList(to, body, 'Select', [
      { id: 'CONTENT_NOTES', title: '📖 Notes' },
      { id: 'CONTENT_QA', title: '❓ Q&A' },
      { id: 'CONTENT_QUIZ', title: '📝 Quiz' },
      { id: 'CONTENT_SUBTOPICS', title: '📂 Sub-topics' }
    ], 'Topic Menu');
  } else {
    // Mode B → 3 options → reply buttons
    await S.sendButtons(to, body, [
      { id: 'CONTENT_NOTES', title: '📖 Notes' },
      { id: 'CONTENT_QA', title: '❓ Q&A' },
      { id: 'CONTENT_QUIZ', title: '📝 Quiz' }
    ]);
  }
}

// ============================================================
// STAGE 8b: SUB-TOPIC LIST (Mode A only)
// ============================================================
async function showSubtopics(to) {
  const st = getState(to);
  st.flow = 'subtopics';

  const subs = N.getSubtopics(st.cls, st.subject, st.ch, st.topicIndex);
  if (subs.length === 0) {
    await S.sendText(to, '⚠️ Sub-topics ಇಲ್ಲ.');
    return;
  }

  const rows = subs.map((s, i) => ({
    id: `SUBTOPIC_${i}`,
    title: `${s.num} ${s.name}`.substring(0, 24),
    description: s.name.length > 18 ? s.name.substring(0, 70) : undefined
  }));

  await S.sendList(to,
    `📂 Sub-topics ಆರಿಸಿ / Choose Sub-topic:`,
    'Select', rows, 'Sub-topics');
}

// ============================================================
// SUB-TOPIC MENU (after selecting a sub-topic)
// ============================================================
async function showSubtopicMenu(to, subIndex) {
  const st = getState(to);
  st.flow = 'subtopicMenu';
  st.subtopicIndex = subIndex;

  const subs = N.getSubtopics(st.cls, st.subject, st.ch, st.topicIndex);
  const sub = subs[subIndex];
  if (!sub) {
    await S.sendText(to, '⚠️ Sub-topic ಸಿಗಲಿಲ್ಲ.');
    return;
  }

  await S.sendButtons(to,
    `📘 ${sub.num} ${sub.name}\nಏನು ಬೇಕು? / What do you need?`, [
      { id: 'CONTENT_NOTES', title: '📖 Notes' },
      { id: 'CONTENT_QA', title: '❓ Q&A' },
      { id: 'CONTENT_QUIZ', title: '📝 Quiz' }
    ]);
}

// ============================================================
// BACK / MENU navigation
// ============================================================
async function handleBack(to) {
  const st = getState(to);
  // Simple back: go to topic list of current chapter
  if (st.ch) {
    await showTopics(to, st.ch);
  } else {
    await showMainMenu(to, st.cls);
  }
}

module.exports = {
  userState,
  getState,
  resetState,
  showMainMenu,
  showParts,
  showChapters,
  showChapterMenu,
  showTopics,
  showTopicMenu,
  showSubtopics,
  showSubtopicMenu,
  handleBack
};
