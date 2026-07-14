const { DateTime } = require("luxon");
const { config } = require("../config/env");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function defaultWeeklyHours() {
  return [
    { day: 1, isOpen: true, start: "09:00", end: "16:00" },
    { day: 2, isOpen: true, start: "09:00", end: "16:00" },
    { day: 3, isOpen: true, start: "09:00", end: "16:00" },
    { day: 4, isOpen: true, start: "09:00", end: "16:00" },
    { day: 5, isOpen: true, start: "09:00", end: "16:00" },
    { day: 6, isOpen: false, start: "09:00", end: "16:00" },
    { day: 7, isOpen: false, start: "09:00", end: "16:00" }
  ];
}

function minutesFromTime(time) {
  if (!TIME_RE.test(time)) return NaN;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function nowInClinicZone(timezone = config.clinicTimezone) {
  return DateTime.now().setZone(timezone);
}

function appointmentDateTime(date, time, timezone = config.clinicTimezone) {
  return DateTime.fromISO(`${date}T${time}`, { zone: timezone });
}

function isDateString(value) {
  return DATE_RE.test(String(value || ""));
}

function isTimeString(value) {
  return TIME_RE.test(String(value || ""));
}

function normalizeTime(value) {
  const input = String(value || "").trim().toLowerCase();
  if (TIME_RE.test(input)) return input;

  const compact = input.replace(/\s+/g, "");
  const meridian = compact.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)$/);
  if (meridian) {
    let hour = Number(meridian[1]);
    const minute = Number(meridian[2] || 0);
    if (meridian[3] === "pm" && hour !== 12) hour += 12;
    if (meridian[3] === "am" && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const colon = input.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour > 23 || minute > 59) return "";
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  return "";
}

function parsePatientDate(text, timezone = config.clinicTimezone) {
  const input = String(text || "").trim().toLowerCase();
  const today = nowInClinicZone(timezone).startOf("day");
  if (DATE_RE.test(input)) return input;
  if (/\b(today|aaj|aj|آج)\b/.test(input)) return today.toISODate();
  if (/\b(tomorrow|kal|کل)\b/.test(input)) return today.plus({ days: 1 }).toISODate();

  const weekdayNames = {
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
    sunday: 7,
    sun: 7
  };

  for (const [name, weekday] of Object.entries(weekdayNames)) {
    if (new RegExp(`\\b${name}\\b`).test(input)) {
      let candidate = today;
      while (candidate.weekday !== weekday) candidate = candidate.plus({ days: 1 });
      if (candidate <= today) candidate = candidate.plus({ days: 7 });
      return candidate.toISODate();
    }
  }

  return "";
}

function getDaySchedule(settings, date) {
  const timezone = settings.timezone || config.clinicTimezone;
  const dateTime = DateTime.fromISO(date, { zone: timezone });
  if (!dateTime.isValid) return null;
  const weeklyHours = settings.weeklyHours && settings.weeklyHours.length
    ? settings.weeklyHours
    : defaultWeeklyHours();
  return weeklyHours.find((entry) => Number(entry.day) === dateTime.weekday) || null;
}

function validateSlotAgainstSchedule({ settings, date, time, now = nowInClinicZone(settings.timezone) }) {
  if (!isDateString(date)) {
    return { ok: false, reason: "Use a valid appointment date in YYYY-MM-DD format." };
  }
  if (!isTimeString(time)) {
    return { ok: false, reason: "Use a valid appointment time in HH:mm format." };
  }

  const timezone = settings.timezone || config.clinicTimezone;
  const dateTime = appointmentDateTime(date, time, timezone);
  if (!dateTime.isValid) return { ok: false, reason: "The selected appointment date or time is invalid." };

  if (dateTime <= now) {
    return { ok: false, reason: "Past dates and expired time slots cannot be booked." };
  }

  const daySchedule = getDaySchedule(settings, date);
  if (!daySchedule || !daySchedule.isOpen) {
    return { ok: false, reason: "Dr. Khurram is available Monday to Friday from 9:00 AM to 4:00 PM. The clinic is closed on Saturday and Sunday." };
  }

  const selected = minutesFromTime(time);
  const start = minutesFromTime(daySchedule.start);
  const end = minutesFromTime(daySchedule.end);
  if (selected < start || selected > end) {
    return { ok: false, reason: "Appointments are available only from 9:00 AM to 4:00 PM." };
  }

  return { ok: true };
}

function generateScheduleSlots(settings, date) {
  const daySchedule = getDaySchedule(settings, date);
  if (!daySchedule || !daySchedule.isOpen) return [];

  const duration = Number(settings.slotDurationMinutes || 30);
  const start = minutesFromTime(daySchedule.start);
  const end = minutesFromTime(daySchedule.end);
  const slots = [];

  for (let minute = start; minute <= end; minute += duration) {
    slots.push(timeFromMinutes(minute));
  }

  return slots;
}

function slotKey(date, time) {
  return `${date}|${time}`;
}

function activePatientDateKey(phoneE164, date) {
  return `${phoneE164}|${date}`;
}

module.exports = {
  defaultWeeklyHours,
  minutesFromTime,
  timeFromMinutes,
  nowInClinicZone,
  appointmentDateTime,
  isDateString,
  isTimeString,
  normalizeTime,
  parsePatientDate,
  validateSlotAgainstSchedule,
  generateScheduleSlots,
  slotKey,
  activePatientDateKey
};
