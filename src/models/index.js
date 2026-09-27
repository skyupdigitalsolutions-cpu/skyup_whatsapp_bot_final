const mongoose = require('mongoose');

const STATES = {
  IDLE:               'IDLE',
  LANG_PICKER_SENT:   'LANG_PICKER_SENT',
  MAIN_MENU:          'MAIN_MENU',
  CATEGORY_SENT:      'CATEGORY_SENT',
  SERVICE_INTRO_SENT: 'SERVICE_INTRO_SENT',
  SUB_SERVICE_SENT:   'SUB_SERVICE_SENT',
  COLLECTING_REQ:     'COLLECTING_REQ',
  AWAITING_DOCS:      'AWAITING_DOCS',
  QUOTATION_PENDING:  'QUOTATION_PENDING',

  // Demo flow — all inside WhatsApp
  DEMO_BUSINESS:  'DEMO_BUSINESS',   // asking business name
  DEMO_DATE:      'DEMO_DATE',       // showing date list
  DEMO_TIME:      'DEMO_TIME',       // showing start time list
  DEMO_TIMESLOT:  'DEMO_TIMESLOT',   // showing end time list
  DEMO_CONFIRMED: 'DEMO_CONFIRMED',

  // Legacy (kept for backward compat)
  DEMO_NAME:      'DEMO_NAME',

  // Lead capture
  AWAITING_NAME:        'AWAITING_NAME',
  AWAITING_PURPOSE:     'AWAITING_PURPOSE',
  AWAITING_PHONE:       'AWAITING_PHONE',
  AWAITING_ALT_PHONE:   'AWAITING_ALT_PHONE',
  AWAITING_CONTACT_TIME:'AWAITING_CONTACT_TIME',

  // Terminal
  HANDOFF: 'HANDOFF',
  DONE:    'DONE',
};

const LEAD_STATUSES = [
  'NEW','QUALIFYING','QUALIFIED','DOCUMENTS_RECEIVED',
  'TEAM_REVIEW','QUOTATION_REQUESTED','DEMO_REQUESTED',
  'CONTACT_PENDING','CONTACTED','CONVERTED','CLOSED',
];

const sessionSchema = new mongoose.Schema(
  {
    waId:  { type: String, required: true, unique: true, index: true },
    state: { type: String, default: STATES.IDLE },
    lang:  { type: String, default: 'en' },

    categoryId:      String,
    categoryTitle:   String,
    serviceId:       String,
    serviceTitle:    String,
    subServiceId:    String,
    subServiceTitle: String,

    name:            String,
    businessName:    String,
    purpose:         String,
    currentProcess:  String,
    existingSystem:  String,
    phone:           String,
    preferredContactDate: String,
    preferredContactTime: String,

    quotationRequested: { type: Boolean, default: false },
    demoRequested:      { type: Boolean, default: false },
    documentsUploaded:  { type: Boolean, default: false },
    needsHuman:         { type: Boolean, default: false },
    leadStatus:         { type: String, enum: LEAD_STATUSES, default: 'NEW' },
    pendingAction:      String,
    reqStep:            { type: Number, default: 0 },
    strikes:            { type: Number, default: 0 },
    lastMessageAt:      { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const leadSchema = new mongoose.Schema(
  {
    waId:            { type: String, required: true, index: true },
    name:            String,
    businessName:    String,
    phone:           String,
    lang:            { type: String, default: 'en' },
    categoryId:      String,
    categoryTitle:   String,
    serviceId:       String,
    serviceTitle:    String,
    subServiceId:    String,
    subServiceTitle: String,
    purpose:         String,
    currentProcess:  String,
    existingSystem:  String,
    preferredContactDate: String,
    preferredContactTime: String,
    quotationRequested: Boolean,
    demoRequested:   Boolean,
    documentsUploaded: Boolean,
    needsHuman:      Boolean,
    leadStatus:      { type: String, enum: LEAD_STATUSES, default: 'NEW' },
    source:          { type: String, default: 'whatsapp' },
    delivery: {
      sheets: { status: { type: String, enum: ['pending','sent','failed'], default: 'pending' }, error: String, at: Date },
      crm:    { status: { type: String, enum: ['pending','sent','failed'], default: 'pending' }, error: String, at: Date },
    },
  },
  { timestamps: true }
);

const Session = mongoose.model('Session', sessionSchema);
const Lead    = mongoose.model('Lead', leadSchema);

module.exports = { STATES, LEAD_STATUSES, Session, Lead };
