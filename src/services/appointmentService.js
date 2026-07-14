const {
  Appointment,
  Counter,
  Patient,
  PatientConsent,
  RescheduleHistory
} = require("../models");
const { badRequest, conflict, notFound } = require("../utils/errors");
const { config } = require("../config/env");
const { maskPhone, normalizePhone, safePublicAppointment } = require("../utils/security");
const { normalizeTime, slotKey, activePatientDateKey } = require("../utils/time");
const { ensureSlotBookable } = require("./availabilityService");
const { audit } = require("./auditService");

const activeStatuses = ["scheduled", "rescheduled"];

async function nextSequence(key) {
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

async function generateAppointmentId(date) {
  const year = String(date).slice(0, 4);
  const seq = await nextSequence(`appointment:${year}`);
  return `KHR-${year}-${String(seq).padStart(6, "0")}`;
}

async function generateTokenNumber(date) {
  const seq = await nextSequence(`token:${date}`);
  return String(seq).padStart(3, "0");
}

async function findOrCreatePatient(input) {
  const phoneE164 = normalizePhone(input.phone);
  if (!phoneE164) throw badRequest("A valid phone number is required.");

  return Patient.findOneAndUpdate(
    { phoneE164 },
    {
      $set: {
        fullName: input.fullName,
        age: input.age,
        gender: input.gender || "not_provided",
        preferredLanguage: input.preferredLanguage || "en"
      }
    },
    { new: true, upsert: true, runValidators: true }
  );
}

async function createConsent({ patient, phoneE164, consentGiven, channel, language }) {
  return PatientConsent.create({
    patient: patient._id,
    phoneE164,
    consentGiven,
    channel,
    language: language || "en",
    consentText: "Patient information will be used for appointment management, reminders, rescheduling, and cancellation support.",
    consentedAt: new Date()
  });
}

async function sendAppointmentEventTemplate(appointment, templateName, kind) {
  if (!templateName) return { status: "not_configured" };
  const { sendTemplate } = require("./whatsappService");
  const result = await sendTemplate(
    appointment.phoneE164,
    templateName,
    "en",
    [
      appointment.patientSnapshot.fullName,
      appointment.appointmentId,
      appointment.tokenNumber,
      appointment.date,
      appointment.time,
      config.clinicContactNumber
    ]
  );
  if (kind === "confirmation") {
    appointment.confirmationMessageStatus = result.status;
    await appointment.save();
  }
  return result;
}

async function createAppointment(input, options = {}) {
  const source = options.source || input.source || "website";
  if (!input.consentGiven && source !== "staff") {
    throw badRequest("Patient consent is required before collecting appointment information.");
  }

  const time = normalizeTime(input.time);
  if (!time) throw badRequest("Use a valid appointment time.");
  await ensureSlotBookable(input.date, time);

  const patient = await findOrCreatePatient(input);
  const phoneE164 = patient.phoneE164;

  const activeDuplicate = await Appointment.findOne({
    phoneE164,
    date: input.date,
    status: { $in: activeStatuses }
  });
  if (activeDuplicate) {
    throw conflict("This patient already has an active appointment on the selected date.");
  }

  const consent = await createConsent({
    patient,
    phoneE164,
    consentGiven: Boolean(input.consentGiven || source === "staff"),
    channel: source,
    language: input.preferredLanguage || patient.preferredLanguage
  });

  const appointmentId = await generateAppointmentId(input.date);
  const tokenNumber = await generateTokenNumber(input.date);

  try {
    const appointment = await Appointment.create({
      appointmentId,
      tokenNumber,
      patient: patient._id,
      patientSnapshot: {
        fullName: input.fullName,
        phoneMasked: maskPhone(phoneE164),
        age: input.age,
        gender: input.gender || "not_provided",
        preferredLanguage: input.preferredLanguage || patient.preferredLanguage || "en"
      },
      phoneE164,
      reason: input.reason,
      optionalNote: input.optionalNote,
      date: input.date,
      time,
      activeSlotKey: slotKey(input.date, time),
      activePatientDateKey: activePatientDateKey(phoneE164, input.date),
      consent: consent._id,
      source,
      createdBy: options.staffUser?._id
    });

    const { scheduleAppointmentReminders } = require("./reminderService");
    await scheduleAppointmentReminders(appointment);
    if (!options.skipWhatsAppTemplate && source !== "whatsapp") {
      await sendAppointmentEventTemplate(
        appointment,
        config.whatsapp.templates.appointmentConfirmation,
        "confirmation"
      );
    }
    await audit({
      actorType: source === "staff" ? "staff" : "patient",
      actorStaff: options.staffUser?._id,
      actorPhone: source === "staff" ? undefined : phoneE164,
      action: "appointment.created",
      entityType: "appointment",
      entityId: appointment.appointmentId,
      req: options.req
    });

    return appointment;
  } catch (error) {
    if (error.code === 11000) {
      throw conflict("The selected slot or token was just taken. Please choose another available slot.");
    }
    throw error;
  }
}

async function lookupAppointment({ appointmentId, phone }) {
  const phoneE164 = normalizePhone(phone);
  const appointment = await Appointment.findOne({ appointmentId, phoneE164 });
  if (!appointment) throw notFound("Appointment was not found for the provided appointment ID and phone number.");
  return appointment;
}

async function listAppointments(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.date) filter.date = query.date;
  if (query.from || query.to) {
    filter.date = {};
    if (query.from) filter.date.$gte = query.from;
    if (query.to) filter.date.$lte = query.to;
  }
  if (query.search) {
    const phone = normalizePhone(query.search);
    filter.$or = [
      { appointmentId: new RegExp(query.search, "i") },
      { "patientSnapshot.fullName": new RegExp(query.search, "i") }
    ];
    if (phone) filter.$or.push({ phoneE164: phone });
  }

  const limit = Math.min(Number(query.limit) || 100, 300);
  return Appointment.find(filter).sort({ date: 1, time: 1 }).limit(limit).lean();
}

async function getAppointmentById(id) {
  const appointment = await Appointment.findById(id);
  if (!appointment) throw notFound("Appointment was not found.");
  return appointment;
}

async function rescheduleAppointment({ appointmentId, phone, date, time, reason }, options = {}) {
  const appointment = options.staffUser
    ? await Appointment.findOne({ appointmentId })
    : await lookupAppointment({ appointmentId, phone });

  if (!activeStatuses.includes(appointment.status)) {
    throw badRequest("Only active appointments can be rescheduled.");
  }

  const normalizedTime = normalizeTime(time);
  if (!normalizedTime) throw badRequest("Use a valid appointment time.");

  if (appointment.date === date && appointment.time === normalizedTime) {
    throw badRequest("The new appointment slot must be different from the current slot.");
  }

  await ensureSlotBookable(date, normalizedTime);

  const previousDate = appointment.date;
  const previousTime = appointment.time;

  appointment.date = date;
  appointment.time = normalizedTime;
  appointment.status = "rescheduled";
  appointment.activeSlotKey = slotKey(date, normalizedTime);
  appointment.activePatientDateKey = activePatientDateKey(appointment.phoneE164, date);
  appointment.rescheduleCount += 1;

  try {
    await appointment.save();
  } catch (error) {
    if (error.code === 11000) throw conflict("The selected slot is no longer available.");
    throw error;
  }

  await RescheduleHistory.create({
    appointment: appointment._id,
    previousDate,
    previousTime,
    newDate: date,
    newTime: normalizedTime,
    changedByType: options.staffUser ? "staff" : "patient",
    changedByStaff: options.staffUser?._id,
    reason
  });

  const { cancelAppointmentReminders, scheduleAppointmentReminders } = require("./reminderService");
  await cancelAppointmentReminders(appointment._id);
  await scheduleAppointmentReminders(appointment);
  await audit({
    actorType: options.staffUser ? "staff" : "patient",
    actorStaff: options.staffUser?._id,
    actorPhone: options.staffUser ? undefined : appointment.phoneE164,
    action: "appointment.rescheduled",
    entityType: "appointment",
    entityId: appointment.appointmentId,
    metadata: { previousDate, previousTime, newDate: date, newTime: normalizedTime },
    req: options.req
  });

  if (!options.skipWhatsAppTemplate) {
    await sendAppointmentEventTemplate(
      appointment,
      config.whatsapp.templates.rescheduleConfirmation,
      "reschedule"
    );
  }

  return appointment;
}

async function cancelAppointment({ appointmentId, phone, reason }, options = {}) {
  const appointment = options.staffUser
    ? await Appointment.findOne({ appointmentId })
    : await lookupAppointment({ appointmentId, phone });

  if (!appointment) throw notFound("Appointment was not found.");
  if (!activeStatuses.includes(appointment.status)) {
    throw badRequest("Only active appointments can be cancelled.");
  }

  appointment.status = "cancelled";
  appointment.activeSlotKey = undefined;
  appointment.activePatientDateKey = undefined;
  appointment.cancelledAt = new Date();
  appointment.reminderStatus = "cancelled";
  await appointment.save();

  const { cancelAppointmentReminders } = require("./reminderService");
  await cancelAppointmentReminders(appointment._id);
  await audit({
    actorType: options.staffUser ? "staff" : "patient",
    actorStaff: options.staffUser?._id,
    actorPhone: options.staffUser ? undefined : appointment.phoneE164,
    action: "appointment.cancelled",
    entityType: "appointment",
    entityId: appointment.appointmentId,
    metadata: { reason },
    req: options.req
  });

  if (!options.skipWhatsAppTemplate) {
    await sendAppointmentEventTemplate(
      appointment,
      config.whatsapp.templates.cancellationConfirmation,
      "cancellation"
    );
  }

  return appointment;
}

async function updateAppointmentStatus(id, status, options = {}) {
  const appointment = await Appointment.findById(id);
  if (!appointment) throw notFound("Appointment was not found.");

  appointment.status = status;
  if (!activeStatuses.includes(status)) {
    appointment.activeSlotKey = undefined;
    appointment.activePatientDateKey = undefined;
  }
  if (status === "visited") appointment.visitedAt = new Date();
  if (status === "no_show") appointment.noShowAt = new Date();
  await appointment.save();

  if (!activeStatuses.includes(status)) {
    const { cancelAppointmentReminders } = require("./reminderService");
    await cancelAppointmentReminders(appointment._id);
  }

  await audit({
    actorType: "staff",
    actorStaff: options.staffUser?._id,
    action: `appointment.${status}`,
    entityType: "appointment",
    entityId: appointment.appointmentId,
    req: options.req
  });

  return appointment;
}

module.exports = {
  createAppointment,
  lookupAppointment,
  listAppointments,
  getAppointmentById,
  rescheduleAppointment,
  cancelAppointment,
  updateAppointmentStatus,
  safePublicAppointment
};
