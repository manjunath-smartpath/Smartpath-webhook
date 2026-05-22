const express = require('express');
const axios = require('axios');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  console.log("Incoming:", req.method, req.url);
  next();
});

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ============ MEMORY ============
const studentMemory = {};

// ============ FAQ CACHE ============
const CACHE_FILE = '/app/faq_cache.json';
let faqCache = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      faqCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log(`Cache loaded: ${Object.keys(faqCache).length} entries`);
    }
  } catch (e) {
    console.error('Cache load error:', e.message);
    faqCache = {};
  }
}

function saveCache(key, value) {
  try {
    faqCache[key] = value;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(faqCache), 'utf8');
  } catch (e) {
    console.error('Cache save error:', e.message);
  }
}

loadCache();

// ============ CHAPTER MAPPING ============
const chapterMap = {
  "6": {
    "1": "Patterns in Mathematics",
    "2": "Lines and Angles",
    "3": "Playing with Numbers",
    "4": "Basic Geometrical Ideas",
    "5": "Understanding Elementary Shapes",
    "6": "Perimeter and Area",
    "7": "Fractions",
    "8": "Decimals",
    "9": "Data Handling",
    "10": "Mensuration",
    "11": "Algebra",
    "12": "Ratio and Proportion",
  },
  "7": {
    "1": "Integers",
    "2": "Fractions and Decimals",
    "3": "Data Handling",
    "4": "Simple Equations",
    "5": "Lines and Angles",
    "6": "Triangle and its Properties",
    "7": "Comparing Quantities",
    "8": "Rational Numbers",
    "9": "Perimeter and Area",
    "10": "Algebraic Expressions",
    "11": "Exponents and Powers",
    "12": "Symmetry",
    "13": "Visualising Solid Shapes",
  },
  "8": {
    "1": "Rational Numbers",
    "2": "Linear Equations in One Variable",
    "3": "Understanding Quadrilaterals",
    "4": "Practical Geometry",
    "5": "Data Handling",
    "6": "Squares and Square Roots",
    "7": "Cubes and Cube Roots",
    "8": "Comparing Quantities",
    "9": "Algebraic Expressions and Identities",
    "10": "Visualizing Solid Shapes",
  },
  "9": {
    "1": "Number Systems",
    "2": "Polynomials",
    "3": "Coordinate Geometry",
    "4": "Linear Equations in Two Variables",
    "5": "Euclid Geometry",
    "6": "Lines and Angles",
    "7": "Triangles",
    "8": "Quadrilaterals",
    "9": "Circles",
    "10": "Heron Formula",
    "11": "Surface Areas and Volumes",
    "12": "Statistics",
  },
  "10": {
    "1": "Real Numbers",
    "2": "Polynomials",
    "3": "Pair of Linear Equations",
    "4": "Quadratic Equations",
    "5": "Arithmetic Progressions",
    "6": "Triangles",
    "7": "Coordinate Geometry",
    "8": "Trigonometry",
    "9": "Applications of Trigonometry",
    "10": "Circles",
    "11": "Areas Related to Circles",
    "12": "Surface Areas and Volumes",
    "13": "Statistics",
    "14": "Probability",
  }
};

// ============ FOLLOW-UP WORDS ============
const followUpWords = [
  "more", "explain more", "little more", "explain again",
  "above topic", "with examples", "with calculation",
  "calculated examples", "same topic", "tell me more",
  "elaborate", "detail", "in detail", "example"
];

function isFollowUp(question) {
  const q = question.toLowerCase().trim();
  return followUpWords.some(word => q.includes(word));
}

function buildSearchQuery(question, studentClass) {
  let q = question.toLowerCase().trim();

  // Chapter number → name
  const chapterMatch = q.match(/chapter\s+(\d+)/);
  if (chapterMatch) {
    const chNum = chapterMatch[1];
    if (chapterMap[studentClass]?.[chNum]) {
      question = question.replace(/chapter\s+\d+/i, chapterMap[studentClass][chNum]);
    }
  }

  return `Class ${studentClass} KSEEB: ${question}`;
}

function cleanLatex(text) {
  return text
    .replace(/\\\(|\\\)/g, '')
    .replace(/\\\[|\\\]/g, '')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2')
    .replace(/\\times/g, 'x')
    .replace(/\\div/g, '÷')
    .replace(/\\pm/g, '±')
    .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\{|\}/g, '')
    .replace(/\\\\/g, '\n');
}

// ============ ASK KSEEB ============
async function askKSEEB(question, studentClass, from) {
  try {
    // Follow-up check
    let searchQuestion = question;
    if (isFollowUp(question) && studentMemory[from]) {
      searchQuestion = `${studentMemory[from]} ${question}`;
      console.log('Follow-up detected:', searchQuestion);
    } else {
      studentMemory[from] = question;
    }

    // Build search query
    const enhanced = buildSearchQuery(searchQuestion, studentClass);
    console.log('Search query:', enhanced);

    // Cache check
    const cacheKey = `${studentClass}_${enhanced.toLowerCase().trim()}`;
    if (faqCache[cacheKey]) {
      console.log('Cache hit!');
      return faqCache[cacheKey];
    }

    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Embedding
    const embRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: enhanced
    });
    const queryVector = embRes.data[0].embedding;

    // Pinecone Search
    const index = pc.index('kseeb-kalike');
    const searchRes = await index.query({
      vector: queryVector,
      topK: 8,
      includeMetadata: true,
      filter: { class: { $eq: studentClass } }
    });

    console.log('Pinecone matches:', searchRes.matches.length);
    if (searchRes.matches.length > 0) {
      console.log('Top score:', searchRes.matches[0].score);
    }

    const context = searchRes.matches
      .filter(m => m.score > 0.3)
      .map(m => m.metadata.text)
      .join('\n\n');

    if (!context || context.trim() === '') {
      return 'ಈ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರ textbook ನಲ್ಲಿ ಸಿಗಲಿಲ್ಲ.';
    }

    // GPT
    const gptRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a KSEEB Karnataka state board tutor for classes 6-10.
Answer ONLY using the provided context.
Answer based on the context even if it is partial information.
Do NOT use general knowledge.
Do NOT make up answers.
Answer in the same language as the question.
If question is in Kannada, answer in Kannada.
If question is in English, answer in English.
Keep answer under 250 words.
Never use LaTeX format like \\( \\) or \\frac{}{}.
Write math in plain text only:
- Use 2 1/3 instead of \\(2 \\frac{1}{3}\\)
- Use a/b instead of \\frac{a}{b}
- Use x^2 instead of \\(x^2\\)
If answer not in context, say exactly: "ಈ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರ textbook ನಲ್ಲಿ ಸಿಗಲಿಲ್ಲ"

Context:
${context}`
        },
        { role: 'user', content: question }
      ],
      max_tokens: 500
    });

    let reply = gptRes.choices[0].message.content;
    reply = cleanLatex(reply);

    // Cache save
    saveCache(cacheKey, reply);

    return reply;

  } catch (e) {
    console.error('askKSEEB error:', e.message);
    return '⚠️ ತಾಂತ್ರಿಕ ತೊಂದರೆ ಆಗಿದೆ, ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';
  }
}

// ============ GOOGLE SHEET ============
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
    console.error("Sheet read error:", e.message);
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
      Name: '',
      Class: '',
      School: '',
      City: '',
      Start_Date: today.toISOString().split('T')[0],
      Status: 'TRIAL',
      Expiry_Date: expiry.toISOString().split('T')[0],
      Registration_Step: 'PENDING_NAME'
    });
  } catch (e) {
    console.error("Sheet write error:", e.message);
  }
}

async function updateStudent(student, field, value) {
  try {
    student.set(field, value);
    await student.save();
  } catch (e) {
    console.error("Sheet update error:", e.message);
  }
}

async function isExpired(student) {
  const expiry = new Date(student.get('Expiry_Date'));
  return new Date() > expiry;
}

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

// ============ WEBHOOK ============
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

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const userMsg = message.text.body.trim();
    const from = message.from;

    let student = await getStudent(from);

    if (!student) {
      await saveNewStudent(from);
      await sendMessage(from, `🙏 ಸ್ವಾಗತ! ನಾನು Smartpath Kalike, ನಿಮ್ಮ KSEEB ಟ್ಯೂಟರ್!\n\nಮೊದಲು ನಿಮ್ಮ ಹೆಸರು ಹೇಳಿ:`);
      return;
    }

    const step = student.get('Registration_Step');
    const status = student.get('Status');

    if (step === 'PENDING_NAME') {
      await updateStudent(student, 'Name', userMsg);
      await updateStudent(student, 'Registration_Step', 'PENDING_CLASS');
      await sendMessage(from, `ನಮಸ್ಕಾರ ${userMsg}! 😊\n\nನೀವು ಯಾವ ತರಗತಿ?\n(6, 7, 8, 9 ಅಥವಾ 10 ಎಂದು ಹೇಳಿ)`);
      return;
    }

    if (step === 'PENDING_CLASS') {
      if (!['6','7','8','9','10'].includes(userMsg)) {
        await sendMessage(from, `⚠️ ದಯವಿಟ್ಟು 6, 7, 8, 9 ಅಥವಾ 10 ಎಂದು ಮಾತ್ರ ಹೇಳಿ:`);
        return;
      }
      await updateStudent(student, 'Class', userMsg);
      await updateStudent(student, 'Registration_Step', 'PENDING_SCHOOL');
      await sendMessage(from, `${userMsg}ನೇ ತರಗತಿ ✅\n\nನಿಮ್ಮ ಶಾಲೆ ಹೆಸರು ಹೇಳಿ:`);
      return;
    }

    if (step === 'PENDING_SCHOOL') {
      await updateStudent(student, 'School', userMsg);
      await updateStudent(student, 'Registration_Step', 'PENDING_CITY');
      await sendMessage(from, `${userMsg} ✅\n\nನಿಮ್ಮ ಊರು (City) ಹೇಳಿ:`);
      return;
    }

    if (step === 'PENDING_CITY') {
      await updateStudent(student, 'City', userMsg);
      await updateStudent(student, 'Registration_Step', 'COMPLETE');
      const name = student.get('Name');
      const cls = student.get('Class');
      await sendMessage(from,
        `🎉 ನೋಂದಣಿ ಪೂರ್ಣವಾಯಿತು!\n\n` +
        `ಹೆಸರು: ${name}\nತರಗತಿ: ${cls}ನೇ\nಶಾಲೆ: ${student.get('School')}\nಊರು: ${userMsg}\n\n` +
        `✅ 2 ದಿನ FREE Trial ಶುರುವಾಯಿತು!\n\nಈಗ ಯಾವ ವಿಷಯದ ಪ್ರಶ್ನೆ ಬೇಕಾದರೂ ಕೇಳಿ! 📚`
      );
      return;
    }

    if (status === 'BLOCKED') {
      await sendMessage(from, `⛔ ನಿಮ್ಮ Trial ಮುಗಿದಿದೆ!\n\n💰 ₹199/month ಗೆ Subscribe ಮಾಡಿ\n📞 Admin: 7019068606`);
      return;
    }

    if (status === 'TRIAL') {
      const expired = await isExpired(student);
      if (expired) {
        await updateStudent(student, 'Status', 'BLOCKED');
        await sendMessage(from, `⏰ ನಿಮ್ಮ 2 ದಿನದ Free Trial ಮುಗಿದಿದೆ!\n\n📞 7019068606 ಗೆ WhatsApp ಮಾಡಿ\n💰 ₹199/month ಗೆ Subscribe ಮಾಡಿ`);
        return;
      }
    }

    const studentClass = student.get('Class') || '6';
    const reply = await askKSEEB(userMsg, studentClass, from);
    await sendMessage(from, reply.substring(0, 4000));

  } catch (err) {
    console.error("FULL ERROR:", err.response?.data || err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
