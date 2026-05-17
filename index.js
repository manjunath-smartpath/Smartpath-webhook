const express = require('express');
const axios = require('axios');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  console.log("Incoming:", req.method, req.url);
  next();
});

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const FLOWISE_URL = process.env.FLOWISE_URL;
const FLOWISE_CHATFLOW_ID = "a54ef309-fd3a-4545-ad22-59e32cdafd55";
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

// ========== Google Sheets Setup ==========
async function getSheet() {
  const creds = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  const jwt = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, jwt);
  await doc.loadInfo();
  return doc.sheetsByIndex[0];
}

// ========== Student Check & Save ==========
async function getStudentStatus(phone) {
  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const student = rows.find(r => r.get('Phone') === phone);
    if (!student) return { status: 'NEW', student: null };
    return { status: student.get('Status'), student };
  } catch (e) {
    console.error("Sheet read error:", e.message);
    return { status: 'ERROR', student: null };
  }
}

async function saveNewStudent(phone, name, cls, school, city) {
  try {
    const sheet = await getSheet();
    const today = new Date();
    const expiry = new Date(today);
    expiry.setDate(expiry.getDate() + 2); // 2 days free trial

    await sheet.addRow({
      Phone: phone,
      Name: name || 'Unknown',
      Class: cls || 'Unknown',
      School: school || 'Unknown',
      City: city || 'Unknown',
      Start_Date: today.toISOString().split('T')[0],
      Status: 'TRIAL',
      Expiry_Date: expiry.toISOString().split('T')[0]
    });
    console.log("New student saved:", phone);
  } catch (e) {
    console.error("Sheet write error:", e.message);
  }
}

async function checkTrialExpiry(student) {
  const expiry = new Date(student.get('Expiry_Date'));
  const today = new Date();
  return today > expiry;
}

// ========== Send WhatsApp Message ==========
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

// ========== Webhook GET ==========
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

// ========== Webhook POST ==========
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const userMsg = message.text.body;
    const from = message.from;

    // Check student status
    const { status, student } = await getStudentStatus(from);

    // NEW student → save and allow 2 day trial
    if (status === 'NEW') {
      await saveNewStudent(from, null, null, null, null);
      console.log("New student trial started:", from);
    }

    // BLOCKED → send payment message
    if (status === 'BLOCKED') {
      await sendMessage(from,
        `⛔ ನಿಮ್ಮ Trial ಮುಗಿದಿದೆ!\n\n` +
        `Smartpath Kalike ಮುಂದುವರಿಸಲು:\n` +
        `💰 ₹199/month ಗೆ Subscribe ಮಾಡಿ\n\n` +
        `📞 Admin: 7019068606 ಗೆ WhatsApp ಮಾಡಿ\n` +
        `🌐 www.smartpathkalike.com`
      );
      return;
    }

    // TRIAL → check expiry
    if (status === 'TRIAL' && student) {
      const expired = await checkTrialExpiry(student);
      if (expired) {
        // Update status to BLOCKED
        student.set('Status', 'BLOCKED');
        await student.save();

        await sendMessage(from,
          `⏰ ನಿಮ್ಮ 2 ದಿನದ Free Trial ಮುಗಿದಿದೆ!\n\n` +
          `Admin Approval ಕಾಯಿರಿ ಅಥವಾ:\n` +
          `📞 7019068606 ಗೆ WhatsApp ಮಾಡಿ\n` +
          `💰 ₹199/month ಗೆ Subscribe ಮಾಡಿ`
        );
        return;
      }
    }

    // PAID or APPROVED or TRIAL (active) → send to Flowise
    const flowiseRes = await axios.post(
      `${FLOWISE_URL}/api/v1/prediction/${FLOWISE_CHATFLOW_ID}`,
      { question: userMsg, sessionId: from },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const botReply = flowiseRes.data.text || 'ಉತ್ತರ ಸಿಗಲಿಲ್ಲ, ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';

    // Update student name/class from conversation if possible
    if (status === 'NEW' || (student && !student.get('Name'))) {
      // Extract name if message contains name info
      // This will be updated when student provides their details
    }

    await sendMessage(from, botReply);

  } catch (err) {
    console.error("FULL ERROR:", err.response?.data || err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
