const { config } = require("../config/env");
const { randomUUID } = require("crypto");
const { Appointment, EmailNotificationOutbox } = require("../models");
const { AppError } = require("../utils/errors");
const { maskEmail, normalizeEmail, EmailDeliveryError } = require("./emailTransport");
const { sendOwnerAppointmentEmail } = require("./ownerAppointmentEmailService");
const { audit } = require("./auditService");

const NOTIFICATION_TYPE = "OWNER_NEW_APPOINTMENT_EMAIL";
const RETRY_DELAYS_MS = [0, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const LOCK_MS = 2 * 60_000;
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;
let schedulerStarted = false;
let scheduler;

function safeFailureMessage(code) {
  return {
    EMAIL_CONFIGURATION_MISSING: "Email delivery configuration is incomplete.",
    EMAIL_RECIPIENT_INVALID: "The configured notification recipient is invalid.",
    EMAIL_TEMPORARY_FAILURE: "The email provider is temporarily unavailable.",
    EMAIL_PERMANENT_FAILURE: "The email provider rejected the notification.",
    EMAIL_FEATURE_DISABLED: "Owner email notifications are disabled."
  }[code] || "Email delivery failed safely.";
}

async function enqueueOwnerAppointmentEmail(appointment, { session, requestId } = {}) {
  if (!config.emailAppointmentAlert.enabled) return null;
  const recipient = normalizeEmail(config.emailAppointmentAlert.to) || String(config.emailAppointmentAlert.to || "").trim();
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) options.session = session;
  return EmailNotificationOutbox.findOneAndUpdate(
    {
      appointmentId: appointment._id,
      notificationType: NOTIFICATION_TYPE,
      recipient
    },
    {
      $setOnInsert: {
        channel: "email",
        requestId: requestId || randomUUID(),
        templateKey: "owner-new-appointment",
        status: "queued",
        attemptCount: 0,
        nextRetryAt: new Date()
      }
    },
    options
  );
}

async function claimNextJob({ outboxId, now = new Date() } = {}) {
  const query = {
    $or: [
      { status: "queued", nextRetryAt: { $lte: now } },
      { status: "sending", lockExpiresAt: { $lte: now } }
    ]
  };
  if (outboxId) query._id = outboxId;
  return EmailNotificationOutbox.findOneAndUpdate(
    query,
    {
      $set: {
        status: "sending",
        lockedAt: now,
        lockExpiresAt: new Date(now.getTime() + LOCK_MS),
        lastAttemptAt: now
      },
      $inc: { attemptCount: 1 },
      $unset: { failureCode: "", failureMessageSafe: "", failedAt: "" }
    },
    { new: true, sort: { nextRetryAt: 1, createdAt: 1 } }
  );
}

async function markSent(job, messageId, now = new Date()) {
  return EmailNotificationOutbox.updateOne(
    { _id: job._id, status: "sending", sentAt: { $exists: false } },
    {
      $set: { status: "sent", providerMessageId: messageId || "", sentAt: now },
      $unset: { lockedAt: "", lockExpiresAt: "", nextRetryAt: "", failureCode: "", failureMessageSafe: "", failedAt: "" }
    }
  );
}

async function markFailed(job, error, now = new Date()) {
  const deliveryError = error instanceof EmailDeliveryError
    ? error
    : new EmailDeliveryError("EMAIL_PERMANENT_FAILURE", false);
  const attempts = job.attemptCount;
  const canRetry = deliveryError.temporary && attempts < MAX_ATTEMPTS;
  const status = canRetry ? "queued" : (deliveryError.temporary ? "dead_letter" : "failed");
  const update = {
    $set: {
      status,
      failedAt: now,
      failureCode: deliveryError.code,
      failureMessageSafe: safeFailureMessage(deliveryError.code)
    },
    $unset: { lockedAt: "", lockExpiresAt: "" }
  };
  if (canRetry) {
    update.$set.nextRetryAt = new Date(now.getTime() + RETRY_DELAYS_MS[attempts]);
  } else {
    update.$unset.nextRetryAt = "";
  }
  await EmailNotificationOutbox.updateOne({ _id: job._id, status: "sending" }, update);
  return { status, code: deliveryError.code };
}

async function processOwnerEmailJobs({ limit = 10, outboxId, send = sendOwnerAppointmentEmail } = {}) {
  const results = [];
  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextJob({ outboxId });
    if (!job) break;
    try {
      const appointment = await Appointment.findById(job.appointmentId);
      if (!appointment || !["scheduled", "rescheduled"].includes(appointment.status)) {
        throw new EmailDeliveryError("EMAIL_PERMANENT_FAILURE", false);
      }
      const result = await send({ appointment, outbox: job });
      await markSent(job, result?.messageId);
      results.push({ id: job._id, status: "sent" });
    } catch (error) {
      const outcome = await markFailed(job, error);
      console.warn("Owner email notification failed", {
        code: outcome.code,
        recipient: maskEmail(job.recipient),
        notificationId: String(job._id),
        requestId: job.requestId
      });
      results.push({ id: job._id, status: outcome.status, code: outcome.code });
    }
    if (outboxId) break;
  }
  return results;
}

function kickOwnerEmailWorker(outboxId) {
  if (!outboxId) return;
  const immediate = setImmediate(() => {
    processOwnerEmailJobs({ limit: 1, outboxId }).catch((error) => {
      console.warn("Owner email worker failed", { code: "EMAIL_WORKER_FAILURE", message: error.name });
    });
  });
  immediate.unref?.();
}

function publicOwnerEmailStatus(job) {
  if (!job) return { status: "not_configured", label: "Not configured", canRetry: false };
  if (job.status === "sent") return { status: "sent", label: "Sent", canRetry: false };
  if (["failed", "dead_letter"].includes(job.status)) return { status: "failed", label: "Failed", canRetry: true };
  return { status: "queued", label: "Queued", canRetry: false };
}

async function attachOwnerEmailStatuses(appointments) {
  const values = Array.isArray(appointments) ? appointments : [appointments];
  const ids = values.filter(Boolean).map((appointment) => appointment._id);
  if (!ids.length) return appointments;
  const jobs = await EmailNotificationOutbox.find({
    appointmentId: { $in: ids },
    notificationType: NOTIFICATION_TYPE
  }).select("appointmentId status").lean();
  const byAppointment = new Map(jobs.map((job) => [String(job.appointmentId), job]));
  const enriched = values.map((appointment) => {
    const plain = typeof appointment.toObject === "function" ? appointment.toObject() : appointment;
    return { ...plain, ownerEmailNotification: publicOwnerEmailStatus(byAppointment.get(String(plain._id))) };
  });
  return Array.isArray(appointments) ? enriched : enriched[0];
}

async function retryOwnerAppointmentEmail(appointmentId, options = {}) {
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) throw new AppError(404, "NOT_FOUND", "Appointment was not found.");
  const job = await EmailNotificationOutbox.findOneAndUpdate(
    {
      appointmentId: appointment._id,
      notificationType: NOTIFICATION_TYPE,
      status: { $in: ["failed", "dead_letter"] },
      sentAt: { $exists: false }
    },
    {
      $set: { status: "queued", attemptCount: 0, nextRetryAt: new Date() },
      $unset: {
        lockedAt: "", lockExpiresAt: "", lastAttemptAt: "", failedAt: "",
        failureCode: "", failureMessageSafe: "", providerMessageId: ""
      }
    },
    { new: true }
  );
  if (!job) {
    const existing = await EmailNotificationOutbox.findOne({
      appointmentId: appointment._id,
      notificationType: NOTIFICATION_TYPE
    }).select("status");
    if (existing?.status === "sent") {
      throw new AppError(409, "EMAIL_ALREADY_SENT", "The owner email has already been sent.");
    }
    throw new AppError(409, "EMAIL_RETRY_NOT_AVAILABLE", "The owner email is not available for retry.");
  }
  await audit({
    actorType: "staff",
    actorStaff: options.staffUser?._id,
    action: "appointment.owner_email_retry_requested",
    entityType: "appointment",
    entityId: appointment.appointmentId,
    req: options.req
  });
  kickOwnerEmailWorker(job._id);
  return publicOwnerEmailStatus(job);
}

function startOwnerEmailScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  scheduler = setInterval(() => {
    processOwnerEmailJobs().catch((error) => {
      console.warn("Owner email scheduler failed", { code: "EMAIL_WORKER_FAILURE", message: error.name });
    });
  }, 30_000);
  scheduler.unref?.();
  processOwnerEmailJobs().catch((error) => {
    console.warn("Owner email recovery failed", { code: "EMAIL_WORKER_FAILURE", message: error.name });
  });
}

function stopOwnerEmailSchedulerForTests() {
  if (scheduler) clearInterval(scheduler);
  scheduler = undefined;
  schedulerStarted = false;
}

module.exports = {
  NOTIFICATION_TYPE,
  RETRY_DELAYS_MS,
  enqueueOwnerAppointmentEmail,
  processOwnerEmailJobs,
  attachOwnerEmailStatuses,
  publicOwnerEmailStatus,
  retryOwnerAppointmentEmail,
  kickOwnerEmailWorker,
  startOwnerEmailScheduler,
  stopOwnerEmailSchedulerForTests
};
