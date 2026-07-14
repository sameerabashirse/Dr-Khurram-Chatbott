const cron = require("node-cron");
const { Appointment, ReminderJob } = require("../models");
const { config } = require("../config/env");
const { appointmentDateTime } = require("../utils/time");
const { getClinicSettings } = require("./settingsService");
const { sendTemplate } = require("./whatsappService");

let schedulerStarted = false;

async function scheduleAppointmentReminders(appointment) {
  const settings = await getClinicSettings();
  const appointmentAt = appointmentDateTime(appointment.date, appointment.time, settings.timezone);
  const now = new Date();
  const jobs = [];

  for (const minutes of settings.reminderIntervalsMinutes || []) {
    const dueAt = appointmentAt.minus({ minutes }).toJSDate();
    if (dueAt > now) {
      jobs.push({
        appointment: appointment._id,
        phoneE164: appointment.phoneE164,
        dueAt,
        intervalMinutes: minutes,
        status: "pending"
      });
    }
  }

  if (!jobs.length) {
    appointment.reminderStatus = "sent";
    await appointment.save();
    return [];
  }

  await ReminderJob.insertMany(jobs, { ordered: false }).catch((error) => {
    if (error.code !== 11000) throw error;
  });
  appointment.reminderStatus = "pending";
  await appointment.save();
  return jobs;
}

async function cancelAppointmentReminders(appointmentId) {
  await ReminderJob.updateMany(
    { appointment: appointmentId, status: { $in: ["pending", "processing"] } },
    { $set: { status: "cancelled" } }
  );
}

async function processDueReminders() {
  const dueJobs = await ReminderJob.find({
    status: "pending",
    dueAt: { $lte: new Date() }
  }).sort({ dueAt: 1 }).limit(25).populate("appointment");

  for (const job of dueJobs) {
    job.status = "processing";
    job.attempts += 1;
    await job.save();

    try {
      const appointment = job.appointment;
      if (!appointment || !["scheduled", "rescheduled"].includes(appointment.status)) {
        job.status = "cancelled";
        await job.save();
        continue;
      }

      const result = await sendTemplate(
        job.phoneE164,
        config.whatsapp.templates.appointmentReminder,
        "en",
        [
          appointment.patientSnapshot.fullName,
          appointment.appointmentId,
          appointment.date,
          appointment.time,
          config.clinicContactNumber,
          "Reply with your Appointment ID to reschedule or cancel."
        ]
      );

      job.status = result.status === "sent_to_meta" ? "sent_to_meta" : "failed";
      job.metaMessageId = result.metaMessageId;
      job.lastError = result.error;
      await job.save();

      const remaining = await ReminderJob.countDocuments({ appointment: appointment._id, status: "pending" });
      appointment.reminderStatus = remaining ? "partially_sent" : "sent";
      await appointment.save();
    } catch (error) {
      job.status = job.attempts >= 3 ? "failed" : "pending";
      job.lastError = error.message;
      await job.save();
    }
  }
}

function startReminderScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  cron.schedule("* * * * *", () => {
    processDueReminders().catch((error) => console.error("Reminder job failed:", error.message));
  });
}

module.exports = {
  scheduleAppointmentReminders,
  cancelAppointmentReminders,
  processDueReminders,
  startReminderScheduler
};
