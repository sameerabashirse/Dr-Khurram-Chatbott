const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { config } = require("../src/config/env");
const {
  Appointment,
  EmailNotificationOutbox,
  Patient,
  PatientConsent,
  ReminderJob,
  AuditLog
} = require("../src/models");
const { EmailDeliveryError, setTransportForTests, resetTransportForTests } = require("../src/services/emailTransport");
const {
  enqueueOwnerAppointmentEmail,
  processOwnerEmailJobs,
  retryOwnerAppointmentEmail,
  NOTIFICATION_TYPE
} = require("../src/services/ownerEmailOutboxService");
const { createAppointment, listAppointments } = require("../src/services/appointmentService");

let replSet;
let sequence = 0;
const originalEmailConfig = structuredClone(config.emailAppointmentAlert);

function appointmentData(overrides = {}) {
  sequence += 1;
  return {
    appointmentId: `NMC-TEST-${String(sequence).padStart(4, "0")}`,
    tokenNumber: String(sequence).padStart(3, "0"),
    patient: new mongoose.Types.ObjectId(),
    patientSnapshot: {
      fullName: `Patient ${sequence}`,
      phoneMasked: "+92*******566",
      preferredLanguage: "en"
    },
    phoneE164: `+92324000${String(sequence).padStart(4, "0")}`,
    reason: "Sensitive reason that must never enter the outbox",
    date: "2030-07-15",
    time: "10:30",
    status: "scheduled",
    source: "whatsapp",
    ...overrides
  };
}

async function createAppointmentAndOutbox(overrides = {}) {
  let appointment;
  let outbox;
  await mongoose.connection.transaction(async (session) => {
    [appointment] = await Appointment.create([appointmentData(overrides)], { session });
    outbox = await enqueueOwnerAppointmentEmail(appointment, { session });
  });
  return { appointment, outbox };
}

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri(), { dbName: "owner-email-alert-test" });
  await Promise.all([Appointment.syncIndexes(), EmailNotificationOutbox.syncIndexes()]);
  Object.assign(config.emailAppointmentAlert, {
    enabled: true,
    to: "owner@example.com",
    fromName: "Nighat Medical Complex",
    fromAddress: "alerts@example.com",
    provider: "smtp",
    smtp: { host: "smtp.example.com", port: 587, secure: false, user: "user", password: "test-password" }
  });
});

test.after(async () => {
  resetTransportForTests();
  Object.assign(config.emailAppointmentAlert, originalEmailConfig);
  config.emailAppointmentAlert.smtp = originalEmailConfig.smtp;
  await mongoose.disconnect();
  await replSet?.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Appointment.deleteMany({}),
    EmailNotificationOutbox.deleteMany({}),
    Patient.deleteMany({}),
    PatientConsent.deleteMany({}),
    ReminderJob.deleteMany({}),
    AuditLog.deleteMany({})
  ]);
});

test("real confirmed booking hook queues one alert and appears in the admin list", async () => {
  setTransportForTests({ sendMail: async () => ({ messageId: "hook-delivery" }) });
  const input = {
    fullName: "Hook Test Patient",
    phone: "+923241112233",
    age: 30,
    gender: "not_provided",
    preferredLanguage: "en",
    reason: "Private reason",
    optionalNote: "",
    date: "2030-07-15",
    time: "11:00",
    consentGiven: true
  };
  const appointment = await createAppointment(input, {
    source: "website",
    skipWhatsAppTemplate: true
  });
  assert.equal(appointment.status, "scheduled");
  assert.equal(await Appointment.countDocuments(), 1);
  assert.equal(await EmailNotificationOutbox.countDocuments({ appointmentId: appointment._id }), 1);
  const listed = await listAppointments({ search: appointment.appointmentId });
  assert.equal(listed.length, 1);
  assert.ok(["queued", "sent"].includes(listed[0].ownerEmailNotification.status));

  await assert.rejects(
    createAppointment(input, { source: "website", skipWhatsAppTemplate: true })
  );
  assert.equal(await Appointment.countDocuments(), 1);
  assert.equal(await EmailNotificationOutbox.countDocuments(), 1);
});

test("confirmed appointment transaction durably creates exactly one queued owner alert", async () => {
  const { appointment, outbox } = await createAppointmentAndOutbox();
  assert.equal(appointment.status, "scheduled");
  assert.equal(outbox.status, "queued");
  assert.equal(await Appointment.countDocuments(), 1);
  assert.equal(await EmailNotificationOutbox.countDocuments(), 1);
  const stored = await EmailNotificationOutbox.findOne().lean();
  assert.equal(stored.notificationType, NOTIFICATION_TYPE);
  assert.equal(stored.channel, "email");
  assert.equal(JSON.stringify(stored).includes("Sensitive reason"), false);
});

test("failed or incomplete transaction creates neither appointment nor email alert", async () => {
  await assert.rejects(
    mongoose.connection.transaction(async (session) => {
      const [appointment] = await Appointment.create([appointmentData()], { session });
      await enqueueOwnerAppointmentEmail(appointment, { session });
      throw new Error("simulated appointment failure");
    })
  );
  assert.equal(await Appointment.countDocuments(), 0);
  assert.equal(await EmailNotificationOutbox.countDocuments(), 0);

  await assert.rejects(Appointment.create(appointmentData({ patientSnapshot: { phoneMasked: "masked" } })));
  assert.equal(await EmailNotificationOutbox.countDocuments(), 0);
});

test("disabled feature creates no outbox and sends no email", async () => {
  config.emailAppointmentAlert.enabled = false;
  let sendCount = 0;
  try {
    const appointment = await Appointment.create(appointmentData());
    const outbox = await enqueueOwnerAppointmentEmail(appointment);
    await processOwnerEmailJobs({ send: async () => { sendCount += 1; } });
    assert.equal(outbox, null);
    assert.equal(sendCount, 0);
    assert.equal(await EmailNotificationOutbox.countDocuments(), 0);
  } finally {
    config.emailAppointmentAlert.enabled = true;
  }
});

test("duplicate confirmation, refresh and network retry cannot duplicate a sent email", async () => {
  const { appointment } = await createAppointmentAndOutbox();
  await enqueueOwnerAppointmentEmail(appointment);
  await enqueueOwnerAppointmentEmail(appointment);
  assert.equal(await EmailNotificationOutbox.countDocuments(), 1);

  let sendCount = 0;
  const send = async () => {
    sendCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { messageId: "provider-message-1" };
  };
  await Promise.all([
    processOwnerEmailJobs({ send }),
    processOwnerEmailJobs({ send })
  ]);
  await processOwnerEmailJobs({ send });
  assert.equal(sendCount, 1);
  assert.equal((await EmailNotificationOutbox.findOne()).status, "sent");
});

test("temporary SMTP failure keeps appointment confirmed and schedules a safe retry", async () => {
  const { appointment } = await createAppointmentAndOutbox();
  const temporaryFailure = async () => {
    throw new EmailDeliveryError("EMAIL_TEMPORARY_FAILURE", true);
  };
  await processOwnerEmailJobs({ send: temporaryFailure });
  const failedAttempt = await EmailNotificationOutbox.findOne();
  assert.equal(failedAttempt.status, "queued");
  assert.equal(failedAttempt.attemptCount, 1);
  assert.ok(failedAttempt.nextRetryAt > failedAttempt.lastAttemptAt);
  assert.equal((await Appointment.findById(appointment._id)).status, "scheduled");

  failedAttempt.nextRetryAt = new Date(Date.now() - 1000);
  await failedAttempt.save();
  await processOwnerEmailJobs({ send: async () => ({ messageId: "retry-success" }) });
  assert.equal((await EmailNotificationOutbox.findById(failedAttempt._id)).status, "sent");
  assert.equal(await Appointment.countDocuments(), 1);
});

test("temporary failures stop after five attempts and do not retry forever", async () => {
  await createAppointmentAndOutbox();
  const temporaryFailure = async () => {
    throw new EmailDeliveryError("EMAIL_TEMPORARY_FAILURE", true);
  };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await EmailNotificationOutbox.updateOne({}, { $set: { nextRetryAt: new Date(Date.now() - 1000) } });
    await processOwnerEmailJobs({ send: temporaryFailure });
  }
  const job = await EmailNotificationOutbox.findOne();
  assert.equal(job.status, "dead_letter");
  assert.equal(job.attemptCount, 5);
  await processOwnerEmailJobs({ send: temporaryFailure });
  assert.equal((await EmailNotificationOutbox.findOne()).attemptCount, 5);
});

test("permanent failure is not automatically retried", async () => {
  await createAppointmentAndOutbox();
  let sendCount = 0;
  const permanentFailure = async () => {
    sendCount += 1;
    throw new EmailDeliveryError("EMAIL_PERMANENT_FAILURE", false);
  };
  await processOwnerEmailJobs({ send: permanentFailure });
  await processOwnerEmailJobs({ send: permanentFailure });
  const job = await EmailNotificationOutbox.findOne();
  assert.equal(job.status, "failed");
  assert.equal(sendCount, 1);
});

test("server restart recovers a stale sending lock", async () => {
  const { outbox } = await createAppointmentAndOutbox();
  await EmailNotificationOutbox.updateOne(
    { _id: outbox._id },
    {
      $set: {
        status: "sending",
        lockedAt: new Date(Date.now() - 180_000),
        lockExpiresAt: new Date(Date.now() - 60_000),
        attemptCount: 1
      }
    }
  );
  let sends = 0;
  await processOwnerEmailJobs({ send: async () => { sends += 1; return { messageId: "recovered" }; } });
  assert.equal(sends, 1);
  assert.equal((await EmailNotificationOutbox.findById(outbox._id)).status, "sent");
});

test("manual retry reuses the outbox, never recreates appointment, and refuses a sent email", async () => {
  const { appointment, outbox } = await createAppointmentAndOutbox();
  await EmailNotificationOutbox.updateOne(
    { _id: outbox._id },
    { $set: { status: "failed", attemptCount: 1, failureCode: "EMAIL_PERMANENT_FAILURE" } }
  );
  let sendCount = 0;
  setTransportForTests({ sendMail: async () => { sendCount += 1; return { messageId: "manual-retry" }; } });
  const status = await retryOwnerAppointmentEmail(appointment._id);
  assert.equal(status.status, "queued");

  for (let index = 0; index < 30; index += 1) {
    const job = await EmailNotificationOutbox.findById(outbox._id);
    if (job.status === "sent") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(await Appointment.countDocuments(), 1);
  assert.equal(await EmailNotificationOutbox.countDocuments(), 1);
  assert.equal(sendCount, 1);
  await assert.rejects(
    retryOwnerAppointmentEmail(appointment._id),
    (error) => error.code === "EMAIL_ALREADY_SENT"
  );
});
