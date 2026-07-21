const mongoose = require("mongoose");

const { Schema } = mongoose;

const baseOptions = { timestamps: true };

const counterSchema = new Schema({
  key: { type: String, required: true, unique: true, trim: true },
  seq: { type: Number, default: 0 }
}, baseOptions);

const staffUserSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["super_admin", "admin", "receptionist"], default: "receptionist" },
  isActive: { type: Boolean, default: true },
  failedLoginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date },
  passwordChangedAt: { type: Date },
  lastLoginAt: { type: Date }
}, baseOptions);

staffUserSchema.index({ role: 1, isActive: 1 });

const refreshTokenSessionSchema = new Schema({
  staffUser: { type: Schema.Types.ObjectId, ref: "StaffUser", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  userAgent: { type: String, maxlength: 600 },
  ip: { type: String, maxlength: 120 },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date }
}, baseOptions);

refreshTokenSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const patientSchema = new Schema({
  fullName: { type: String, trim: true, maxlength: 160 },
  phoneE164: { type: String, required: true, unique: true, trim: true },
  preferredLanguage: { type: String, default: "en", trim: true },
  age: { type: Number, min: 0, max: 130 },
  gender: { type: String, enum: ["female", "male", "other", "not_provided"], default: "not_provided" },
  notes: { type: String, maxlength: 1000 },
  optOut: { type: Boolean, default: false }
}, baseOptions);

patientSchema.index({ fullName: "text", phoneE164: "text" });

const patientConsentSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  phoneE164: { type: String, required: true, index: true },
  consentGiven: { type: Boolean, required: true },
  consentText: { type: String, required: true },
  channel: { type: String, enum: ["website", "whatsapp", "staff"], required: true },
  language: { type: String, default: "en" },
  consentedAt: { type: Date, default: Date.now }
}, baseOptions);

const optOutPreferenceSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", index: true },
  phoneE164: { type: String, required: true, unique: true },
  optedOut: { type: Boolean, default: true },
  reason: { type: String, maxlength: 500 },
  channel: { type: String, enum: ["website", "whatsapp", "staff"], default: "whatsapp" },
  optedOutAt: { type: Date, default: Date.now }
}, baseOptions);

const appointmentSchema = new Schema({
  appointmentId: { type: String, required: true, unique: true, trim: true },
  tokenNumber: { type: String, required: true, trim: true },
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  patientSnapshot: {
    fullName: { type: String, required: true },
    phoneMasked: { type: String, required: true },
    age: { type: Number },
    gender: { type: String },
    preferredLanguage: { type: String }
  },
  phoneE164: { type: String, required: true, index: true },
  reason: { type: String, required: true, maxlength: 1000 },
  optionalNote: { type: String, maxlength: 1000 },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  time: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
  activeSlotKey: { type: String },
  activePatientDateKey: { type: String },
  status: {
    type: String,
    enum: ["scheduled", "rescheduled", "cancelled", "visited", "no_show"],
    default: "scheduled",
    index: true
  },
  consent: { type: Schema.Types.ObjectId, ref: "PatientConsent" },
  source: { type: String, enum: ["website", "whatsapp", "staff"], default: "website" },
  reminderStatus: { type: String, enum: ["pending", "partially_sent", "sent", "cancelled"], default: "pending" },
  confirmationMessageStatus: { type: String, enum: ["not_sent", "queued", "sent_to_meta", "failed", "not_configured"], default: "not_sent" },
  rescheduleCount: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: "StaffUser" },
  cancelledAt: { type: Date },
  visitedAt: { type: Date },
  noShowAt: { type: Date }
}, baseOptions);

appointmentSchema.index(
  { activeSlotKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      activeSlotKey: { $type: "string" },
      status: { $in: ["scheduled", "rescheduled"] }
    }
  }
);
appointmentSchema.index(
  { activePatientDateKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      activePatientDateKey: { $type: "string" },
      status: { $in: ["scheduled", "rescheduled"] }
    }
  }
);
appointmentSchema.index({ date: 1, time: 1, status: 1 });
appointmentSchema.index({ appointmentId: 1, phoneE164: 1 });
appointmentSchema.index({ date: 1, tokenNumber: 1 }, { unique: true });

const rescheduleHistorySchema = new Schema({
  appointment: { type: Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
  previousDate: { type: String, required: true },
  previousTime: { type: String, required: true },
  newDate: { type: String, required: true },
  newTime: { type: String, required: true },
  changedByType: { type: String, enum: ["patient", "staff", "system"], required: true },
  changedByStaff: { type: Schema.Types.ObjectId, ref: "StaffUser" },
  reason: { type: String, maxlength: 1000 }
}, baseOptions);

const conversationSessionSchema = new Schema({
  phoneE164: { type: String, required: true, unique: true },
  patient: { type: Schema.Types.ObjectId, ref: "Patient" },
  language: { type: String, default: "en" },
  intent: { type: String, default: "menu" },
  state: { type: String, default: "idle" },
  context: { type: Schema.Types.Mixed, default: {} },
  humanRequired: { type: Boolean, default: false },
  aiPaused: { type: Boolean, default: false },
  takenOverBy: { type: Schema.Types.ObjectId, ref: "StaffUser" },
  lastMessageAt: { type: Date, default: Date.now }
}, baseOptions);

conversationSessionSchema.index({ humanRequired: 1, aiPaused: 1, lastMessageAt: -1 });

const whatsappMessageSchema = new Schema({
  metaMessageId: { type: String, unique: true, sparse: true },
  direction: { type: String, enum: ["incoming", "outgoing"], required: true },
  phoneE164: { type: String, required: true, index: true },
  conversation: { type: Schema.Types.ObjectId, ref: "ConversationSession" },
  messageType: { type: String, default: "text" },
  body: { type: String, maxlength: 6000 },
  status: {
    type: String,
    enum: ["received", "queued", "sent_to_meta", "delivered", "read", "failed", "duplicate", "ignored"],
    default: "received",
    index: true
  },
  payload: { type: Schema.Types.Mixed },
  error: { type: String, maxlength: 1200 },
  serviceWindowExpiresAt: { type: Date }
}, baseOptions);

whatsappMessageSchema.index({ createdAt: -1 });

const messageDeliveryStatusSchema = new Schema({
  metaMessageId: { type: String, required: true, index: true },
  phoneE164: { type: String, index: true },
  status: { type: String, enum: ["sent", "delivered", "read", "failed"], required: true },
  timestamp: { type: Date, required: true },
  payload: { type: Schema.Types.Mixed }
}, baseOptions);

const clinicSettingsSchema = new Schema({
  key: { type: String, default: "default", unique: true },
  contactNumber: { type: String, default: "+92 324 4754566" },
  timezone: { type: String, default: "Asia/Karachi" },
  slotDurationMinutes: { type: Number, default: 30, min: 5, max: 240 },
  weeklyHours: [{
    day: { type: Number, min: 1, max: 7, required: true },
    isOpen: { type: Boolean, default: false },
    start: { type: String, default: "09:00" },
    end: { type: String, default: "16:00" }
  }],
  reminderIntervalsMinutes: { type: [Number], default: [4320, 1440, 120] },
  serviceWindowHours: { type: Number, default: 24, min: 1, max: 24 },
  updatedBy: { type: Schema.Types.ObjectId, ref: "StaffUser" }
}, baseOptions);

const doctorProfileSettingsSchema = new Schema({
  key: { type: String, default: "default", unique: true },
  doctorName: { type: String, default: "Dr. Khurram" },
  contactNumber: { type: String, default: "+92 324 4754566" },
  specialty: { type: String, default: "" },
  qualifications: { type: String, default: "" },
  experience: { type: String, default: "" },
  biography: { type: String, default: "" },
  clinicLocation: { type: String, default: "" },
  profileImageUrl: { type: String, default: "assets/dr-khurram-neutral-doctor.png" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "StaffUser" }
}, baseOptions);

const blockedDateSchema = new Schema({
  date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  reason: { type: String, maxlength: 500 },
  blockedBy: { type: Schema.Types.ObjectId, ref: "StaffUser" }
}, baseOptions);

const blockedSlotSchema = new Schema({
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  time: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
  slotKey: { type: String, required: true, unique: true },
  reason: { type: String, maxlength: 500 },
  blockedBy: { type: Schema.Types.ObjectId, ref: "StaffUser" }
}, baseOptions);

const availableTimeSlotSchema = new Schema({
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  time: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
  isAvailable: { type: Boolean, default: true },
  source: { type: String, enum: ["schedule", "override"], default: "override" }
}, baseOptions);

availableTimeSlotSchema.index({ date: 1, time: 1 }, { unique: true });

const reminderJobSchema = new Schema({
  appointment: { type: Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
  phoneE164: { type: String, required: true, index: true },
  dueAt: { type: Date, required: true, index: true },
  intervalMinutes: { type: Number, required: true },
  status: { type: String, enum: ["pending", "processing", "sent_to_meta", "cancelled", "failed"], default: "pending" },
  metaMessageId: { type: String },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, maxlength: 1200 }
}, baseOptions);

reminderJobSchema.index({ appointment: 1, intervalMinutes: 1 }, { unique: true });

const notificationSchema = new Schema({
  title: { type: String, required: true },
  message: { type: String, required: true, maxlength: 2000 },
  type: { type: String, enum: ["info", "success", "warning", "error"], default: "info" },
  audienceRole: { type: String, enum: ["super_admin", "admin", "receptionist", "all"], default: "all" },
  readBy: [{ type: Schema.Types.ObjectId, ref: "StaffUser" }]
}, baseOptions);

const emailNotificationOutboxSchema = new Schema({
  appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
  notificationType: { type: String, enum: ["OWNER_NEW_APPOINTMENT_EMAIL"], required: true },
  channel: { type: String, enum: ["email"], default: "email", required: true },
  recipient: { type: String, default: "", trim: true },
  requestId: { type: String, maxlength: 100 },
  templateKey: { type: String, default: "owner-new-appointment", required: true },
  status: {
    type: String,
    enum: ["queued", "sending", "sent", "failed", "dead_letter"],
    default: "queued",
    index: true
  },
  attemptCount: { type: Number, default: 0, min: 0 },
  nextRetryAt: { type: Date, default: Date.now, index: true },
  lockedAt: { type: Date },
  lockExpiresAt: { type: Date, index: true },
  lastAttemptAt: { type: Date },
  providerMessageId: { type: String, maxlength: 500 },
  sentAt: { type: Date },
  failedAt: { type: Date },
  failureCode: { type: String, maxlength: 100 },
  failureMessageSafe: { type: String, maxlength: 300 }
}, baseOptions);

emailNotificationOutboxSchema.index(
  { appointmentId: 1, notificationType: 1, recipient: 1 },
  { unique: true }
);
emailNotificationOutboxSchema.index({ status: 1, nextRetryAt: 1, lockExpiresAt: 1 });

const auditLogSchema = new Schema({
  actorType: { type: String, enum: ["staff", "patient", "system", "whatsapp"], required: true },
  actorStaff: { type: Schema.Types.ObjectId, ref: "StaffUser" },
  actorPhone: { type: String },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true },
  entityId: { type: String },
  ip: { type: String },
  userAgent: { type: String },
  metadata: { type: Schema.Types.Mixed }
}, baseOptions);

auditLogSchema.index({ createdAt: -1 });

const models = {
  Counter: mongoose.model("Counter", counterSchema),
  StaffUser: mongoose.model("StaffUser", staffUserSchema),
  RefreshTokenSession: mongoose.model("RefreshTokenSession", refreshTokenSessionSchema),
  Patient: mongoose.model("Patient", patientSchema),
  PatientConsent: mongoose.model("PatientConsent", patientConsentSchema),
  OptOutPreference: mongoose.model("OptOutPreference", optOutPreferenceSchema),
  Appointment: mongoose.model("Appointment", appointmentSchema),
  RescheduleHistory: mongoose.model("RescheduleHistory", rescheduleHistorySchema),
  ConversationSession: mongoose.model("ConversationSession", conversationSessionSchema),
  WhatsAppMessage: mongoose.model("WhatsAppMessage", whatsappMessageSchema),
  MessageDeliveryStatus: mongoose.model("MessageDeliveryStatus", messageDeliveryStatusSchema),
  ClinicSettings: mongoose.model("ClinicSettings", clinicSettingsSchema),
  DoctorProfileSettings: mongoose.model("DoctorProfileSettings", doctorProfileSettingsSchema),
  BlockedDate: mongoose.model("BlockedDate", blockedDateSchema),
  BlockedSlot: mongoose.model("BlockedSlot", blockedSlotSchema),
  AvailableTimeSlot: mongoose.model("AvailableTimeSlot", availableTimeSlotSchema),
  ReminderJob: mongoose.model("ReminderJob", reminderJobSchema),
  Notification: mongoose.model("Notification", notificationSchema),
  EmailNotificationOutbox: mongoose.model("EmailNotificationOutbox", emailNotificationOutboxSchema),
  AuditLog: mongoose.model("AuditLog", auditLogSchema)
};

module.exports = models;
