// ============================================================
// SECTION 5 + 6: GOOGLE SHEET + GPT (₹299 gating)
// Smartpath Kalike Phase 3
// ============================================================
// Sheet columns (FINAL):
//   Phone | Name | Class | School | City | Status | Plan |
//   StartDate | ExpiryDate | GPT_Count | GPT_Date | Registration_Step
//
// Status: TRIAL / ACTIVE / EXPIRED / BLOCKED
// Plan:   "" / 99 / 199 / 299   (admin sets after payment)
// GPT:    only Plan==299, max 10/day (GPT_Count + GPT_Date)
// ============================================================

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GPT_DAILY_LIMIT = 10;

// ---------- GOOGLE SHEET ----------
async function getSheet() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const jwt = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, jwt);
  await doc.loadInfo();
  return doc.sheetsByIndex[0];
}

async function getStudent(phone) {
  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    return rows.find(r => r.get('Phone') === phone) || null;
  } catch (e) {
    console.error('Sheet read error:', e.message);
    return null;
  }
}

async function saveNewStudent(phone) {
  try {
    const sheet = await getSheet();
    const today = new Date();
    const expiry = new Date(today);
    expiry.setDate(expiry.getDate() + 2);
    await sheet.addRow({
      Phone: phone,
      Name: '', Class: '', School: '', City: '',
      Status: 'TRIAL',
      Plan: '',
      StartDate: today.toISOString().split('T')[0],
      ExpiryDate: expiry.toISOString().split('T')[0],
      GPT_Count: '0',
      GPT_Date: '',
      Registration_Step: 'PENDING_NAME'
    });
  } catch (e) {
    console.error('Sheet write error:', e.message);
  }
}

async function updateStudent(student, field, value) {
  try {
    student.set(field, value);
    await student.save();
  } catch (e) {
    console.error('Sheet update error:', e.message);
  }
}

// ---------- STATUS / PLAN HELPERS ----------
function getPlan(student) {
  return String(student.get('Plan') || '').trim();   // "", "99", "199", "299"
}

function getStatus(student) {
  return String(student.get('Status') || '').trim().toUpperCase();
}

function isExpired(student) {
  const exp = student.get('ExpiryDate') || student.get('Expiry_Date');
  if (!exp) return false;
  return new Date() > new Date(exp);
}

// Can this student use the bot at all? (browse/notes/quiz)
// TRIAL (not expired) or ACTIVE → yes. BLOCKED/EXPIRED → no.
function hasAccess(student) {
  const status = getStatus(student);
  if (status === 'BLOCKED' || status === 'EXPIRED') return false;
  if (status === 'TRIAL' && isExpired(student)) return false;
  return true;   // TRIAL (valid) or ACTIVE
}

// ---------- GPT ACCESS (₹299 only, 10/day) ----------
// Returns { allowed: bool, reason: 'ok'|'plan'|'limit', remaining: n }
function checkGptAccess(student) {
  const plan = getPlan(student);
  if (plan !== '299') {
    return { allowed: false, reason: 'plan', remaining: 0 };
  }
  const today = new Date().toISOString().split('T')[0];
  const gptDate = student.get('GPT_Date') || '';
  let count = parseInt(student.get('GPT_Count') || '0', 10);
  if (gptDate !== today) count = 0;   // new day → reset

  if (count >= GPT_DAILY_LIMIT) {
    return { allowed: false, reason: 'limit', remaining: 0 };
  }
  return { allowed: true, reason: 'ok', remaining: GPT_DAILY_LIMIT - count };
}

// Increment GPT count after a successful GPT answer
async function incrementGptCount(student) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const gptDate = student.get('GPT_Date') || '';
    let count = parseInt(student.get('GPT_Count') || '0', 10);
    if (gptDate !== today) count = 0;
    count++;
    student.set('GPT_Count', String(count));
    student.set('GPT_Date', today);
    await student.save();
  } catch (e) {
    console.error('GPT count update error:', e.message);
  }
}

// ---------- GPT (Pinecone + GPT-4o-mini) ----------
const studentMemory = {};

function cleanLatex(text) {
  return text
    .replace(/\\\(|\\\)/g, '').replace(/\\\[|\\\]/g, '')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2')
    .replace(/\\times/g, 'x').replace(/\\div/g, '÷').replace(/\\pm/g, '±')
    .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\{|\}/g, '').replace(/\\\\/g, '\n');
}

async function askKSEEB(question, studentClass, from) {
  try {
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const enhanced = `Class ${studentClass} KSEEB: ${question}`;
    const embRes = await openai.embeddings.create({
      model: 'text-embedding-3-small', input: enhanced
    });
    const queryVector = embRes.data[0].embedding;

    const index = pc.index('kseeb-kalike');
    const searchRes = await index.query({
      vector: queryVector, topK: 8, includeMetadata: true,
      filter: { class: { $eq: studentClass } }
    });

    const context = searchRes.matches
      .filter(m => m.score > 0.3)
      .map(m => m.metadata.text).join('\n\n');

    if (!context || context.trim() === '') {
      return 'ಈ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರ textbook ನಲ್ಲಿ ಸಿಗಲಿಲ್ಲ.';
    }

    const gptRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content:
          `You are a KSEEB Karnataka state board tutor for classes 8-10.
Answer ONLY using the provided context from KSEEB textbooks.
Match the textbook language closely. Do NOT use general knowledge.
Answer in the same language as the question (English→English, Kannada→Kannada).
Keep under 250 words. No LaTeX — plain text math only.
If not in context, say: "ಈ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರ textbook ನಲ್ಲಿ ಸಿಗಲಿಲ್ಲ"

Context:
${context}` },
        { role: 'user', content: question }
      ],
      max_tokens: 500
    });

    return cleanLatex(gptRes.choices[0].message.content);
  } catch (e) {
    console.error('askKSEEB error:', e.message);
    return '⚠️ ತಾಂತ್ರಿಕ ತೊಂದರೆ ಆಗಿದೆ, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';
  }
}

// ---------- QUIZ SCORE HISTORY ----------
async function getDoc() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const jwt = new JWT({
    email: creds.client_email, key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, jwt);
  await doc.loadInfo();
  return doc;
}

// Save one quiz result
async function saveQuizScore(phone, name, cls, subject, chapter, topic, score, total) {
  try {
    const doc = await getDoc();
    let sheet = doc.sheetsByTitle['QuizScores'];
    if (!sheet) {
      sheet = await doc.addSheet({ title: 'QuizScores',
        headerValues: ['Date','Phone','Name','Class','Subject','Chapter','Topic','Score','Total','Percent'] });
    }
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    await sheet.addRow({
      Date: new Date().toISOString(),
      Phone: phone, Name: name || '', Class: cls || '',
      Subject: subject || '', Chapter: chapter || '', Topic: topic || '',
      Score: String(score), Total: String(total), Percent: String(pct)
    });
    return true;
  } catch (e) {
    console.error('Quiz score save error:', e.message);
    return false;
  }
}

// Fetch progress stats for a student
async function getProgress(phone) {
  try {
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle['QuizScores'];
    if (!sheet) return null;
    const rows = await sheet.getRows();
    const mine = rows.filter(r => r.get('Phone') === phone);
    if (!mine.length) return { count: 0 };

    const pcts = mine.map(r => parseInt(r.get('Percent')) || 0);
    const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);

    // best & worst
    let best = mine[0], worst = mine[0];
    for (const r of mine) {
      if ((parseInt(r.get('Percent')) || 0) > (parseInt(best.get('Percent')) || 0)) best = r;
      if ((parseInt(r.get('Percent')) || 0) < (parseInt(worst.get('Percent')) || 0)) worst = r;
    }

    // recent 5 (last rows)
    const recent = mine.slice(-5).reverse().map(r => ({
      subject: r.get('Subject'), chapter: r.get('Chapter'),
      topic: r.get('Topic'), score: r.get('Score'),
      total: r.get('Total'), percent: r.get('Percent')
    }));

    return {
      count: mine.length, avg,
      best: { percent: best.get('Percent'), subject: best.get('Subject'), chapter: best.get('Chapter') },
      worst: { percent: worst.get('Percent'), subject: worst.get('Subject'), chapter: worst.get('Chapter') },
      recent
    };
  } catch (e) {
    console.error('Progress fetch error:', e.message);
    return null;
  }
}

// ---------- FEEDBACK ----------
async function saveFeedback(phone, name, text) {
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const jwt = new JWT({
      email: creds.client_email, key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, jwt);
    await doc.loadInfo();
    // Use "Feedback" sheet tab, create if missing
    let sheet = doc.sheetsByTitle['Feedback'];
    if (!sheet) {
      sheet = await doc.addSheet({ title: 'Feedback',
        headerValues: ['Date', 'Phone', 'Name', 'Feedback'] });
    }
    await sheet.addRow({
      Date: new Date().toISOString(),
      Phone: phone, Name: name || '', Feedback: text
    });
    return true;
  } catch (e) {
    console.error('Feedback save error:', e.message);
    return false;
  }
}

module.exports = {
  getSheet, getStudent, saveNewStudent, updateStudent,
  getPlan, getStatus, isExpired, hasAccess,
  checkGptAccess, incrementGptCount, askKSEEB,
  saveFeedback,
  saveQuizScore, getProgress,
  GPT_DAILY_LIMIT
};
