const express = require("express");
const { z } = require("zod");
const { config } = require("../config/env");
const {
  verifyMetaSignature,
  extractWebhookMessages,
  updateDeliveryStatus,
  logIncomingMessage,
  sendText
} = require("../services/whatsappService");
const { handleIncomingText } = require("../services/conversationService");
const { ConversationSession, WhatsAppMessage } = require("../models");
const { requireAuth } = require("../middleware/auth");
const { webhookLimiter } = require("../middleware/security");
const { asyncHandler } = require("../utils/asyncHandler");
const { badRequest, forbidden, notFound } = require("../utils/errors");
const { audit } = require("../services/auditService");
const { normalizePhone } = require("../utils/security");

const router = express.Router();

function validate(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw badRequest("Validation failed", parsed.error.flatten());
  return parsed.data;
}

router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post("/webhook", webhookLimiter, asyncHandler(async (req, res) => {
  if (!verifyMetaSignature(req.rawBody, req.get("x-hub-signature-256"))) {
    throw forbidden("Invalid Meta webhook signature.");
  }

  const { messages, statuses } = extractWebhookMessages(req.body);
  for (const status of statuses) await updateDeliveryStatus(status);

  for (const message of messages) {
    const logged = await logIncomingMessage({
      metaMessageId: message.metaMessageId,
      phoneE164: message.phoneE164,
      body: message.body,
      messageType: message.type,
      payload: message.payload
    });
    if (logged.duplicate) continue;
    if (message.body) {
      const reply = await handleIncomingText({ phoneE164: message.phoneE164, text: message.body });
      if (reply) await sendText(message.phoneE164, reply);
    }
  }

  res.json({ success: true });
}));

router.get("/conversations", requireAuth, asyncHandler(async (req, res) => {
  const conversations = await ConversationSession.find()
    .sort({ humanRequired: -1, lastMessageAt: -1 })
    .limit(200)
    .lean();
  res.json({ success: true, conversations });
}));

router.get("/conversations/:phone/messages", requireAuth, asyncHandler(async (req, res) => {
  const phoneE164 = normalizePhone(req.params.phone);
  const messages = await WhatsAppMessage.find({ phoneE164 }).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, messages });
}));

router.post("/conversations/:phone/takeover", requireAuth, asyncHandler(async (req, res) => {
  const phoneE164 = normalizePhone(req.params.phone);
  const session = await ConversationSession.findOneAndUpdate(
    { phoneE164 },
    { $set: { aiPaused: true, humanRequired: true, takenOverBy: req.user._id } },
    { new: true, upsert: true }
  );
  await audit({ actorType: "staff", actorStaff: req.user._id, action: "conversation.takeover", entityType: "conversation", entityId: session._id.toString(), req });
  res.json({ success: true, conversation: session });
}));

router.post("/conversations/:phone/release", requireAuth, asyncHandler(async (req, res) => {
  const phoneE164 = normalizePhone(req.params.phone);
  const session = await ConversationSession.findOne({ phoneE164 });
  if (!session) throw notFound("Conversation was not found.");
  session.aiPaused = false;
  session.humanRequired = false;
  session.takenOverBy = undefined;
  await session.save();
  await audit({ actorType: "staff", actorStaff: req.user._id, action: "conversation.release", entityType: "conversation", entityId: session._id.toString(), req });
  res.json({ success: true, conversation: session });
}));

router.post("/conversations/:phone/send", requireAuth, asyncHandler(async (req, res) => {
  const input = validate(z.object({ message: z.string().min(1).max(4000) }), req.body);
  const phoneE164 = normalizePhone(req.params.phone);
  const result = await sendText(phoneE164, input.message);
  await audit({ actorType: "staff", actorStaff: req.user._id, action: "conversation.staff_message_sent", entityType: "conversation", entityId: phoneE164, req });
  res.json({ success: true, result });
}));

router.get("/messages", requireAuth, asyncHandler(async (req, res) => {
  const messages = await WhatsAppMessage.find().sort({ createdAt: -1 }).limit(300).lean();
  res.json({ success: true, messages });
}));

module.exports = router;
