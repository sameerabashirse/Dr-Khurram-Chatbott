const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const {
  defaultWeeklyHours,
  validateSlotAgainstSchedule,
  generateScheduleSlots
} = require("../src/utils/time");

const settings = {
  timezone: "Asia/Karachi",
  weeklyHours: defaultWeeklyHours(),
  slotDurationMinutes: 30
};

test("allows a future weekday slot inside clinic hours", () => {
  const now = DateTime.fromISO("2026-07-13T08:00", { zone: "Asia/Karachi" });
  const result = validateSlotAgainstSchedule({ settings, date: "2026-07-13", time: "09:00", now });
  assert.equal(result.ok, true);
});

test("blocks Saturday and Sunday", () => {
  const now = DateTime.fromISO("2026-07-13T08:00", { zone: "Asia/Karachi" });
  assert.equal(validateSlotAgainstSchedule({ settings, date: "2026-07-18", time: "10:00", now }).ok, false);
  assert.equal(validateSlotAgainstSchedule({ settings, date: "2026-07-19", time: "10:00", now }).ok, false);
});

test("blocks times before 09:00 and after 16:00", () => {
  const now = DateTime.fromISO("2026-07-13T08:00", { zone: "Asia/Karachi" });
  assert.equal(validateSlotAgainstSchedule({ settings, date: "2026-07-13", time: "08:59", now }).ok, false);
  assert.equal(validateSlotAgainstSchedule({ settings, date: "2026-07-13", time: "16:01", now }).ok, false);
});

test("blocks expired slots", () => {
  const now = DateTime.fromISO("2026-07-13T10:00", { zone: "Asia/Karachi" });
  const result = validateSlotAgainstSchedule({ settings, date: "2026-07-13", time: "09:30", now });
  assert.equal(result.ok, false);
});

test("generates expected weekday slots including 16:00", () => {
  const slots = generateScheduleSlots(settings, "2026-07-13");
  assert.equal(slots[0], "09:00");
  assert.equal(slots.at(-1), "16:00");
});
