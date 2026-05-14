const express = require('express');
const axios = require('axios');
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

    const userMsg = message.text.body;
    const from = message.from;

    const flowiseRes = await axios.post(
      `${FLOWISE_URL}/api/v1/prediction/${FLOWISE_CHATFLOW_ID}`,
      { question: userMsg },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const botReply = flowiseRes.data.text || 'ಉತ್ತರ ಸಿಗಲಿಲ್ಲ, ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';

    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: from,
        text: { body: botReply }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error('Error:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
