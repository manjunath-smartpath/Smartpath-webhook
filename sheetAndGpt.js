// ============================================================
// SECTION 5 + 6: SUPABASE + GPT (₹299 gating)
// Smartpath Kalike — Supabase version (drop-in replacement)
// ============================================================
// Tables: students, school_codes, quiz_scores, eval_scores, feedback
// Student object keeps SAME interface as before:
//   .get('Phone'), .set('Plan', v), await .save()
// so index.js / navigation.js need NO changes.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const GPT_DAILY_LIMIT = 10;
const EVAL_DAILY_LIMIT = 5;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---------- COLUMN MAPPING (Sheet name → DB column) ----------
// Lets old code keep using student.get('Phone'), student.set('GPT_Count', ...)
const COL = {
  Phone:'phone', Name:'name', Class:'class', School:'school', City:'city',
  StartDate:'start_date', Status:'status', ExpiryDate:'expiry_date',
  Registration_Step:'registration_step', Plan:'plan',
  GPT_Count:'gpt_count', GPT_Date:'gpt_date', ParentPhone:'parent_phone',
  Eval_Count:'eval_count', Eval_Date:'eval_date', RegNo:'regno'
};
function toDbCol(field){ return COL[field] || field.toLowerCase(); }

// Wrap a DB row so it behaves like the old google-spreadsheet row object
function wrapStudent(row) {
  const data = { ...row };
  return {
    _dirty: {},
    get(field) {
      const v = data[toDbCol(field)];
      return v === null || v === undefined ? '' : String(v);
    },
    set(field, value) {
      const col = toDbCol(field);
      data[col] = value;
      this._dirty[col] = value;
    },
    async save() {
      try {
        if (Object.keys(this._dirty).length === 0) return;
        await supabase.from('students').update(this._dirty).eq('phone', data.phone);
        this._dirty = {};
      } catch (e) {
        console.error('Student save error:', e.message);
      }
    },
    _raw: data
  };
}

// ---------- STUDENT CRUD ----------
async function getStudent(phone) {
  try {
    const { data, error } = await supabase
      .from('students').select('*').eq('phone', phone).maybeSingle();
    if (error) { console.error('getStudent error:', error.message); return null; }
    return data ? wrapStudent(data) : null;
  } catch (e) {
    console.error('getStudent error:', e.message);
    return null;
  }
}

async function saveNewStudent(phone) {
  try {
    const today = new Date();
    const expiry = new Date(today);
    expiry.setDate(expiry.getDate() + 2);
    await supabase.from('students').insert({
      phone,
      name:'', class:'', school:'', city:'',
      status:'TRIAL', plan:'',
      start_date: today.toISOString().split('T')[0],
      expiry_date: expiry.toISOString().split('T')[0],
      gpt_count: 0, gpt_date:'',
      registration_step:'PENDING_NAME'
    });
  } catch (e) {
    console.error('saveNewStudent error:', e.message);
  }
}

async function updateStudent(student, field, value) {
  try {
    student.set(field, value);
    await student.save();
  } catch (e) {
    console.error('updateStudent error:', e.message);
  }
}

// ---------- STATUS / PLAN HELPERS (unchanged) ----------
function getPlan(student) { return String(student.get('Plan') || '').trim(); }
function getStatus(student) { return String(student.get('Status') || '').trim().toUpperCase(); }
function isExpired(student) {
  const exp = student.get('ExpiryDate');
  if (!exp) return false;
  return new Date() > new Date(exp);
}
function hasAccess(student) {
  const status = getStatus(student);
  if (status === 'BLOCKED' || status === 'EXPIRED') return false;
  if (status === 'TRIAL' && isExpired(student)) return false;
  return true;
}

// ---------- GPT ACCESS (₹299 only, 10/day) ----------
function checkGptAccess(student) {
  const plan = getPlan(student);
  if (plan !== '299') return { allowed:false, reason:'plan', remaining:0 };
  const today = new Date().toISOString().split('T')[0];
  const gptDate = student.get('GPT_Date') || '';
  let count = parseInt(student.get('GPT_Count') || '0', 10);
  if (gptDate !== today) count = 0;
  if (count >= GPT_DAILY_LIMIT) return { allowed:false, reason:'limit', remaining:0 };
  return { allowed:true, reason:'ok', remaining: GPT_DAILY_LIMIT - count };
}

async function incrementGptCount(student) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const gptDate = student.get('GPT_Date') || '';
    let count = parseInt(student.get('GPT_Count') || '0', 10);
    if (gptDate !== today) count = 0;
    count++;
    student.set('GPT_Count', count);
    student.set('GPT_Date', today);
    await student.save();
  } catch (e) {
    console.error('GPT count error:', e.message);
  }
}

// ---------- EVALUATION ACCESS (₹299, 5/day) ----------
function checkEvalAccess(student) {
  const plan = getPlan(student);
  if (plan !== '299') return { allowed:false, reason:'plan', remaining:0 };
  const today = new Date().toISOString().split('T')[0];
  const evalDate = student.get('Eval_Date') || '';
  let count = parseInt(student.get('Eval_Count') || '0', 10);
  if (evalDate !== today) count = 0;
  if (count >= EVAL_DAILY_LIMIT) return { allowed:false, reason:'limit', remaining:0 };
  return { allowed:true, reason:'ok', remaining: EVAL_DAILY_LIMIT - count };
}

async function incrementEvalCount(student) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const evalDate = student.get('Eval_Date') || '';
    let count = parseInt(student.get('Eval_Count') || '0', 10);
    if (evalDate !== today) count = 0;
    count++;
    student.set('Eval_Count', count);
    student.set('Eval_Date', today);
    await student.save();
  } catch (e) {
    console.error('Eval count error:', e.message);
  }
}

async function evaluateAnswer(cls, subject, question, marks, modelAnswer, studentAnswer) {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const sys = `You are a warm, encouraging KSEEB class ${cls} ${subject} teacher. ` +
      `Evaluate the student's written answer out of ${marks} marks. ` +
      `Also analyze spelling and grammar separately as ERROR PERCENTAGE (not marks). ` +
      `Be encouraging — celebrate good points first, then guide gently. ` +
      `Use a friendly Kannada + English mix. Use EXACTLY this format:\n\n` +
      `🎯 *MARKS: X/${marks}*\n\n` +
      `✅ *ಚೆನ್ನಾಗಿ ಬರೆದಿದ್ದು (Good points):*\n• point\n\n` +
      `📌 *ಸೇರಿಸಬೇಕಾಗಿದ್ದು (To improve):*\n• missed point (or ✅ ಎಲ್ಲ correct!)\n\n` +
      `🔤 *Spelling Analysis:*\n` +
      `Error rate: X% (X out of ~Y words misspelled)\n` +
      `• "wrongword" → "correctword" (list up to 3 mistakes, or ✅ No spelling mistakes!)\n\n` +
      `✍️ *Grammar Analysis:*\n` +
      `Error rate: X% (X grammar errors found)\n` +
      `• wrong usage → correct usage (list up to 3 errors, or ✅ No grammar mistakes!)\n\n` +
      `💡 *Model Answer (ideal):*\n(complete correct answer, exam-ready)\n\n` +
      `🌟 *Teacher's tip:* (one short motivating line)\n\n` +
      `Rules for error rate: count total words in student answer, ` +
      `spelling error rate = (misspelled words / total words) × 100, ` +
      `grammar error rate = (grammar errors / total sentences) × 100. ` +
      `Round to nearest 5%. If 0 errors, say 0%. Keep under 300 words.`;
    const user = `Question (${marks} marks): ${question}\n\n` +
      `Model Answer (textbook reference): ${modelAnswer}\n\n` +
      `Student's Answer: ${studentAnswer}\n\nEvaluate with spelling and grammar analysis.`;
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role:'system', content:sys }, { role:'user', content:user }],
      max_tokens: 700, temperature: 0.3
    });
    return cleanLatex(resp.choices[0].message.content.trim());
  } catch (e) {
    console.error('Evaluate error:', e.message);
    return null;
  }
}

// ---------- GPT (Pinecone + GPT-4o-mini) ----------
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
        { role:'system', content:
`You are a KSEEB Karnataka state board tutor for classes 8-10.
Answer ONLY using the provided context from KSEEB textbooks.
Match the textbook language closely. Do NOT use general knowledge.
Answer in the same language as the question (English→English, Kannada→Kannada).
Keep under 250 words. No LaTeX — plain text math only.
If not in context, say: "ಈ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರ textbook ನಲ್ಲಿ ಸಿಗಲಿಲ್ಲ"

Context:
${context}` },
        { role:'user', content: question }
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
// Wrap school_codes row to keep .get()/.set()/.save() interface
function wrapCode(row) {
  const data = { ...row };
  const SC = {
    Code:'code', School:'school', Class:'class', Plan:'plan',
    DurationMonths:'duration_months', MaxUses:'max_uses',
    UsedCount:'used_count', Active:'active', ExpiryDate:'expiry_date',
    StudentNos:'student_nos'
  };
  return {
    _dirty:{},
    get(f){ const v = data[SC[f] || f.toLowerCase()]; return v===null||v===undefined?'':String(v); },
    set(f,v){ const c = SC[f] || f.toLowerCase(); data[c]=v; this._dirty[c]=v; },
    async save(){
      try {
        if (Object.keys(this._dirty).length===0) return;
        await supabase.from('school_codes').update(this._dirty).eq('code', data.code);
        this._dirty={};
      } catch(e){ console.error('Code save error:', e.message); }
    }
  };
}

async function validateSchoolCode(code, studentClass) {
  try {
    const { data, error } = await supabase
      .from('school_codes').select('*')
      .ilike('code', String(code).trim()).maybeSingle();
    if (error || !data) return { ok:false, reason:'invalid' };
    const row = wrapCode(data);
    if (String(row.get('Active')).trim().toUpperCase() !== 'YES')
      return { ok:false, reason:'inactive' };
    const exp = row.get('ExpiryDate');
    if (exp && new Date(exp) < new Date()) return { ok:false, reason:'expired' };
    const maxU = parseInt(row.get('MaxUses')) || 0;
    const used = parseInt(row.get('UsedCount')) || 0;
    if (maxU > 0 && used >= maxU) return { ok:false, reason:'limit_reached' };
    const codeClass = String(row.get('Class')).replace(/[^\d]/g,'');
    const stuClass = String(studentClass||'').replace(/[^\d]/g,'');
    if (codeClass && stuClass && codeClass !== stuClass)
      return { ok:false, reason:'class_mismatch', codeClass };
    const months = parseInt(row.get('DurationMonths')) || 12;
    return { ok:true, row, plan:String(row.get('Plan')||'199').trim(), months, school:row.get('School')||'' };
  } catch (e) {
    console.error('Code validate error:', e.message);
    return { ok:false, reason:'error' };
  }
}

async function redeemSchoolCode(codeRow, phone, name, regno) {
  try {
    const used = parseInt(codeRow.get('UsedCount')) || 0;
    codeRow.set('UsedCount', used + 1);
    if (phone) {
      const existing = codeRow.get('StudentNos') || '';
      const entry = regno ? `${phone}(${name||''},${regno})` : `${phone}(${name||''})`;
      codeRow.set('StudentNos', existing ? existing + ', ' + entry : entry);
    }
    await codeRow.save();
    return true;
  } catch (e) {
    console.error('Code redeem error:', e.message);
    return false;
  }
}

// ---------- QUIZ SCORE ----------
async function saveQuizScore(phone, name, cls, subject, chapter, topic, score, total) {
  try {
    const pct = total > 0 ? Math.round((score/total)*100) : 0;
    await supabase.from('quiz_scores').insert({
      date: new Date().toISOString(),
      phone, name: name||'', class: cls||'',
      subject: subject||'', chapter: chapter||'', topic: topic||'',
      score, total, percent: pct
    });
    return true;
  } catch (e) {
    console.error('Quiz save error:', e.message);
    return false;
  }
}

async function saveEvalScore(phone, name, cls, subject, topic, question, score, total) {
  try {
    const pct = total > 0 ? Math.round((score/total)*100) : 0;
    await supabase.from('eval_scores').insert({
      date: new Date().toISOString(),
      phone, name: name||'', class: cls||'',
      subject: subject||'', topic: topic||'',
      question: (question||'').substring(0,200),
      score, total, percent: pct
    });
    return true;
  } catch (e) {
    console.error('Eval save error:', e.message);
    return false;
  }
}

async function getEvalStats(phone) {
  try {
    const { data: mine } = await supabase
      .from('eval_scores').select('*').eq('phone', phone).order('id');
    if (!mine || !mine.length) return { count: 0 };
    const pcts = mine.map(r => parseInt(r.percent) || 0);
    const avg = Math.round(pcts.reduce((a,b)=>a+b,0) / pcts.length);
    const recent = mine.slice(-3).reverse().map(r => ({
      subject:r.subject, topic:r.topic, score:r.score, total:r.total, percent:r.percent
    }));
    let bestTopic = null, bestPct = -1;
    for (const r of mine) {
      const pct = parseInt(r.percent) || 0;
      if (pct > bestPct) { bestPct = pct; bestTopic = { topic:r.topic, subject:r.subject, percent:pct }; }
    }
    return { count: mine.length, avg, recent, bestTopic };
  } catch (e) {
    console.error('Eval stats error:', e.message);
    return { count: 0 };
  }
}

function parseEvalMarks(report, defaultTotal) {
  const m = report.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
  if (m) return { score: parseFloat(m[1]), total: parseInt(m[2]) };
  return { score: 0, total: defaultTotal || 3 };
}

async function getProgress(phone) {
  try {
    const { data: mine } = await supabase
      .from('quiz_scores').select('*').eq('phone', phone).order('id');
    if (!mine || !mine.length) return { count: 0 };

    const pcts = mine.map(r => parseInt(r.percent) || 0);
    const avg = Math.round(pcts.reduce((a,b)=>a+b,0) / pcts.length);

    let best = mine[0], worst = mine[0];
    for (const r of mine) {
      if ((parseInt(r.percent)||0) > (parseInt(best.percent)||0)) best = r;
      if ((parseInt(r.percent)||0) < (parseInt(worst.percent)||0)) worst = r;
    }

    const recent = mine.slice(-5).reverse().map(r => ({
      subject:r.subject, chapter:r.chapter, topic:r.topic,
      score:r.score, total:r.total, percent:r.percent
    }));

    const bySubject = {};
    for (const r of mine) {
      const subj = r.subject || 'Other';
      if (!bySubject[subj]) bySubject[subj] = { count:0, sum:0 };
      bySubject[subj].count++;
      bySubject[subj].sum += parseInt(r.percent) || 0;
    }
    const subjects = Object.keys(bySubject).map(s => ({
      subject:s, count:bySubject[s].count,
      avg: Math.round(bySubject[s].sum / bySubject[s].count)
    }));

    const weakMap = {};
    for (const r of mine) {
      const pct = parseInt(r.percent) || 0;
      if (pct < 60) {
        const key = `${r.subject}|${r.chapter}|${r.topic}`;
        if (!weakMap[key] || pct < weakMap[key].percent)
          weakMap[key] = { subject:r.subject, chapter:r.chapter, topic:r.topic, percent:pct };
      }
    }
    const weak = Object.values(weakMap).sort((a,b)=>a.percent-b.percent).slice(0,3);

    const days = [...new Set(mine.map(r => (r.date||'').split('T')[0]))].filter(Boolean).sort().reverse();
    let streak = 0;
    if (days.length) {
      const today = new Date(); today.setHours(0,0,0,0);
      const d0 = new Date(days[0]); d0.setHours(0,0,0,0);
      const diff0 = Math.round((today - d0) / 86400000);
      if (diff0 <= 1) {
        let cursor = new Date(d0); streak = 1;
        for (let i=1; i<days.length; i++) {
          const di = new Date(days[i]); di.setHours(0,0,0,0);
          const gap = Math.round((cursor - di) / 86400000);
          if (gap === 1) { streak++; cursor = di; }
          else if (gap === 0) continue;
          else break;
        }
      }
    }

    const now = new Date();
    const weekMs = 7 * 86400000;
    const thisWeekStart = new Date(now - weekMs);
    const lastWeekStart = new Date(now - 2*weekMs);
    let twSum=0, twN=0, lwSum=0, lwN=0;
    for (const r of mine) {
      const d = new Date(r.date || '');
      const pct = parseInt(r.percent) || 0;
      if (d >= thisWeekStart) { twSum += pct; twN++; }
      else if (d >= lastWeekStart) { lwSum += pct; lwN++; }
    }
    const thisWeek = twN ? Math.round(twSum/twN) : 0;
    const lastWeek = lwN ? Math.round(lwSum/lwN) : 0;
    const improvement = (twN && lwN) ? thisWeek - lastWeek : null;
    const weekly = { thisWeek, lastWeek, improvement, hasData: twN>0 || lwN>0 };

    return {
      count: mine.length, avg,
      best: { percent:best.percent, subject:best.subject, chapter:best.chapter },
      worst: { percent:worst.percent, subject:worst.subject, chapter:worst.chapter },
      recent, subjects, weak, streak, weekly
    };
  } catch (e) {
    console.error('Progress error:', e.message);
    return null;
  }
}

async function sendParentReport(parentPhone, studentName, cls, progress, evalStats) {
  try {
    const p = progress || {};
    const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    let msg = `📊 *SmartPath Kalike — ವಿದ್ಯಾರ್ಥಿ ಪ್ರಗತಿ ವರದಿ*\n\n`;
    msg += `👨‍🎓 *ವಿದ್ಯಾರ್ಥಿ / Student:* ${studentName} (Class ${cls})\n`;
    msg += `📅 *ವರದಿ ದಿನಾಂಕ:* ${today}\n\n`;
    msg += `📝 *Quiz Performance*\n`;
    msg += `• ಒಟ್ಟು Quiz Attempts: ${p.count || 0}\n`;
    msg += `• Average Score: ${p.avg || 0}%\n`;
    if (p.streak && p.streak > 0) msg += `• ಕಲಿಕೆ Streak: ${p.streak} ದಿನ 🔥\n`;
    msg += '\n';
    if (p.subjects && p.subjects.length) {
      msg += `📚 *Subject-wise Performance*\n`;
      for (const s of p.subjects) {
        const icon = s.subject === 'Maths' ? '📐' : '🔬';
        msg += `${icon} ${s.subject}: ${s.avg}%\n`;
      }
      msg += '\n';
    }
    if (p.best && parseInt(p.best.percent) >= 60) {
      msg += `💪 *Strong Area (ಉತ್ತಮ ಸಾಧನೆ)*\n`;
      msg += `• ${p.best.subject} Ch${p.best.chapter}: ${p.best.percent}%\n\n`;
    }
    msg += `🎯 *Improvement Needed (ಹೆಚ್ಚು ಅಭ್ಯಾಸ ಅಗತ್ಯ)*\n`;
    if (p.weak && p.weak.length) {
      for (const w of p.weak.slice(0,2))
        msg += `• ${w.subject} Ch${w.chapter} ನಲ್ಲಿ ಹೆಚ್ಚಿನ Practice ಮಾಡಿ (${w.percent}%)\n`;
    } else {
      msg += `• ಎಲ್ಲ chapters ನಲ್ಲಿ ನಿಯಮಿತ Practice ಮಾಡಿ\n`;
    }
    msg += '\n';
    if (evalStats && evalStats.count > 0) {
      msg += `✍️ *Writing Practice Report*\n`;
      msg += `• Submitted Answers: ${evalStats.count}\n`;
      msg += `• Average Writing Score: ${evalStats.avg}%\n`;
      if (evalStats.bestTopic && evalStats.bestTopic.topic)
        msg += `• Best Topic: ${evalStats.bestTopic.topic} (${evalStats.bestTopic.percent}%)\n`;
      msg += '\n';
    }
    if (p.weekly && p.weekly.hasData) {
      msg += `📈 *Weekly Progress (ವಾರದ ಪ್ರಗತಿ)*\n`;
      msg += `• ಹಿಂದಿನ ವಾರ: ${p.weekly.lastWeek}%\n`;
      msg += `• ಈ ವಾರ: ${p.weekly.thisWeek}%\n`;
      if (p.weekly.improvement !== null) {
        const arrow = p.weekly.improvement >= 0 ? '📈' : '📉';
        const sign = p.weekly.improvement >= 0 ? '+' : '';
        msg += `• Improvement: ${sign}${p.weekly.improvement}% ${arrow}\n`;
      }
      msg += '\n';
    }
    msg += `📈 *ಮುಂದಿನ ಗುರಿ / Recommended Next Steps*\n`;
    msg += `✅ ಇಂದಿನ Quiz ಪೂರ್ಣಗೊಳಿಸಿ\n`;
    if (p.weak && p.weak.length) msg += `✅ ${p.weak[0].subject} ನಲ್ಲಿ ಹೆಚ್ಚುವರಿ Practice ಮಾಡಿ\n`;
    if (evalStats && evalStats.count > 0) msg += `✅ Writing Practice ನಿಯಮಿತವಾಗಿ ಮಾಡಿ\n`;
    msg += '\n';
    msg += `🌟 *SmartPath Recommendation:*\n`;
    msg += `ನಿಯಮಿತ Quiz ಹಾಗೂ Writing Practice ಮಾಡಿದರೆ ವಿದ್ಯಾರ್ಥಿಯ ಅಂಕಗಳು ಮತ್ತು ಕಲಿಕೆಯ ಸಾಮರ್ಥ್ಯ ಇನ್ನಷ್ಟು ಉತ್ತಮವಾಗುತ್ತದೆ.\n\n`;
    msg += `👨‍👩‍👧‍👦 *ಪೋಷಕರಿಗೆ ಸೂಚನೆ:*\n`;
    msg += `ದಯವಿಟ್ಟು ವಿದ್ಯಾರ್ಥಿಯ ದೈನಂದಿನ ಕಲಿಕೆ ಪ್ರಗತಿಯನ್ನು ಗಮನಿಸಿ ಮತ್ತು ಪ್ರೋತ್ಸಾಹಿಸಿ.\n\n`;
    msg += `— *SmartPath Kalike* 🎓\nAI-Powered Learning Assistant`;

    const axios = require('axios');
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      { messaging_product:'whatsapp', to:parentPhone, type:'text', text:{ body:msg } },
      { headers:{ Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type':'application/json' } }
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
    await supabase.from('feedback').insert({
      date: new Date().toISOString(),
      phone, name: name||'', message: text
    });
    return true;
  } catch (e) {
    console.error('Feedback save error:', e.message);
    return false;
  }
}

// getSheet kept as no-op for backward compatibility (nothing calls it now)
async function getSheet() { return null; }

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
