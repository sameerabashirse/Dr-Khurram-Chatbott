const crypto = require("crypto");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function maskPhone(phone = "") {
  const cleaned = String(phone).replace(/[^\d+]/g, "");
  if (cleaned.length <= 6) return "***";
  return `${cleaned.slice(0, 4)}****${cleaned.slice(-3)}`;
}

function normalizePhone(input) {
  let value = String(input || "").trim();
  value = value.replace(/[^\d+]/g, "");
  if (!value) return "";
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (value.startsWith("0")) value = `+92${value.slice(1)}`;
  if (!value.startsWith("+")) value = `+${value}`;
  return value;
}

function safePublicAppointment(appointment) {
  return {
    appointmentId: appointment.appointmentId,
    tokenNumber: appointment.tokenNumber,
    patientName: appointment.patientSnapshot.fullName,
    phoneMasked: appointment.patientSnapshot.phoneMasked,
    date: appointment.date,
    time: appointment.time,
    status: appointment.status,
    reminderStatus: appointment.reminderStatus,
    confirmationMessageStatus: appointment.confirmationMessageStatus,
    clinicContactNumber: "+92 335 7504478"
  };
}

module.exports = { sha256, randomToken, maskPhone, normalizePhone, safePublicAppointment };
