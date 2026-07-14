const { DateTime } = require("luxon");
const { Appointment, BlockedDate, BlockedSlot } = require("../models");
const { badRequest, conflict, notFound } = require("../utils/errors");
const {
  generateScheduleSlots,
  validateSlotAgainstSchedule,
  nowInClinicZone,
  appointmentDateTime,
  slotKey
} = require("../utils/time");
const { getClinicSettings } = require("./settingsService");

async function ensureSlotBookable(date, time) {
  const settings = await getClinicSettings();
  const validation = validateSlotAgainstSchedule({ settings, date, time });
  if (!validation.ok) throw badRequest(validation.reason);

  const blockedDate = await BlockedDate.findOne({ date });
  if (blockedDate) throw conflict("The selected date is blocked by the clinic.");

  const blockedSlot = await BlockedSlot.findOne({ slotKey: slotKey(date, time) });
  if (blockedSlot) throw conflict("The selected time slot is blocked by the clinic.");

  const existing = await Appointment.findOne({
    activeSlotKey: slotKey(date, time),
    status: { $in: ["scheduled", "rescheduled"] }
  });
  if (existing) throw conflict("The selected appointment slot is already booked.");

  return true;
}

async function getAvailableSlots(date) {
  const settings = await getClinicSettings();
  const validation = validateSlotAgainstSchedule({
    settings,
    date,
    time: "09:00",
    now: nowInClinicZone(settings.timezone).minus({ days: 1 })
  });
  if (!validation.ok && !validation.reason.includes("Past")) return [];

  const blockedDate = await BlockedDate.findOne({ date });
  if (blockedDate) return [];

  const scheduleSlots = generateScheduleSlots(settings, date);
  const [blockedSlots, bookedAppointments] = await Promise.all([
    BlockedSlot.find({ date }).lean(),
    Appointment.find({ date, status: { $in: ["scheduled", "rescheduled"] } }).select("time").lean()
  ]);

  const blocked = new Set(blockedSlots.map((slot) => slot.time));
  const booked = new Set(bookedAppointments.map((appointment) => appointment.time));
  const now = nowInClinicZone(settings.timezone);

  return scheduleSlots
    .filter((time) => appointmentDateTime(date, time, settings.timezone) > now)
    .map((time) => ({
      time,
      available: !blocked.has(time) && !booked.has(time),
      blocked: blocked.has(time),
      booked: booked.has(time)
    }));
}

async function getAvailableDates(days = 21) {
  const settings = await getClinicSettings();
  const today = nowInClinicZone(settings.timezone).startOf("day");
  const dates = [];

  for (let i = 0; i < Number(days || 21); i += 1) {
    const date = today.plus({ days: i }).toISODate();
    const slots = await getAvailableSlots(date);
    if (slots.some((slot) => slot.available)) {
      dates.push({ date, availableSlots: slots.filter((slot) => slot.available).length });
    }
  }

  return dates;
}

async function blockDate({ date, reason, staffUser }) {
  const settings = await getClinicSettings();
  const parsed = DateTime.fromISO(date, { zone: settings.timezone });
  if (!parsed.isValid) throw badRequest("Use a valid date in YYYY-MM-DD format.");
  return BlockedDate.findOneAndUpdate(
    { date },
    { $set: { reason, blockedBy: staffUser?._id } },
    { new: true, upsert: true, runValidators: true }
  );
}

async function unblockDate(date) {
  const result = await BlockedDate.findOneAndDelete({ date });
  if (!result) throw notFound("Blocked date was not found.");
  return result;
}

async function blockSlot({ date, time, reason, staffUser }) {
  const settings = await getClinicSettings();
  const validation = validateSlotAgainstSchedule({
    settings,
    date,
    time,
    now: nowInClinicZone(settings.timezone).minus({ years: 1 })
  });
  if (!validation.ok) throw badRequest(validation.reason);

  return BlockedSlot.findOneAndUpdate(
    { slotKey: slotKey(date, time) },
    { $set: { date, time, slotKey: slotKey(date, time), reason, blockedBy: staffUser?._id } },
    { new: true, upsert: true, runValidators: true }
  );
}

async function unblockSlot(date, time) {
  const result = await BlockedSlot.findOneAndDelete({ slotKey: slotKey(date, time) });
  if (!result) throw notFound("Blocked slot was not found.");
  return result;
}

module.exports = {
  ensureSlotBookable,
  getAvailableSlots,
  getAvailableDates,
  blockDate,
  unblockDate,
  blockSlot,
  unblockSlot
};
