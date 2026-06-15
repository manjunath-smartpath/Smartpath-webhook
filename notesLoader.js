// ============================================================
// SECTION 2: JSON NOTES LOADER  (Smartpath Kalike Phase 3)
// ============================================================
// Loads all chapter JSON files into memory at startup.
// Provides helper functions for tap-navigation.
// Scope: 8th, 9th, 10th only. Each class has Part 1 + Part 2.
// ============================================================

const fs = require('fs');
const path = require('path');

const NOTES_DIR = __dirname;  // JSON files are in repo root (alongside index.js)

// notesDB key = "{cls}_{subject}_{chapter}"  e.g. "9_Science_9"
const notesDB = {};

// index = { "9_Science": { "1": ["1","2","5",...], "2": [...] } }
//          class+subject → part → [chapter numbers]
const chapterIndex = {};

function normalizePart(rawPart) {
  const p = String(rawPart || '').toLowerCase();
  return p.includes('2') ? '2' : '1';
}

function normalizeClass(rawClass) {
  const c = String(rawClass || '').toLowerCase();
  if (c.startsWith('x') || c.includes('10')) return '10';
  const m = c.match(/\d+/);
  return m ? m[0] : '';
}

function normalizeSubject(rawSubject) {
  const s = String(rawSubject || '').toLowerCase();
  return s.includes('math') ? 'Maths' : 'Science';
}

function loadAllNotes() {
  const files = fs.readdirSync(NOTES_DIR).filter(f =>
    f.endsWith('.json') &&
    !f.startsWith('_') &&
    f !== 'package.json' &&
    f !== 'package-lock.json' &&
    /^\d+th_/.test(f)   // only chapter files like "8th_Science_Ch1.json"
  );
  let loaded = 0;

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(NOTES_DIR, file), 'utf8');
      const data = JSON.parse(raw);
      const m = data.metadata;

      const cls = normalizeClass(m.class);
      const subj = normalizeSubject(m.subject);
      const part = normalizePart(m.part);
      const ch = String(m.chapter_num);

      // Only serve 8, 9, 10
      if (!['8', '9', '10'].includes(cls)) continue;

      const key = `${cls}_${subj}_${ch}`;
      notesDB[key] = data;

      // Build chapter index
      const idxKey = `${cls}_${subj}`;
      if (!chapterIndex[idxKey]) chapterIndex[idxKey] = { '1': [], '2': [] };
      chapterIndex[idxKey][part].push(ch);

      loaded++;
    } catch (e) {
      console.error(`Notes load error [${file}]:`, e.message);
    }
  }

  // Sort chapter numbers within each part
  for (const idxKey in chapterIndex) {
    for (const part of ['1', '2']) {
      chapterIndex[idxKey][part].sort((a, b) => parseInt(a) - parseInt(b));
    }
  }

  console.log(`✅ Notes loaded: ${loaded} chapters`);
  return loaded;
}

// ---------- HELPER FUNCTIONS (for navigation) ----------

// Get chapter numbers for a class+subject+part → ["1","2","5"]
function getChapters(cls, subject, part) {
  const idxKey = `${cls}_${subject}`;
  return (chapterIndex[idxKey] && chapterIndex[idxKey][String(part)]) || [];
}

// All chapters for a class (both subjects) — for daily study plan
function allChaptersForClass(cls) {
  const out = [];
  for (const key of Object.keys(notesDB)) {
    if (!key.startsWith(cls + '_')) continue;
    const parts = key.split('_');
    const c = notesDB[key];
    out.push({
      key, subject: parts[1], ch: parts[2],
      name: (c.metadata && c.metadata.chapter_name) || ''
    });
  }
  return out;
}

// Get full chapter data → { metadata, chapter_sections, topics }
function getChapter(cls, subject, ch) {
  return notesDB[`${cls}_${subject}_${ch}`] || null;
}

// Chapter name → "FRICTION"
function getChapterName(cls, subject, ch) {
  const c = getChapter(cls, subject, ch);
  return c ? c.metadata.chapter_name : '';
}

// Does chapter have chapter-level content (Def/Q&A/Quiz)?
function hasChapterContent(cls, subject, ch) {
  const c = getChapter(cls, subject, ch);
  if (!c) return false;
  // True if chapter_sections has any qa/mcq/definition with content
  return c.chapter_sections.some(s =>
    (s.type === 'qa' && (s.items || []).length > 0) ||
    (s.type === 'mcq' && (s.items || []).length > 0) ||
    (s.type === 'definition' && s.text) ||
    (s.type === 'key_points' && (s.points || []).length > 0)
  );
}

// What content types exist in a sections array?
function contentFlags(sectionsArr) {
  const arr = sectionsArr || [];
  const has = (t) => arr.some(s => s.type === t &&
    ((s.items || []).length > 0 || s.text || (s.points || []).length > 0 ||
     s.aim || s.statement || s.raw || s.label));
  const qaCount = arr.filter(s => s.type === 'qa').reduce((n, s) => n + (s.items || []).length, 0);
  const mcqCount = arr.filter(s => s.type === 'mcq').reduce((n, s) =>
    n + (s.items || []).filter(m => {
      const o = m.options || {};
      return Object.keys(o).filter(k => o[k] && String(o[k]).trim()).length >= 2;
    }).length, 0);
  return {
    notes: has('definition') || has('key_points') || has('additional_facts'),
    qa: qaCount > 0,
    quiz: mcqCount > 0,
    activity: has('activity') || has('experiment'),
    examples: has('formulas') || has('theorem'),
    exercise: has('exercise') || has('textbook_exercises'),
    diagrams: has('diagrams')
  };
}

function chapterContentFlags(cls, subject, ch) {
  const c = getChapter(cls, subject, ch);
  return c ? contentFlags(c.chapter_sections) : {};
}

// Get topics list → [{num, name, mode, hasSubtopics}]
function getTopics(cls, subject, ch) {
  const c = getChapter(cls, subject, ch);
  if (!c) return [];
  return c.topics.map(t => ({
    num: t.topic_num,
    name: t.topic_name,
    mode: t.mode,
    hasSubtopics: (t.subtopics || []).length > 0
  }));
}

// Get sub-topics of a topic → [{num, name}]
function getSubtopics(cls, subject, ch, topicIndex) {
  const c = getChapter(cls, subject, ch);
  if (!c || !c.topics[topicIndex]) return [];
  return (c.topics[topicIndex].subtopics || []).map(st => ({
    num: st.subtopic_num,
    name: st.subtopic_name
  }));
}

// Get a specific topic object
function getTopic(cls, subject, ch, topicIndex) {
  const c = getChapter(cls, subject, ch);
  return (c && c.topics[topicIndex]) || null;
}

// Get a specific subtopic object
function getSubtopic(cls, subject, ch, topicIndex, subIndex) {
  const t = getTopic(cls, subject, ch, topicIndex);
  return (t && t.subtopics && t.subtopics[subIndex]) || null;
}

// Extract sections of a given type from a sections array
function getSections(sectionsArr, type) {
  return (sectionsArr || []).filter(s => s.type === type);
}

// Collect all Q&A items from a sections array → [{q_num, marks, question, answer}]
function collectQA(sectionsArr) {
  const out = [];
  for (const s of (sectionsArr || [])) {
    if (s.type === 'qa') out.push(...(s.items || []));
  }
  return out;
}

// Collect all MCQ items from a sections array
function collectMCQ(sectionsArr) {
  const out = [];
  for (const s of (sectionsArr || [])) {
    if (s.type === 'mcq') out.push(...(s.items || []));
  }
  return out;
}

module.exports = {
  loadAllNotes,
  getChapters,
  allChaptersForClass,
  getChapter,
  getChapterName,
  hasChapterContent,
  contentFlags,
  chapterContentFlags,
  getTopics,
  getSubtopics,
  getTopic,
  getSubtopic,
  getSections,
  collectQA,
  collectMCQ,
  // expose for debugging
  _notesDB: notesDB,
  _chapterIndex: chapterIndex
};
