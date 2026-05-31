// ============================================================
// SECTION 4: sendMessage HELPERS  (Smartpath Kalike Phase 3)
// ============================================================
// WhatsApp Cloud API message senders:
//   sendText    — plain text (existing, renamed)
//   sendButtons — reply buttons (max 3)
//   sendList    — list message (max 10 rows total across sections)
// ============================================================

const axios = require('axios');

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const API_URL = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
const HEADERS = {
  Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json'
};

// WhatsApp limits
const BTN_TITLE_MAX = 20;   // reply button title max chars
const ROW_TITLE_MAX = 24;   // list row title max chars
const ROW_DESC_MAX = 72;    // list row description max chars
const BODY_MAX = 1024;      // interactive body text max chars

// Safe truncate helper
function trunc(str, max) {
  if (!str) return '';
  str = String(str).trim();
  return str.length > max ? str.substring(0, max - 1) + '…' : str;
}

// ---------- 1. PLAIN TEXT ----------
async function sendText(to, text) {
  try {
    await axios.post(API_URL, {
      messaging_product: 'whatsapp',
      to,
      text: { body: String(text).substring(0, 4000) }
    }, { headers: HEADERS });
  } catch (e) {
    console.error('sendText error:', e.response?.data?.error?.message || e.message);
  }
}

// ---------- 2. REPLY BUTTONS (max 3) ----------
// buttons = [{ id, title }, ...]  (max 3)
async function sendButtons(to, bodyText, buttons) {
  try {
    const btns = buttons.slice(0, 3).map(b => ({
      type: 'reply',
      reply: { id: b.id, title: trunc(b.title, BTN_TITLE_MAX) }
    }));

    await axios.post(API_URL, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: trunc(bodyText, BODY_MAX) },
        action: { buttons: btns }
      }
    }, { headers: HEADERS });
  } catch (e) {
    console.error('sendButtons error:', e.response?.data?.error?.message || e.message);
    // Fallback: send as text
    const fallback = bodyText + '\n\n' +
      buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
    await sendText(to, fallback);
  }
}

// ---------- 3. LIST MESSAGE (max 10 rows) ----------
// rows = [{ id, title, description? }, ...]  (max 10 total)
// sections optional: pass sectionTitle to group; else single section
async function sendList(to, bodyText, buttonLabel, rows, sectionTitle = ' ') {
  try {
    const limitedRows = rows.slice(0, 10).map(r => {
      const row = {
        id: r.id,
        title: trunc(r.title, ROW_TITLE_MAX)
      };
      if (r.description) row.description = trunc(r.description, ROW_DESC_MAX);
      return row;
    });

    await axios.post(API_URL, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: trunc(bodyText, BODY_MAX) },
        action: {
          button: trunc(buttonLabel, BTN_TITLE_MAX),
          sections: [{ title: trunc(sectionTitle, 24), rows: limitedRows }]
        }
      }
    }, { headers: HEADERS });
  } catch (e) {
    console.error('sendList error:', e.response?.data?.error?.message || e.message);
    // Fallback: send as text
    const fallback = bodyText + '\n\n' +
      rows.map((r, i) => `${i + 1}. ${r.title}`).join('\n');
    await sendText(to, fallback);
  }
}

// ---------- 4. MULTI-SECTION LIST (optional, for grouped rows) ----------
// sections = [{ title, rows: [{id,title,description?}] }]
async function sendMultiSectionList(to, bodyText, buttonLabel, sections) {
  try {
    const cleanSections = sections.map(sec => ({
      title: trunc(sec.title, 24),
      rows: sec.rows.slice(0, 10).map(r => {
        const row = { id: r.id, title: trunc(r.title, ROW_TITLE_MAX) };
        if (r.description) row.description = trunc(r.description, ROW_DESC_MAX);
        return row;
      })
    }));

    await axios.post(API_URL, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: trunc(bodyText, BODY_MAX) },
        action: { button: trunc(buttonLabel, BTN_TITLE_MAX), sections: cleanSections }
      }
    }, { headers: HEADERS });
  } catch (e) {
    console.error('sendMultiSectionList error:', e.response?.data?.error?.message || e.message);
    const allRows = sections.flatMap(s => s.rows);
    const fallback = bodyText + '\n\n' +
      allRows.map((r, i) => `${i + 1}. ${r.title}`).join('\n');
    await sendText(to, fallback);
  }
}

module.exports = {
  sendText,
  sendButtons,
  sendList,
  sendMultiSectionList,
  trunc
};
