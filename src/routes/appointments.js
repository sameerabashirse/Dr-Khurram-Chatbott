const express = require("express");
const { z } = require("zod");
const {
  createAppointment,
  lookupAppointment,
  listAppointments,
  getAppointmentById,
  rescheduleAppointment,
  cancelAppointment,
  updateAppointmentStatus,
  safePublicAppointment
} = require("../services/appointmentService");
const { requireAuth } = require("../middleware/auth");
const { publicFormLimiter } = require("../middleware/security");
const { asyncHandler } = require("../utils/asyncHandler");
const { badRequest } = require("../utils/errors");

const router = express.Router();

function validate(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw badRequest("Validation failed", parsed.error.flatten());
  return parsed.data;
}

const appointmentSchema = z.object({
  fullName: z.string().min(2).max(160),
  phone: z.string().min(7).max(40),
  age: z.coerce.number().int().min(0).max(130),
  gender: z.enum(["female", "male", "other", "not_provided"]).optional(),
  preferredLanguage: z.string().max(30).optional(),
  reason: z.string().min(2).max(1000),
  optionalNote: z.string().max(1000).optional().or(z.literal("")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().min(4).max(20),
  consentGiven: z.boolean()
});

router.post("/", publicFormLimiter, asyncHandler(async (req, res) => {
  const input = validate(appointmentSchema, req.body);
  const appointment = await createAppointment(input, { source: "website", req });
  res.status(201).json({ success: true, appointment: safePublicAppointment(appointment) });
}));

router.post("/lookup", publicFormLimiter, asyncHandler(async (req, res) => {
  const input = validate(z.object({
    appointmentId: z.string().regex(/^KHR-\d{4}-\d{6}$/i),
    phone: z.string().min(7).max(40)
  }), req.body);
  const appointment = await lookupAppointment(input);
  res.json({ success: true, appointment: safePublicAppointment(appointment) });
}));

router.post("/reschedule", publicFormLimiter, asyncHandler(async (req, res) => {
  const input = validate(z.object({
    appointmentId: z.string().regex(/^KHR-\d{4}-\d{6}$/i),
    phone: z.string().min(7).max(40),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().min(4).max(20),
    reason: z.string().max(1000).optional()
  }), req.body);
  const appointment = await rescheduleAppointment(input, { req });
  res.json({ success: true, appointment: safePublicAppointment(appointment) });
}));

router.post("/cancel", publicFormLimiter, asyncHandler(async (req, res) => {
  const input = validate(z.object({
    appointmentId: z.string().regex(/^KHR-\d{4}-\d{6}$/i),
    phone: z.string().min(7).max(40),
    reason: z.string().max(1000).optional()
  }), req.body);
  const appointment = await cancelAppointment(input, { req });
  res.json({ success: true, appointment: safePublicAppointment(appointment) });
}));

router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const appointments = await listAppointments(req.query);
  res.json({ success: true, appointments });
}));

router.post("/manual", requireAuth, asyncHandler(async (req, res) => {
  const input = validate(appointmentSchema.extend({ consentGiven: z.boolean().optional() }), req.body);
  const appointment = await createAppointment({ ...input, consentGiven: true }, { source: "staff", staffUser: req.user, req });
  res.status(201).json({ success: true, appointment });
}));

router.get("/:id", requireAuth, asyncHandler(async (req, res) => {
  res.json({ success: true, appointment: await getAppointmentById(req.params.id) });
}));

router.post("/:appointmentId/reschedule", requireAuth, asyncHandler(async (req, res) => {
  const input = validate(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().min(4).max(20),
    reason: z.string().max(1000).optional()
  }), req.body);
  const appointment = await rescheduleAppointment({ appointmentId: req.params.appointmentId, ...input }, { staffUser: req.user, req });
  res.json({ success: true, appointment });
}));

router.post("/:appointmentId/cancel", requireAuth, asyncHandler(async (req, res) => {
  const input = validate(z.object({ reason: z.string().max(1000).optional() }), req.body);
  const appointment = await cancelAppointment({ appointmentId: req.params.appointmentId, ...input }, { staffUser: req.user, req });
  res.json({ success: true, appointment });
}));

router.patch("/:id/status", requireAuth, asyncHandler(async (req, res) => {
  const input = validate(z.object({
    status: z.enum(["scheduled", "rescheduled", "cancelled", "visited", "no_show"])
  }), req.body);
  const appointment = await updateAppointmentStatus(req.params.id, input.status, { staffUser: req.user, req });
  res.json({ success: true, appointment });
}));

module.exports = router;
