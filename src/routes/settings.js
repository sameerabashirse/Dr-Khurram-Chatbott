const express = require("express");
const { z } = require("zod");
const {
  getClinicSettings,
  updateClinicSettings,
  getDoctorProfile,
  updateDoctorProfile,
  listAuditLogs
} = require("../services/settingsService");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const { badRequest } = require("../utils/errors");

const router = express.Router();

function validate(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw badRequest("Validation failed", parsed.error.flatten());
  return parsed.data;
}

router.get("/clinic", asyncHandler(async (req, res) => {
  res.json({ success: true, clinic: await getClinicSettings() });
}));

router.put("/clinic", requireAuth, requireRole("super_admin", "admin"), asyncHandler(async (req, res) => {
  const input = validate(z.object({
    contactNumber: z.string().min(5).max(40).optional(),
    timezone: z.string().min(3).max(80).optional(),
    slotDurationMinutes: z.coerce.number().int().min(5).max(240).optional(),
    weeklyHours: z.array(z.object({
      day: z.coerce.number().int().min(1).max(7),
      isOpen: z.boolean(),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/)
    })).optional(),
    reminderIntervalsMinutes: z.array(z.coerce.number().int().min(1)).optional()
  }), req.body);
  res.json({ success: true, clinic: await updateClinicSettings(input, req.user) });
}));

router.get("/doctor-profile", asyncHandler(async (req, res) => {
  res.json({ success: true, doctorProfile: await getDoctorProfile() });
}));

router.put("/doctor-profile", requireAuth, requireRole("super_admin", "admin"), asyncHandler(async (req, res) => {
  const input = validate(z.object({
    doctorName: z.string().min(2).max(120).optional(),
    contactNumber: z.string().min(5).max(40).optional(),
    specialty: z.string().max(200).optional(),
    qualifications: z.string().max(400).optional(),
    experience: z.string().max(200).optional(),
    biography: z.string().max(2000).optional(),
    clinicLocation: z.string().max(600).optional(),
    profileImageUrl: z.string().max(500).optional()
  }), req.body);
  res.json({ success: true, doctorProfile: await updateDoctorProfile(input, req.user) });
}));

router.get("/audit-logs", requireAuth, requireRole("super_admin", "admin"), asyncHandler(async (req, res) => {
  res.json({ success: true, auditLogs: await listAuditLogs({ limit: req.query.limit }) });
}));

module.exports = router;
