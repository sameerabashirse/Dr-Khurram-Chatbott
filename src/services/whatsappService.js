const crypto = require("crypto");
const { config } = require("../config/env");
const {
  ConversationSession,
  MessageDeliveryStatus,
  WhatsAppMessage
} = require("../models");
const { normalizePhone } = require("../utils/security");

function isWhatsAppConfigured() {
  return Boolean(config.whatsapp.accessToken && config.whatsapp.phoneNumberId);
}

function verifyMetaSignature(rawBody, signatureHeader) {
  if (!config.whatsapp.metaAppSecret) return !config.isProduction;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto
    .createHmac("sha256", config.whatsapp.metaAppSecret)
    .update(rawBody || Buffer.from(""))
    .digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

function graphUrl(path) {
  return `https://graph.facebook.com/${config.whatsapp.graphVersion}/${path}`;
}

async function createOutgoingLog({ to, body, type = "text", payload, status = "queued", metaMessageId, error }) {
  const session = await ConversationSession.findOneAndUpdate(
    { phoneE164: normalizePhone(to) },
    { $setOnInsert: { phoneE164: normalizePhone(to) }, $set: { lastMessageAt: new Date() } },
    { upsert: true, new: true }
  );
  return WhatsAppMessage.create({
    metaMessageId,
    direction: "outgoing",
    phoneE164: normalizePhone(to),
    conversation: session._id,
    messageType: type,
    body,
    status,
    payload,
    error
  });
}

async function sendWhatsAppRequest(payload, to, bodyForLog) {
  if (!isWhatsAppConfigured()) {
    await createOutgoingLog({
      to,
      body: bodyForLog,
      type: payload.type,
      payload,
      status: "failed",
      error: "WhatsApp Cloud API is not configured"
    });
    return { configured: false, status: "not_configured" };
  }

  const response = await fetch(graphUrl(`${config.whatsapp.phoneNumberId}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await createOutgoingLog({
      to,
      body: bodyForLog,
      type: payload.type,
      payload,
      status: "failed",
      error: data?.error?.message || `Meta API returned ${response.status}`
    });
    return { configured: true, status: "failed", error: data?.error?.message };
  }

  const metaMessageId = data?.messages?.[0]?.id;
  await createOutgoingLog({
    to,
    body: bodyForLog,
    type: payload.type,
    payload,
    status: "sent_to_meta",
    metaMessageId
  });
  return { configured: true, status: "sent_to_meta", metaMessageId, raw: data };
}

async function sendText(to, body) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizePhone(to).replace("+", ""),
    type: "text",
    text: { preview_url: false, body }
  };
  return sendWhatsAppRequest(payload, to, body);
}

async function sendTemplate(to, templateName, languageCode, parameters = []) {
  if (!templateName) {
    return { configured: false, status: "not_configured" };
  }

  const payload = {
    messaging_product: "whatsapp",
    to: normalizePhone(to).replace("+", ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode || "en" },
      components: parameters.length
        ? [{
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text: String(text) }))
        }]
        : []
    }
  };
  return sendWhatsAppRequest(payload, to, `Template: ${templateName}`);
}

async function logIncomingMessage({ metaMessageId, phoneE164, body, messageType, payload }) {
  const session = await ConversationSession.findOneAndUpdate(
    { phoneE164 },
    { $setOnInsert: { phoneE164 }, $set: { lastMessageAt: new Date() } },
    { upsert: true, new: true }
  );

  try {
    const message = await WhatsAppMessage.create({
      metaMessageId,
      direction: "incoming",
      phoneE164,
      conversation: session._id,
      messageType,
      body,
      status: "received",
      payload,
      serviceWindowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    return { duplicate: false, message, session };
  } catch (error) {
    if (error.code === 11000) return { duplicate: true, session };
    throw error;
  }
}

async function updateDeliveryStatus(status) {
  const phoneE164 = normalizePhone(status.recipient_id || status.phone_number || "");
  const timestamp = status.timestamp
    ? new Date(Number(status.timestamp) * 1000)
    : new Date();
  await MessageDeliveryStatus.create({
    metaMessageId: status.id,
    phoneE164,
    status: status.status,
    timestamp,
    payload: status
  });
  await WhatsAppMessage.updateOne(
    { metaMessageId: status.id },
    {
      $set: {
        status: status.status === "sent" ? "sent_to_meta" : status.status,
        error: status.errors?.[0]?.title || status.errors?.[0]?.message
      }
    }
  );
}

function extractWebhookMessages(body) {
  const changes = body?.entry?.flatMap((entry) => entry.changes || []) || [];
  const messages = [];
  const statuses = [];

  for (const change of changes) {
    const value = change.value || {};
    if (Array.isArray(value.statuses)) statuses.push(...value.statuses);
    if (!Array.isArray(value.messages)) continue;
    for (const message of value.messages) {
      const phone = normalizePhone(message.from);
      const text = message.text?.body
        || message.button?.text
        || message.interactive?.button_reply?.title
        || message.interactive?.list_reply?.title
        || "";
      messages.push({
        metaMessageId: message.id,
        phoneE164: phone,
        type: message.type,
        body: text,
        payload: message
      });
    }
  }

  return { messages, statuses };
}

module.exports = {
  isWhatsAppConfigured,
  verifyMetaSignature,
  sendText,
  sendTemplate,
  logIncomingMessage,
  updateDeliveryStatus,
  extractWebhookMessages
};
