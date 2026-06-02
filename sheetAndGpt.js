// ============================================================
// SECTION 5 + 6: GOOGLE SHEET + GPT (₹299 gating)
// Smartpath Kalike Phase 3
// ============================================================
// Sheet columns (FINAL):
//   Phone | Name | Class | School | City | Status | Plan |
//   StartDate | ExpiryDate | GPT_Count | GPT_Date | Registration_Step
//
// Status: TRIAL / ACTIVE / EXPIRED / BLOCKED
// Plan:   "" / 199 / 299   (₹99 removed; admin sets after payment)
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

// ---------- EVALUATION (₹299, 5/day) ----------
const EVAL_DAILY_LIMIT = 5;

function checkEvalAccess(student) {
  const plan = getPlan(student);
  if (plan !== '299') {
    return { allowed: false, reason: 'plan', remaining: 0 };
  }
  const today = new Date().toISOString().split('T')[0];
  const evalDate = student.get('Eval_Date') || '';
  let count = parseInt(student.get('Eval_Count') || '0', 10);
  if (evalDate !== today) count = 0;
  if (count >= EVAL_DAILY_LIMIT) {
    return { allowed: false, reason: 'limit', remaining: 0 };
  }
  return { allowed: true, reason: 'ok', remaining: EVAL_DAILY_LIMIT - count };
}

async function incrementEvalCount(student) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const evalDate = student.get('Eval_Date') || '';
    let count = parseInt(student.get('Eval_Count') || '0', 10);
    if (evalDate !== today) count = 0;
    count++;
    student.set('Eval_Count', String(count));
    student.set('Eval_Date', today);
    await student.save();
  } catch (e) {
    console.error('Eval count update error:', e.message);
  }
}

// Evaluate a student's answer using GPT (with model answer from JSON)
async function evaluateAnswer(cls, subject, question, marks, modelAnswer, studentAnswer) {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const sys = `You are a KSEEB class ${cls} ${subject} teacher. ` +
      `Evaluate the student's answer strictly but kindly. ` +
      `Give marks out of ${marks}. Compare against the model answer. ` +
      `Point out: correct points (✅), minor mistakes (⚠️), missed points (❌), grammar errors. ` +
      `Then give a better model answer. Keep response under 250 words. ` +
      `Use a simple Kannada + English mix. Use this exact format:\n` +
      `📝 EVALUATION REPORT — X/${marks} marks\n\n✅ ಸರಿ ಇದೆ:\n...\n\n⚠️ Minor mistakes:\n...\n\n❌ Miss ಆಗಿದ್ದು:\n...\n\n💡 Better answer:\n...`;
    const user = `Question: ${question} (${marks} marks)\n\n` +
      `Model Answer (reference): ${modelAnswer}\n\n` +
      `Student Answer: ${studentAnswer}\n\nEvaluate and give the report.`;
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      max_tokens: 500, temperature: 0.3
    });
    return cleanLatex(resp.choices[0].message.content.trim());
  } catch (e) {
    console.error('Evaluate error:', e.message);
    return null;
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

// ---------- SCHOOL CODE SYSTEM ----------
// SchoolCodes tab: Code|School|Class|Plan|DurationMonths|MaxUses|UsedCount|Active|ExpiryDate
async function validateSchoolCode(code, studentClass) {
  try {
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle['SchoolCodes'];
    if (!sheet) return { ok: false, reason: 'no_codes' };
    const rows = await sheet.getRows();
    const row = rows.find(r =>
      String(r.get('Code') || '').trim().toUpperCase() === String(code).trim().toUpperCase());
    if (!row) return { ok: false, reason: 'invalid' };

    // Active check
    if (String(row.get('Active') || '').trim().toUpperCase() !== 'YES')
      return { ok: false, reason: 'inactive' };

    // Expiry check
    const exp = row.get('ExpiryDate');
    if (exp && new Date(exp) < new Date())
      return { ok: false, reason: 'expired' };

    // MaxUses check
    const maxU = parseInt(row.get('MaxUses')) || 0;
    const used = parseInt(row.get('UsedCount')) || 0;
    if (maxU > 0 && used >= maxU)
      return { ok: false, reason: 'limit_reached' };

    // Class match check
    const codeClass = String(row.get('Class') || '').replace(/[^\d]/g, '');
    const stuClass = String(studentClass || '').replace(/[^\d]/g, '');
    if (codeClass && stuClass && codeClass !== stuClass)
      return { ok: false, reason: 'class_mismatch', codeClass };

    // Valid — return plan details
    const months = parseInt(row.get('DurationMonths')) || 12;
    return {
      ok: true, row,
      plan: String(row.get('Plan') || '199').trim(),
      months, school: row.get('School') || ''
    };
  } catch (e) {
    console.error('Code validate error:', e.message);
    return { ok: false, reason: 'error' };
  }
}

// Increment UsedCount after successful redemption
async function redeemSchoolCode(codeRow) {
  try {
    const used = parseInt(codeRow.get('UsedCount')) || 0;
    codeRow.set('UsedCount', String(used + 1));
    await codeRow.save();
    return true;
  } catch (e) {
    console.error('Code redeem error:', e.message);
    return false;
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

// Save one evaluation result (marks parsed from GPT report)
async function saveEvalScore(phone, name, cls, subject, topic, question, score, total) {
  try {
    const doc = await getDoc();
    let sheet = doc.sheetsByTitle['EvalScores'];
    if (!sheet) {
      sheet = await doc.addSheet({ title: 'EvalScores',
        headerValues: ['Date','Phone','Name','Class','Subject','Topic','Question','Score','Total','Percent'] });
    }
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    await sheet.addRow({
      Date: new Date().toISOString(),
      Phone: phone, Name: name || '', Class: cls || '',
      Subject: subject || '', Topic: topic || '',
      Question: (question || '').substring(0, 200),
      Score: String(score), Total: String(total), Percent: String(pct)
    });
    return true;
  } catch (e) {
    console.error('Eval score save error:', e.message);
    return false;
  }
}

// Fetch evaluation stats for a student
async function getEvalStats(phone) {
  try {
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle['EvalScores'];
    if (!sheet) return { count: 0 };
    const rows = await sheet.getRows();
    const mine = rows.filter(r => r.get('Phone') === phone);
    if (!mine.length) return { count: 0 };
    const pcts = mine.map(r => parseInt(r.get('Percent')) || 0);
    const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
    const recent = mine.slice(-3).reverse().map(r => ({
      subject: r.get('Subject'), topic: r.get('Topic'),
      score: r.get('Score'), total: r.get('Total'), percent: r.get('Percent')
    }));
    return { count: mine.length, avg, recent };
  } catch (e) {
    console.error('Eval stats error:', e.message);
    return { count: 0 };
  }
}

// Parse "X/Y marks" from GPT evaluation report
function parseEvalMarks(report, defaultTotal) {
  const m = report.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
  if (m) return { score: parseFloat(m[1]), total: parseInt(m[2]) };
  return { score: 0, total: defaultTotal || 3 };
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

    // subject-wise breakdown
    const bySubject = {};
    for (const r of mine) {
      const subj = r.get('Subject') || 'Other';
      if (!bySubject[subj]) bySubject[subj] = { count: 0, sum: 0 };
      bySubject[subj].count++;
      bySubject[subj].sum += parseInt(r.get('Percent')) || 0;
    }
    const subjects = Object.keys(bySubject).map(s => ({
      subject: s, count: bySubject[s].count,
      avg: Math.round(bySubject[s].sum / bySubject[s].count)
    }));

    // weak topics (percent < 60) — best (lowest) 3 unique by subject+chapter+topic
    const weakMap = {};
    for (const r of mine) {
      const pct = parseInt(r.get('Percent')) || 0;
      if (pct < 60) {
        const key = `${r.get('Subject')}|${r.get('Chapter')}|${r.get('Topic')}`;
        if (!weakMap[key] || pct < weakMap[key].percent) {
          weakMap[key] = {
            subject: r.get('Subject'), chapter: r.get('Chapter'),
            topic: r.get('Topic'), percent: pct
          };
        }
      }
    }
    const weak = Object.values(weakMap).sort((a, b) => a.percent - b.percent).slice(0, 3);

    // study streak (consecutive days ending today/yesterday)
    const days = [...new Set(mine.map(r => (r.get('Date') || '').split('T')[0]))].filter(Boolean).sort().reverse();
    let streak = 0;
    if (days.length) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let cursor = new Date(today);
      // allow streak to start today or yesterday
      const d0 = new Date(days[0]); d0.setHours(0, 0, 0, 0);
      const diff0 = Math.round((today - d0) / 86400000);
      if (diff0 <= 1) {
        cursor = new Date(d0);
        streak = 1;
        for (let i = 1; i < days.length; i++) {
          const di = new Date(days[i]); di.setHours(0, 0, 0, 0);
          const gap = Math.round((cursor - di) / 86400000);
          if (gap === 1) { streak++; cursor = di; }
          else if (gap === 0) { continue; }
          else break;
        }
      }
    }

    return {
      count: mine.length, avg,
      best: { percent: best.get('Percent'), subject: best.get('Subject'), chapter: best.get('Chapter') },
      worst: { percent: worst.get('Percent'), subject: worst.get('Subject'), chapter: worst.get('Chapter') },
      recent, subjects, weak, streak
    };
  } catch (e) {
    console.error('Progress fetch error:', e.message);
    return null;
  }
}

// Send progress report to a parent's WhatsApp number
async function sendParentReport(parentPhone, studentName, cls, progress, evalStats) {
  try {
    const p = progress;
    const stars = '⭐'.repeat(Math.max(1, Math.min(5, Math.round((p.avg || 0) / 20))));
    let msg = `📊 *Smartpath Kalike — Progress Report*\n\n`;
    msg += `ವಿದ್ಯಾರ್ಥಿ: *${studentName}* (${cls}th)\n\n`;
    msg += `📝 ಒಟ್ಟು Quiz: ${p.count}\n`;
    msg += `⭐ Average: ${p.avg}% ${stars}\n\n`;
    if (p.subjects && p.subjects.length) {
      msg += p.subjects.map(s =>
        `${s.subject === 'Maths' ? '📐' : '🔬'} ${s.subject}: ${s.avg}%`).join('  |  ') + '\n\n';
    }
    if (p.best) msg += `💪 Strong: ${p.best.subject} Ch${p.best.chapter} (${p.best.percent}%)\n`;
    if (p.weak && p.weak.length) msg += `⚠️ Improve: ${p.weak[0].subject} Ch${p.weak[0].chapter} (${p.weak[0].percent}%)\n`;
    if (evalStats && evalStats.count > 0) {
      msg += `\n✏️ Writing Practice: ${evalStats.count} answers, avg ${evalStats.avg}%\n`;
    }
    msg += `\n— Smartpath Kalike 🎓`;

    // reuse WhatsApp send via axios (same as sendHelpers)
    const axios = require('axios');
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to: parentPhone, type: 'text', text: { body: msg } },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    return true;
  } catch (e) {
    console.error('Parent report error:', e.response?.data || e.message);
    return false;
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
  saveQuizScore, getProgress, sendParentReport,
  saveEvalScore, getEvalStats, parseEvalMarks,
  validateSchoolCode, redeemSchoolCode,
  checkEvalAccess, incrementEvalCount, evaluateAnswer, EVAL_DAILY_LIMIT,
  GPT_DAILY_LIMIT
};
