/**
 * SkyUp WhatsApp Bot — Master Conversation Engine
 *
 * Demo flow (ALL INSIDE WHATSAPP — no browser link):
 *   Book a Demo → Business Name → Date list → Time From list → Time To list → Confirm → Lead saved
 */

const { STATES, Session } = require('../models');
const { sendText, sendDocument, sendList, sendButtons } = require('../lib/msg91');
const { saveLead } = require('../sinks');
const {
  findCategoryById,
  findServiceById,
  findServiceByText,
  findCategoryByText,
  buildCategoryListSections,
  buildServiceListSections,
  serviceActionButtons,
  getPortfolioPdf,
  getPortfolioFilename,
} = require('../config/services');
const {
  getCopy,
  detectLanguage,
  isLanguageReply,
  codeFromReplyId,
  isValidLanguageCode,
  buildLanguageSections,
} = require('../config/languages');

const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+91 00000 00000';
const SUPPORT_WA    = process.env.SUPPORT_WA    || SUPPORT_PHONE;
const PORTFOLIO_URL = process.env.PORTFOLIO_URL || 'https://skyupdigital.in';
const MAX_STRIKES   = 3;

// ──────────────────────────────────────────────────────────────────
// CALENDAR HELPERS — all inside WhatsApp
// ──────────────────────────────────────────────────────────────────

function buildDateList() {
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const rows   = [];
  const today  = new Date();
  // IST offset
  const ist = new Date(today.getTime() + (5.5 * 3600000) + (today.getTimezoneOffset() * 60000));
  let count = 0;
  let i = 0;
  while (count < 7) {
    const d = new Date(ist);
    d.setDate(ist.getDate() + i);
    i++;
    if (d.getDay() === 0) continue; // skip Sundays
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const label   = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} (${days[d.getDay()]})`;
    rows.push({ id: `date_${dateStr}`, title: label, description: 'Tap to select this date' });
    count++;
  }
  return [{ title: 'Select a Date', rows }];
}

function buildTimeList(prefix) {
  // Hours 9AM to 6PM in 10-min intervals
  const rows = [];
  const times = [];
  for (let h = 9; h <= 18; h++) {
    for (let m = 0; m < 60; m += 10) {
      if (h === 18 && m > 0) break;
      const ampm = h < 12 ? 'AM' : 'PM';
      const h12  = h % 12 || 12;
      const label = `${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ampm}`;
      const id    = `${prefix}_${h}_${String(m).padStart(2,'0')}`;
      times.push({ id, label });
    }
  }
  // WhatsApp max 10 rows — split into 2 sections of 10
  const first  = times.slice(0, 10);
  const second = times.slice(10, 20);
  const sections = [{ title: 'Morning / Afternoon', rows: first.map(t => ({ id: t.id, title: t.label, description: 'Tap to select' })) }];
  if (second.length) sections.push({ title: 'Afternoon / Evening', rows: second.map(t => ({ id: t.id, title: t.label, description: 'Tap to select' })) });
  return sections;
}

function parseTimeId(id) {
  // e.g. timefrom_14_30 → 2:30 PM
  const parts = id.split('_');
  const h     = parseInt(parts[1]);
  const m     = parseInt(parts[2]);
  const ampm  = h < 12 ? 'AM' : 'PM';
  const h12   = h % 12 || 12;
  return `${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ampm}`;
}

function parseDateId(id) {
  // e.g. date_2026-09-27 → 27 Sep 2026 (Mon)
  return id.replace('date_', '');
}

// ──────────────────────────────────────────────────────────────────
// SEND HELPERS
// ──────────────────────────────────────────────────────────────────

function sendMainMenu(waId, c) {
  return sendList(waId, {
    header: 'SkyUp Digital Solutions',
    body:   c.mainMenu.body,
    footer: c.mainMenu.footer,
    button: c.mainMenu.button,
    sections: buildCategoryListSections(),
  });
}

function sendCategoryMenu(waId, categoryId, c) {
  const cat = findCategoryById(categoryId);
  return sendList(waId, {
    header: cat ? (cat.icon + ' ' + cat.title) : 'Services',
    body:   c.categoryMenu.body,
    footer: c.categoryMenu.footer,
    button: c.categoryMenu.button,
    sections: buildServiceListSections(categoryId),
  });
}

async function sendServiceIntro(waId, service, c, categoryId) {
  await sendText(waId, service.pitch);
  const pdfUrl = getPortfolioPdf(categoryId);
  if (pdfUrl && pdfUrl.startsWith('http')) {
    try {
      await sendDocument(waId, pdfUrl, getPortfolioFilename(categoryId), c.pdfCaption(service.title));
    } catch (err) {
      console.error('[intro] PDF failed:', err.message);
    }
  }
  await sendButtons(waId, {
    body:    c.serviceActions.body,
    footer:  c.serviceActions.footer,
    buttons: serviceActionButtons(service),
  });
}

function sendDatePicker(waId) {
  return sendList(waId, {
    header: '📅 Book a Demo',
    body:   'Please select your preferred date:',
    footer: 'Sundays are not available',
    button: 'Select Date',
    sections: buildDateList(),
  });
}

function sendTimeFromPicker(waId, dateLabel) {
  return sendList(waId, {
    header: `📅 ${dateLabel}`,
    body:   '⏰ Select your preferred START time:',
    footer: 'Choose when the demo should begin',
    button: 'Select Start Time',
    sections: buildTimeList('timefrom'),
  });
}

function sendTimeToPicker(waId, dateLabel, fromTime) {
  return sendList(waId, {
    header: `⏰ From: ${fromTime}`,
    body:   'Select your preferred END time:',
    footer: 'Choose when the demo should end',
    button: 'Select End Time',
    sections: buildTimeList('timeto'),
  });
}

// ──────────────────────────────────────────────────────────────────
// SESSION HELPERS
// ──────────────────────────────────────────────────────────────────

async function advance(session, patch, nextState) {
  Object.assign(session, patch);
  session.state   = nextState;
  session.strikes = 0;
  await session.save();
}

async function reject(session, c, reasonKey) {
  session.strikes += 1;
  if (session.strikes >= MAX_STRIKES) {
    session.state    = STATES.HANDOFF;
    session.needsHuman = true;
    await session.save();
    return sendText(session.waId, c.handoff(SUPPORT_PHONE));
  }
  await session.save();
  const msg = reasonKey ? (c.errors && c.errors[reasonKey]) : null;
  return sendText(session.waId, msg || c.offTopic);
}

async function saveLeadFromSession(session) {
  return saveLead({
    waId:                 session.waId,
    name:                 session.name || '',
    businessName:         session.businessName,
    phone:                session.phone || session.waId,
    lang:                 session.lang,
    categoryId:           session.categoryId,
    categoryTitle:        session.categoryTitle,
    serviceId:            session.serviceId,
    serviceTitle:         session.serviceTitle,
    purpose:              session.purpose,
    preferredContactDate: session.preferredContactDate,
    preferredContactTime: session.preferredContactTime,
    demoRequested:        true,
    needsHuman:           false,
    leadStatus:           'DEMO_REQUESTED',
  });
}

// ──────────────────────────────────────────────────────────────────
// INTENT DETECTION
// ──────────────────────────────────────────────────────────────────

function detectIntent(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (/\b(demo|demonstration|show me|trial|book)\b/.test(t)) return 'demo';
  if (/\b(human|person|agent|team|talk|speak|call me|connect|support)\b/.test(t)) return 'team';
  if (/\b(portfolio|work|projects|case study|clients)\b/.test(t)) return 'portfolio';
  if (/\b(not sure|suggest|recommend|which service|help me choose)\b/.test(t)) return 'recommend';
  return null;
}

// ──────────────────────────────────────────────────────────────────
// RESET DETECTION
// ──────────────────────────────────────────────────────────────────

const RESET_WORDS = new Set([
  'menu','restart','start','hi','hello','hey','reset','start over',
  'main menu','home','back','🏠',
  'मेनू','शुरू','नमस्ते','ಮೆನು','ಪ್ರಾರಂಭ','ನಮಸ್ಕಾರ',
  'மெனு','தொடங்கு','వణக்கம்','మెనూ','ప్రారంభం','నమస్కారం',
  'মেনু','শুরু','নমস্কার','ਮੀਨੂ','ਸ਼ੁਰੂ','مینو','شروع','سلام',
]);

function isReset(text) {
  if (!text) return false;
  return RESET_WORDS.has(String(text).trim().toLowerCase().replace(/[!.?]+$/, ''));
}

// ──────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ──────────────────────────────────────────────────────────────────

async function handleMessage(inbound) {
  const { waId, kind, text, replyId } = inbound;

  let session = await Session.findOne({ waId });
  if (!session) session = new Session({ waId, state: STATES.IDLE, lang: 'en' });

  session.lastMessageAt = new Date();
  let c = getCopy(session.lang);

  if (kind === 'text' && isReset(text) && session.state !== STATES.IDLE) {
    resetSession(session);
    await session.save();
    return sendMainMenu(waId, c);
  }

  switch (session.state) {

    // ── 1. First contact ─────────────────────────────────────────────
    case STATES.IDLE: {
      session.lang = 'en';
      c = getCopy('en');
      await advance(session, { lang: 'en' }, STATES.MAIN_MENU);
      return sendMainMenu(waId, c);
    }

    // ── 2. Language picker ───────────────────────────────────────────
    case STATES.LANG_PICKER_SENT: {
      if (kind === 'list_reply' && isLanguageReply(replyId)) {
        const code = codeFromReplyId(replyId);
        if (isValidLanguageCode(code)) {
          session.lang = code; c = getCopy(code);
          await advance(session, { lang: code }, STATES.MAIN_MENU);
          return sendMainMenu(waId, c);
        }
      }
      return sendMainMenu(waId, c);
    }

    // ── 3. Main menu ─────────────────────────────────────────────────
    case STATES.MAIN_MENU: {
      const cat = (kind === 'list_reply' && findCategoryById(replyId))
                || (kind === 'text'      && findCategoryByText(text));
      if (cat) {
        await advance(session, { categoryId: cat.id, categoryTitle: cat.title }, STATES.CATEGORY_SENT);
        return sendCategoryMenu(waId, cat.id, c);
      }
      const actionId = kind === 'list_reply' ? replyId : null;
      if (actionId === 'action_demo')      return startDemoFlow(session, c);
      if (actionId === 'action_team')      return startHandoff(session, c);
      if (actionId === 'action_portfolio') return sendText(waId, c.portfolio(PORTFOLIO_URL));
      if (actionId === 'action_about')     return sendText(waId, c.aboutSkyUp);

      const intent = detectIntent(text);
      if (intent === 'demo')      return startDemoFlow(session, c);
      if (intent === 'team')      return startHandoff(session, c);
      if (intent === 'recommend') return sendText(waId, c.recommendHelper);
      if (intent === 'portfolio') return sendText(waId, c.portfolio(PORTFOLIO_URL));

      const directSvc = kind === 'text' && findServiceByText(text);
      if (directSvc) {
        await advance(session, { serviceId: directSvc.id, serviceTitle: directSvc.title }, STATES.SERVICE_INTRO_SENT);
        return sendServiceIntro(waId, directSvc, c, session.categoryId);
      }
      return sendMainMenu(waId, c);
    }

    // ── 4. Category shown ─────────────────────────────────────────────
    case STATES.CATEGORY_SENT: {
      if (replyId === 'action_main_menu' || text === '🏠') {
        resetSession(session); await session.save();
        return sendMainMenu(waId, c);
      }
      const svc = (kind === 'list_reply' && findServiceById(replyId))
               || (kind === 'text'       && findServiceByText(text));
      if (svc) {
        await advance(session, { serviceId: svc.id, serviceTitle: svc.title }, STATES.SERVICE_INTRO_SENT);
        return sendServiceIntro(waId, svc, c, session.categoryId);
      }
      return sendCategoryMenu(waId, session.categoryId, c);
    }

    // ── 5. Service intro ──────────────────────────────────────────────
    case STATES.SERVICE_INTRO_SENT: {
      const action = (kind === 'button_reply' || kind === 'list_reply') ? replyId : detectIntent(text);
      if (action === 'action_demo' || action === 'demo') {
        session.demoRequested = true;
        await session.save();
        return startDemoFlow(session, c);
      }
      if (action === 'action_team' || action === 'team') return startHandoff(session, c);
      if (/\bpdf\b/i.test(text || '')) {
        const pdfUrl = getPortfolioPdf(session.categoryId);
        if (pdfUrl) return sendDocument(waId, pdfUrl, getPortfolioFilename(session.categoryId), c.pdfCaption(session.serviceTitle));
        return sendText(waId, c.pdfNotAvailable);
      }
      return sendServiceIntro(waId, findServiceById(session.serviceId) || {}, c, session.categoryId);
    }

    // ── 6. Demo — Business name ───────────────────────────────────────
    case STATES.DEMO_BUSINESS: {
      if (kind !== 'text' || !text) return reject(session, c);
      session.phone = session.phone || waId;
      await advance(session, { businessName: text, phone: session.phone, demoRequested: true }, STATES.DEMO_DATE);
      return sendDatePicker(waId);
    }

    // ── 7. Demo — Date selection ──────────────────────────────────────
    case STATES.DEMO_DATE: {
      if (kind === 'list_reply' && replyId && replyId.startsWith('date_')) {
        const dateStr = replyId.replace('date_', '');
        // Format nicely for display
        const d = new Date(dateStr);
        const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const dateLabel = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} (${days[d.getDay()]})`;
        await advance(session, { preferredContactDate: dateLabel }, STATES.DEMO_TIME);
        return sendTimeFromPicker(waId, dateLabel);
      }
      // Resend date picker if wrong input
      return sendDatePicker(waId);
    }

    // ── 8. Demo — Start time ──────────────────────────────────────────
    case STATES.DEMO_TIME: {
      if (kind === 'list_reply' && replyId && replyId.startsWith('timefrom_')) {
        const fromTime = parseTimeId(replyId);
        await advance(session, { preferredContactTime: fromTime }, STATES.DEMO_TIMESLOT);
        return sendTimeToPicker(waId, session.preferredContactDate, fromTime);
      }
      return sendTimeFromPicker(waId, session.preferredContactDate);
    }

    // ── 9. Demo — End time → Confirm ─────────────────────────────────
    case STATES.DEMO_TIMESLOT: {
      if (kind === 'list_reply' && replyId && replyId.startsWith('timeto_')) {
        const toTime   = parseTimeId(replyId);
        const fromTime = session.preferredContactTime;
        const timeRange = `${fromTime} → ${toTime}`;

        await advance(session, {
          preferredContactTime: timeRange,
          leadStatus: 'DEMO_REQUESTED',
        }, STATES.DONE);

        // Save lead
        await saveLeadFromSession(session);

        // Send confirmation
        const msg =
          `✅ *Demo Booked!*\n\n` +
          `🏢 *Business:* ${session.businessName || 'N/A'}\n` +
          `🎯 *Service:* ${session.serviceTitle || 'SkyUp Demo'}\n` +
          `📅 *Date:* ${session.preferredContactDate}\n` +
          `⏰ *Time:* ${timeRange}\n\n` +
          `Our team will contact you on WhatsApp to confirm the demo.\n\n` +
          `📞 *Call / WhatsApp:* ${SUPPORT_PHONE}\n\n` +
          `Type MENU to explore more services.`;
        return sendText(waId, msg);
      }
      return sendTimeToPicker(waId, session.preferredContactDate, session.preferredContactTime);
    }

    // ── Terminal states ───────────────────────────────────────────────
    case STATES.HANDOFF:
      return sendText(waId, c.handoffRepeat(SUPPORT_WA));

    case STATES.DONE: {
      const intent = detectIntent(text);
      if (intent === 'demo') return startDemoFlow(session, c);
      return sendText(waId, c.alreadyDone);
    }

    default:
      resetSession(session);
      await session.save();
      return sendMainMenu(waId, c);
  }
}

// ──────────────────────────────────────────────────────────────────
// FLOW STARTERS
// ──────────────────────────────────────────────────────────────────

async function startDemoFlow(session, c) {
  session.demoRequested = true;
  if (!session.businessName) {
    await advance(session, { demoRequested: true }, STATES.DEMO_BUSINESS);
    return sendText(session.waId, c.askBusinessName);
  }
  // Already has business — show date picker
  await advance(session, {}, STATES.DEMO_DATE);
  return sendDatePicker(session.waId);
}

async function startHandoff(session, c) {
  session.needsHuman = true;
  session.state      = STATES.HANDOFF;
  session.leadStatus = 'TEAM_REVIEW';
  session.phone      = session.phone || session.waId;
  await session.save();
  await saveLeadFromSession(session);
  return sendText(session.waId, c.handoff(SUPPORT_PHONE));
}

// ──────────────────────────────────────────────────────────────────
// SESSION RESET
// ──────────────────────────────────────────────────────────────────

function resetSession(session) {
  session.state             = STATES.MAIN_MENU;
  session.categoryId        = undefined;
  session.categoryTitle     = undefined;
  session.serviceId         = undefined;
  session.serviceTitle      = undefined;
  session.name              = undefined;
  session.businessName      = undefined;
  session.purpose           = undefined;
  session.phone             = undefined;
  session.preferredContactDate = undefined;
  session.preferredContactTime = undefined;
  session.quotationRequested = false;
  session.demoRequested      = false;
  session.needsHuman         = false;
  session.leadStatus         = 'NEW';
  session.reqStep            = 0;
  session.strikes            = 0;
}

// Also need to add DEMO_DATE and DEMO_TIMESLOT to models if not present
// These states are: DEMO_BUSINESS, DEMO_DATE, DEMO_TIME, DEMO_TIMESLOT, DONE

module.exports = { handleMessage, sendMainMenu, saveLeadFromSession };
