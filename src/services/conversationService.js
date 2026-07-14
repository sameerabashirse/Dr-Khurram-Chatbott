const {
  ConversationSession,
  Notification,
  OptOutPreference,
  Patient
} = require("../models");
const { createAppointment, lookupAppointment, rescheduleAppointment, cancelAppointment, safePublicAppointment } = require("./appointmentService");
const { getAvailableSlots } = require("./availabilityService");
const { understandMessage, t } = require("./aiService");
const { normalizePhone } = require("../utils/security");
const { normalizeTime, parsePatientDate } = require("../utils/time");
const { audit } = require("./auditService");

function isAffirmative(text) {
  return /^(yes|y|ok|okay|agree|consent|ji|haan|han|ہاں)$/i.test(String(text || "").trim());
}

function isCancelConfirmation(text) {
  return /confirm cancel/i.test(String(text || ""));
}

async function optOut(phoneE164, session, text) {
  const patient = await Patient.findOneAndUpdate(
    { phoneE164 },
    { $setOnInsert: { phoneE164 }, $set: { optOut: true } },
    { new: true, upsert: true }
  );
  await OptOutPreference.findOneAndUpdate(
    { phoneE164 },
    { $set: { patient: patient._id, optedOut: true, reason: text, channel: "whatsapp", optedOutAt: new Date() } },
    { upsert: true, new: true }
  );
  session.state = "idle";
  session.intent = "opt_out";
  session.context = {};
  await session.save();
  return t(session.language, "optedOut");
}

async function availableSlotText(date) {
  const slots = await getAvailableSlots(date);
  const available = slots.filter((slot) => slot.available).slice(0, 12).map((slot) => slot.time);
  return available.length ? available.join(", ") : "No slots available";
}

async function handleBooking(session, phoneE164, text) {
  const context = session.context || {};

  if (session.state === "booking_consent") {
    if (!isAffirmative(text)) return t(session.language, "consent");
    session.state = "booking_name";
    session.context = { ...context, consentGiven: true };
    await session.save();
    return t(session.language, "askName");
  }

  if (session.state === "booking_name") {
    session.state = "booking_age";
    session.context = { ...context, fullName: String(text).trim() };
    await session.save();
    return t(session.language, "askAge");
  }

  if (session.state === "booking_age") {
    const age = Number(String(text).match(/\d+/)?.[0]);
    if (!Number.isFinite(age) || age < 0 || age > 130) return t(session.language, "askAge");
    session.state = "booking_reason";
    session.context = { ...context, age };
    await session.save();
    return t(session.language, "askReason");
  }

  if (session.state === "booking_reason") {
    session.state = "booking_date";
    session.context = { ...context, reason: String(text).trim().slice(0, 1000) };
    await session.save();
    return t(session.language, "askDate");
  }

  if (session.state === "booking_date") {
    const date = parsePatientDate(text);
    if (!date) return t(session.language, "askDate");
    const slots = await availableSlotText(date);
    if (slots === "No slots available") return `No available slots on ${date}. ${t(session.language, "askDate")}`;
    session.state = "booking_time";
    session.context = { ...context, date };
    await session.save();
    return t(session.language, "askTime", { slots });
  }

  if (session.state === "booking_time") {
    const time = normalizeTime(text);
    if (!time) return t(session.language, "askTime", { slots: await availableSlotText(context.date) });
    const appointment = await createAppointment({
      fullName: context.fullName,
      phone: phoneE164,
      age: context.age,
      preferredLanguage: session.language,
      reason: context.reason,
      date: context.date,
      time,
      consentGiven: context.consentGiven
    }, { source: "whatsapp", skipWhatsAppTemplate: true });
    session.state = "idle";
    session.intent = "menu";
    session.context = {};
    await session.save();
    return t(session.language, "booked", {
      id: appointment.appointmentId,
      token: appointment.tokenNumber,
      date: appointment.date,
      time: appointment.time
    });
  }

  session.intent = "book";
  session.state = "booking_consent";
  session.context = {};
  await session.save();
  return t(session.language, "consent");
}

async function handleLookup(session, phoneE164, text) {
  const appointmentId = String(text || "").match(/KHR-\d{4}-\d{6}/i)?.[0]?.toUpperCase();
  if (!appointmentId) {
    session.state = "lookup_id";
    await session.save();
    return t(session.language, "lookupAsk");
  }
  const appointment = await lookupAppointment({ appointmentId, phone: phoneE164 });
  const publicAppointment = safePublicAppointment(appointment);
  session.state = "idle";
  session.context = {};
  await session.save();
  return t(session.language, "lookupResult", {
    id: publicAppointment.appointmentId,
    token: publicAppointment.tokenNumber,
    name: publicAppointment.patientName,
    date: publicAppointment.date,
    time: publicAppointment.time,
    status: publicAppointment.status,
    reminder: publicAppointment.reminderStatus
  });
}

async function handleReschedule(session, phoneE164, text) {
  const context = session.context || {};
  if (!context.appointmentId) {
    const appointmentId = String(text || "").match(/KHR-\d{4}-\d{6}/i)?.[0]?.toUpperCase();
    if (!appointmentId) {
      session.state = "reschedule_id";
      await session.save();
      return t(session.language, "lookupAsk");
    }
    session.context = { appointmentId };
    session.state = "reschedule_date";
    await session.save();
    return t(session.language, "rescheduleDate");
  }

  if (session.state === "reschedule_date") {
    const date = parsePatientDate(text);
    if (!date) return t(session.language, "rescheduleDate");
    const slots = await availableSlotText(date);
    if (slots === "No slots available") return `No available slots on ${date}. ${t(session.language, "rescheduleDate")}`;
    session.context = { ...context, date };
    session.state = "reschedule_time";
    await session.save();
    return t(session.language, "rescheduleTime", { slots });
  }

  if (session.state === "reschedule_time") {
    const time = normalizeTime(text);
    if (!time) return t(session.language, "rescheduleTime", { slots: await availableSlotText(context.date) });
    const appointment = await rescheduleAppointment({
      appointmentId: context.appointmentId,
      phone: phoneE164,
      date: context.date,
      time
    }, { skipWhatsAppTemplate: true });
    session.state = "idle";
    session.context = {};
    await session.save();
    return t(session.language, "rescheduled", { id: appointment.appointmentId, date: appointment.date, time: appointment.time });
  }

  return t(session.language, "rescheduleDate");
}

async function handleCancel(session, phoneE164, text) {
  const context = session.context || {};
  if (!context.appointmentId) {
    const appointmentId = String(text || "").match(/KHR-\d{4}-\d{6}/i)?.[0]?.toUpperCase();
    if (!appointmentId) {
      session.state = "cancel_id";
      await session.save();
      return t(session.language, "lookupAsk");
    }
    session.context = { appointmentId };
    session.state = "cancel_confirm";
    await session.save();
    return t(session.language, "cancelConfirm", { id: appointmentId });
  }

  if (session.state === "cancel_confirm" && isCancelConfirmation(text)) {
    const appointment = await cancelAppointment(
      { appointmentId: context.appointmentId, phone: phoneE164 },
      { skipWhatsAppTemplate: true }
    );
    session.state = "idle";
    session.context = {};
    await session.save();
    return t(session.language, "cancelled", { id: appointment.appointmentId });
  }

  return t(session.language, "cancelConfirm", { id: context.appointmentId });
}

async function requestStaff(session, phoneE164) {
  session.humanRequired = true;
  session.intent = "talk_to_staff";
  await session.save();
  await Notification.create({
    title: "WhatsApp staff assistance requested",
    message: `${phoneE164} requested staff support.`,
    type: "warning",
    audienceRole: "all"
  });
  await audit({
    actorType: "patient",
    actorPhone: phoneE164,
    action: "conversation.staff_requested",
    entityType: "conversation",
    entityId: session._id.toString()
  });
  return t(session.language, "staff");
}

async function handleIncomingText({ phoneE164, text }) {
  const normalizedPhone = normalizePhone(phoneE164);
  let session = await ConversationSession.findOneAndUpdate(
    { phoneE164: normalizedPhone },
    { $setOnInsert: { phoneE164: normalizedPhone }, $set: { lastMessageAt: new Date() } },
    { upsert: true, new: true }
  );

  if (session.aiPaused) return null;

  const understood = await understandMessage(text, session.language);
  session.language = understood.language || session.language || "en";
  await session.save();

  if (understood.intent === "opt_out") return optOut(normalizedPhone, session, text);
  if (understood.intent === "emergency") return t(session.language, "emergency");

  if (session.state.startsWith("booking_")) return handleBooking(session, normalizedPhone, text);
  if (session.state.startsWith("lookup_")) return handleLookup(session, normalizedPhone, text);
  if (session.state.startsWith("reschedule_")) return handleReschedule(session, normalizedPhone, text);
  if (session.state.startsWith("cancel_")) return handleCancel(session, normalizedPhone, text);

  switch (understood.intent) {
    case "book":
      return handleBooking(session, normalizedPhone, text);
    case "lookup":
      session.state = "lookup_id";
      await session.save();
      return handleLookup(session, normalizedPhone, text);
    case "reschedule":
      session.state = "reschedule_id";
      await session.save();
      return handleReschedule(session, normalizedPhone, text);
    case "cancel":
      session.state = "cancel_id";
      await session.save();
      return handleCancel(session, normalizedPhone, text);
    case "timing":
      return t(session.language, "timing");
    case "location":
      return t(session.language, "location");
    case "doctor_profile":
      return t(session.language, "doctor");
    case "talk_to_staff":
      return requestStaff(session, normalizedPhone);
    default:
      return t(session.language, "menu");
  }
}

module.exports = { handleIncomingText };
