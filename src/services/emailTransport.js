const nodemailer = require("nodemailer");
const { z } = require("zod");
const { config } = require("../config/env");

const emailSchema = z.string().trim().email().max(320);
let transport;
let transportOverride;

class EmailDeliveryError extends Error {
  constructor(code, temporary = false) {
    super(code);
    this.name = "EmailDeliveryError";
    this.code = code;
    this.temporary = temporary;
  }
}

function normalizeEmail(value) {
  const parsed = emailSchema.safeParse(String(value || "").trim().toLowerCase());
  return parsed.success ? parsed.data : "";
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return "invalid-email";
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

function validateEmailConfiguration() {
  const email = config.emailAppointmentAlert;
  if (!email.enabled) throw new EmailDeliveryError("EMAIL_FEATURE_DISABLED");
  if (email.provider !== "smtp") throw new EmailDeliveryError("EMAIL_CONFIGURATION_MISSING");
  if (!normalizeEmail(email.to)) throw new EmailDeliveryError("EMAIL_RECIPIENT_INVALID");
  if (!normalizeEmail(email.fromAddress)) throw new EmailDeliveryError("EMAIL_CONFIGURATION_MISSING");
  if (!email.smtp.host || !email.smtp.port || !email.smtp.user || !email.smtp.password) {
    throw new EmailDeliveryError("EMAIL_CONFIGURATION_MISSING");
  }
}

function getTransport() {
  if (transportOverride) return transportOverride;
  validateEmailConfiguration();
  if (!transport) {
    const smtp = config.emailAppointmentAlert.smtp;
    transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000
    });
  }
  return transport;
}

function classifyTransportError(error) {
  if (error instanceof EmailDeliveryError) return error;
  const responseCode = Number(error?.responseCode);
  const code = String(error?.code || "").toUpperCase();
  const temporaryCodes = new Set([
    "ETIMEDOUT", "ECONNECTION", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "ESOCKET"
  ]);
  const temporary = temporaryCodes.has(code) || (responseCode >= 400 && responseCode < 500);
  return new EmailDeliveryError(
    temporary ? "EMAIL_TEMPORARY_FAILURE" : "EMAIL_PERMANENT_FAILURE",
    temporary
  );
}

async function sendEmail({ to, subject, html, text, messageKey }) {
  validateEmailConfiguration();
  const recipient = normalizeEmail(to);
  if (!recipient) throw new EmailDeliveryError("EMAIL_RECIPIENT_INVALID");
  if (!subject || !html || !text || !messageKey) {
    throw new EmailDeliveryError("EMAIL_PERMANENT_FAILURE");
  }

  const sender = config.emailAppointmentAlert;
  const messageIdDomain = normalizeEmail(sender.fromAddress).split("@")[1];
  try {
    const result = await getTransport().sendMail({
      from: { name: sender.fromName, address: normalizeEmail(sender.fromAddress) },
      to: recipient,
      subject,
      html,
      text,
      messageId: `<${String(messageKey).replace(/[^a-zA-Z0-9._-]/g, "-")}@${messageIdDomain}>`
    });
    return { messageId: result.messageId || "" };
  } catch (error) {
    throw classifyTransportError(error);
  }
}

function setTransportForTests(value) {
  transportOverride = value;
}

function resetTransportForTests() {
  transportOverride = undefined;
  transport = undefined;
}

module.exports = {
  EmailDeliveryError,
  normalizeEmail,
  maskEmail,
  validateEmailConfiguration,
  classifyTransportError,
  sendEmail,
  setTransportForTests,
  resetTransportForTests
};
