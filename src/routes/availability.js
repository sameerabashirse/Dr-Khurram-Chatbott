const express = require("express");
const { z } = require("zod");
const {
  getAvailableSlots,
  getAvailableDates,
  blockDate,
  unblockDate,
  blockSlot,
  unblockSlot
} = require("../services/availabilityService");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const { badRequest } = require("../utils/errors");

const router = express.Router();

function validate(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw badRequest("Validation failed", parsed.error.flatten());
  return parsed.data;
}

router.get("/dates", asyncHandler(async (req, res) => {
  res.json({ success: true, dates: await getAvailableDates(req.query.days) });
}));

router.get("/slots", asyncHandler(async (req, res) => {
  if (!req.query.date) throw badRequest("date query parameter is required.");
  res.json({ success: true, slots: await getAvailableSlots(req.query.date) });
}));

router.post("/block-date", requireAuth, asyncHandler(async (req, res) => {
  const input = validate(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().max(500).optional()
  }), req.body);
  const blockedDate = await blockDate({ ...input, staffUser: req.user });
  res.status(201).json({ success: true, blockedDate });
}));

router.post("/unblock-date", requireAuth, asyncHandler(async (req, res) => {
  const input = validate(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.body);
  const blockedDate = await unblockDate(input.date);
  res.json({ success: true, blockedDate });
}));

router.post("/block-slot", requireAuth, asyncHandler(async (req, res) => {
  const input = validate(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    reason: z.string().max(500).optional()
  }), req.body);
  const blockedSlot = await blockSlot({ ...input, staffUser: req.user });
  res.status(201).json({ success: true, blockedSlot });
}));

router.post("/unblock-slot", requireAuth, asyncHandler(async (req, res) => {
  const input = validate(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/)
  }), req.body);
  const blockedSlot = await unblockSlot(input.date, input.time);
  res.json({ success: true, blockedSlot });
}));

module.exports = router;
