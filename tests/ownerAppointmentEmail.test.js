const test = require("node:test");
const assert = require("node:assert/strict");
const { config, readBoolean } = require("../src/config/env");
const {
  EmailDeliveryError,
  normalizeEmail,
  maskEmail,
  validateEmailConfiguration,
  classifyTransportError,
  sendEmail,
  setTransportForTests,
  resetTransportForTests
} = require("../src/services/emailTransport");
const {
  buildOwnerAppointmentEmail,
  bookingSourceLabel
} = require("../src/services/ownerAppointmentEmailService");
const { publicOwnerEmailStatus } = require("../src/services/ownerEmailOutboxService");

const appointment = {
  _id: "507f1f77bcf86cd799439011",
  appointmentId: "NMC-250725-0010",
  tokenNumber: "10",
  patientSnapshot: { fullName: "Ayesha Khan" },
  date: "2026-07-25",
  time: "10:30",
  source: "whatsapp",
  reason: "Sensitive medical reason",
  optionalNote: "Private clinical note"
};

function emailInput() {
  return {
    appointment,
    doctorName: "Dr. Khurrum Mansoor",
    clinicName: "Nighat Medical Complex",
    receptionContact: "+92 324 4754566",
    timezone: "Asia/Karachi"
  };
}

test("strict boolean parsing treats only true as enabled", () => {
  const original = process.env.TEST_EMAIL_BOOLEAN;
  process.env.TEST_EMAIL_BOOLEAN = "false";
  assert.equal(readBoolean("TEST_EMAIL_BOOLEAN", true), false);
  process.env.TEST_EMAIL_BOOLEAN = "TRUE";
  assert.equal(readBoolean("TEST_EMAIL_BOOLEAN", false), true);
  process.env.TEST_EMAIL_BOOLEAN = "1";
  assert.equal(readBoolean("TEST_EMAIL_BOOLEAN", true), false);
  if (original === undefined) delete process.env.TEST_EMAIL_BOOLEAN;
  else process.env.TEST_EMAIL_BOOLEAN = original;
});

test("owner email includes every approved appointment field in HTML and text", async (t) => {
  await t.test("subject, patient, doctor, clinic, date, time, queue, reference and source", () => {
    const result = buildOwnerAppointmentEmail(emailInput());
    assert.equal(result.subject, "New Appointment Booked — Ayesha Khan — 25 July 2026");
    for (const expected of [
      "Ayesha Khan", "Dr. Khurrum Mansoor", "Nighat Medical Complex", "25 July 2026",
      "10:30 AM", "10", "NMC-250725-0010", "WhatsApp Chatbot", "+92 324 4754566"
    ]) {
      assert.match(result.text, new RegExp(expected.replace(/[+]/g, "\\+")));
      assert.match(result.html, new RegExp(expected.replace(/[+]/g, "\\+")));
    }
    assert.match(result.html, /Open Admin Panel/);
    assert.match(result.text, /https:\/\/admin\.nighatmedicalcomplex\.com/);
  });

  await t.test("medical reason, note, phone, Mongo ID and tokens are excluded", () => {
    const result = buildOwnerAppointmentEmail(emailInput());
    const combined = `${result.subject}\n${result.text}\n${result.html}`;
    for (const excluded of [
      appointment.reason, appointment.optionalNote, String(appointment._id), "authentication token", "patient phone"
    ]) {
      assert.equal(combined.includes(excluded), false);
    }
  });

  await t.test("dynamic values are HTML escaped and invalid required values are rejected", () => {
    const safe = buildOwnerAppointmentEmail({
      ...emailInput(),
      appointment: { ...appointment, patientSnapshot: { fullName: "<Ayesha & Co>" } }
    });
    assert.match(safe.html, /&lt;Ayesha &amp; Co&gt;/);
    assert.throws(
      () => buildOwnerAppointmentEmail({ ...emailInput(), doctorName: undefined }),
      (error) => error.code === "EMAIL_PERMANENT_FAILURE"
    );
  });
});

test("booking sources have safe human-readable labels", () => {
  assert.equal(bookingSourceLabel("whatsapp"), "WhatsApp Chatbot");
  assert.equal(bookingSourceLabel("website"), "Website");
  assert.equal(bookingSourceLabel("staff"), "Staff Panel");
  assert.equal(bookingSourceLabel("unknown"), "Appointment System");
});

test("email addresses are normalized, validated and masked safely", () => {
  assert.equal(normalizeEmail(" Owner@Example.COM "), "owner@example.com");
  assert.equal(normalizeEmail("not-an-email"), "");
  assert.equal(maskEmail("owner@example.com"), "ow***@example.com");
  assert.equal(maskEmail("bad"), "invalid-email");
});

test("configuration failures use safe permanent error codes", async (t) => {
  const original = structuredClone(config.emailAppointmentAlert);
  t.after(() => {
    Object.assign(config.emailAppointmentAlert, original);
    config.emailAppointmentAlert.smtp = original.smtp;
    resetTransportForTests();
  });

  config.emailAppointmentAlert.enabled = false;
  assert.throws(validateEmailConfiguration, (error) => error.code === "EMAIL_FEATURE_DISABLED");

  config.emailAppointmentAlert.enabled = true;
  config.emailAppointmentAlert.to = "";
  assert.throws(validateEmailConfiguration, (error) => error.code === "EMAIL_RECIPIENT_INVALID");

  config.emailAppointmentAlert.to = "invalid";
  assert.throws(validateEmailConfiguration, (error) => error.code === "EMAIL_RECIPIENT_INVALID");

  config.emailAppointmentAlert.to = "owner@example.com";
  config.emailAppointmentAlert.fromAddress = "";
  assert.throws(validateEmailConfiguration, (error) => error.code === "EMAIL_CONFIGURATION_MISSING");
});

test("SMTP transport receives both body formats and a stable message key", async (t) => {
  const original = structuredClone(config.emailAppointmentAlert);
  t.after(() => {
    Object.assign(config.emailAppointmentAlert, original);
    config.emailAppointmentAlert.smtp = original.smtp;
    resetTransportForTests();
  });
  Object.assign(config.emailAppointmentAlert, {
    enabled: true,
    to: "owner@example.com",
    fromName: "Nighat Medical Complex",
    fromAddress: "alerts@example.com",
    provider: "smtp",
    smtp: { host: "smtp.example.com", port: 587, secure: false, user: "user", password: "secret" }
  });
  let sent;
  setTransportForTests({ sendMail: async (value) => { sent = value; return { messageId: "provider-id" }; } });
  const result = await sendEmail({
    to: "owner@example.com",
    subject: "Subject",
    html: "<p>HTML</p>",
    text: "Text",
    messageKey: "owner-appointment-123"
  });
  assert.equal(result.messageId, "provider-id");
  assert.equal(sent.text, "Text");
  assert.equal(sent.html, "<p>HTML</p>");
  assert.equal(sent.messageId, "<owner-appointment-123@example.com>");
  assert.equal(sent.auth, undefined);
});

test("SMTP errors are classified into bounded retry categories", () => {
  assert.equal(classifyTransportError({ code: "ETIMEDOUT" }).code, "EMAIL_TEMPORARY_FAILURE");
  assert.equal(classifyTransportError({ responseCode: 450 }).temporary, true);
  assert.equal(classifyTransportError({ responseCode: 550 }).code, "EMAIL_PERMANENT_FAILURE");
  const safe = new EmailDeliveryError("EMAIL_CONFIGURATION_MISSING");
  assert.equal(classifyTransportError(safe), safe);
});

test("admin status exposes only queued, sent, failed and retry eligibility", () => {
  assert.deepEqual(publicOwnerEmailStatus({ status: "queued" }), { status: "queued", label: "Queued", canRetry: false });
  assert.deepEqual(publicOwnerEmailStatus({ status: "sending" }), { status: "queued", label: "Queued", canRetry: false });
  assert.deepEqual(publicOwnerEmailStatus({ status: "sent" }), { status: "sent", label: "Sent", canRetry: false });
  assert.deepEqual(publicOwnerEmailStatus({ status: "failed" }), { status: "failed", label: "Failed", canRetry: true });
  assert.deepEqual(publicOwnerEmailStatus({ status: "dead_letter" }), { status: "failed", label: "Failed", canRetry: true });
});
