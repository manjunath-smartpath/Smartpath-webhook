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

    const flowiseRes = await axios.post(
      `${FLOWISE_URL}/api/v1/prediction/${FLOWISE_CHATFLOW_ID}`,
      { question: `${userMsg}\n\n(ಉತ್ತರವನ್ನು 250 words ಒಳಗೆ ಕೊಡಿ)`, sessionId: from },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const fullReply = flowiseRes.data.text || 'ಉತ್ತರ ಸಿಗಲಿಲ್ಲ, ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';
    const botReply = fullReply.substring(0, 4000);
    await sendMessage(from, botReply);

  } catch (err) {
    console.error("FULL ERROR:", err.response?.data || err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
