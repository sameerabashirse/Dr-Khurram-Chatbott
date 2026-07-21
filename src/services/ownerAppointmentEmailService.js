const { DateTime } = require("luxon");
const { config } = require("../config/env");
const { getClinicSettings, getDoctorProfile } = require("./settingsService");
const { EmailDeliveryError, sendEmail } = require("./emailTransport");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requiredText(value) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized === "undefined" || normalized === "null" || normalized === "[object Object]") {
    throw new EmailDeliveryError("EMAIL_PERMANENT_FAILURE");
  }
  return normalized;
}

function bookingSourceLabel(source) {
  return {
    whatsapp: "WhatsApp Chatbot",
    website: "Website",
    staff: "Staff Panel"
  }[source] || "Appointment System";
}

function formatAppointmentDate(date, timezone) {
  const value = DateTime.fromISO(requiredText(date), { zone: timezone || config.clinicTimezone });
  if (!value.isValid) throw new EmailDeliveryError("EMAIL_PERMANENT_FAILURE");
  return value.toFormat("d LLLL yyyy");
}

function formatAppointmentTime(date, time, timezone) {
  const value = DateTime.fromISO(`${requiredText(date)}T${requiredText(time)}`, {
    zone: timezone || config.clinicTimezone
  });
  if (!value.isValid) throw new EmailDeliveryError("EMAIL_PERMANENT_FAILURE");
  return value.toFormat("h:mm a");
}

function buildOwnerAppointmentEmail({ appointment, doctorName, clinicName, receptionContact, timezone }) {
  const patientName = requiredText(appointment?.patientSnapshot?.fullName);
  const date = formatAppointmentDate(appointment?.date, timezone);
  const time = formatAppointmentTime(appointment?.date, appointment?.time, timezone);
  const values = {
    Patient: patientName,
    Doctor: requiredText(doctorName),
    Clinic: requiredText(clinicName),
    Date: date,
    Time: time,
    "Queue Number": requiredText(appointment?.tokenNumber),
    "Booking Reference": requiredText(appointment?.appointmentId),
    "Booking Source": bookingSourceLabel(appointment?.source),
    "Reception Contact": requiredText(receptionContact)
  };
  const adminPanelUrl = requiredText(config.adminPanelUrl);
  let parsedAdminUrl;
  try {
    parsedAdminUrl = new URL(adminPanelUrl);
  } catch {
    throw new EmailDeliveryError("EMAIL_CONFIGURATION_MISSING");
  }
  if (parsedAdminUrl.protocol !== "https:") {
    throw new EmailDeliveryError("EMAIL_CONFIGURATION_MISSING");
  }

  const subject = `New Appointment Booked — ${patientName} — ${date}`;
  const detailText = Object.entries(values).map(([label, value]) => `${label}: ${value}`).join("\n");
  const text = `New Appointment Confirmed\n\nA new appointment has been booked successfully.\n\n${detailText}\n\nOpen the admin panel to review the appointment:\n${adminPanelUrl}\n\nThis is an automated clinic notification.`;
  const rows = Object.entries(values).map(([label, value]) => `
    <tr>
      <th style="padding:8px 10px;text-align:left;color:#44546a;font-size:14px;vertical-align:top;width:42%;">${escapeHtml(label)}</th>
      <td style="padding:8px 10px;color:#17202a;font-size:14px;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`).join("");
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;background:#f3f6f8;color:#17202a;font-family:Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">A new appointment has been confirmed.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f8;padding:20px 10px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dce3e8;border-radius:8px;">
        <tr><td style="padding:24px 24px 8px;text-align:center;">
          <div style="font-size:18px;font-weight:bold;color:#174c5b;">${escapeHtml(clinicName)}</div>
          <h1 style="margin:10px 0 8px;font-size:24px;color:#17202a;">New Appointment Confirmed</h1>
          <p style="margin:0;color:#52616b;font-size:15px;">A new appointment has been booked successfully.</p>
        </td></tr>
        <tr><td style="padding:18px 24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dce3e8;border-radius:6px;">${rows}
          </table>
        </td></tr>
        <tr><td align="center" style="padding:4px 24px 24px;">
          <a href="${escapeHtml(adminPanelUrl)}" style="display:inline-block;background:#176b78;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:5px;font-weight:bold;">Open Admin Panel</a>
          <p style="margin:22px 0 0;color:#667781;font-size:12px;">This is an automated clinic notification.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

async function sendOwnerAppointmentEmail({ appointment, outbox }) {
  const [doctor, clinic] = await Promise.all([getDoctorProfile(), getClinicSettings()]);
  const content = buildOwnerAppointmentEmail({
    appointment,
    doctorName: doctor.doctorName,
    clinicName: config.emailAppointmentAlert.fromName,
    receptionContact: clinic.contactNumber || config.clinicContactNumber,
    timezone: clinic.timezone || config.clinicTimezone
  });
  return sendEmail({
    to: outbox.recipient,
    ...content,
    messageKey: `owner-appointment-${appointment._id}`
  });
}

module.exports = {
  bookingSourceLabel,
  buildOwnerAppointmentEmail,
  sendOwnerAppointmentEmail
};
