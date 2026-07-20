const express = require("express");
const { z } = require("zod");
const {
  setupRequired,
  setupSuperAdmin,
  login,
  refresh,
  logout,
  publicStaffUser,
  createStaffUser,
  listStaffUsers,
  updateStaffUser
} = require("../services/authService");
const { audit } = require("../services/auditService");
const { requireAuth, requireRole } = require("../middleware/auth");
const { loginLimiters, setupLimiter, resetAccountFailedLoginLimit } = require("../middleware/security");
const { asyncHandler } = require("../utils/asyncHandler");
const { badRequest } = require("../utils/errors");

const router = express.Router();

function validate(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw badRequest("Validation failed", parsed.error.flatten());
  return parsed.data;
}

const staffSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  password: z.string().min(12).max(200),
  role: z.enum(["super_admin", "admin", "receptionist"]).optional()
});

router.get("/setup-status", asyncHandler(async (req, res) => {
  res.json({ success: true, setupRequired: await setupRequired() });
}));

router.post("/setup", setupLimiter, asyncHandler(async (req, res) => {
  const input = validate(staffSchema.omit({ role: true }), req.body);
  const user = await setupSuperAdmin(input);
  await audit({ actorType: "system", action: "staff.super_admin_setup", entityType: "staff", entityId: user._id.toString(), req });
  res.status(201).json({ success: true, user: publicStaffUser(user) });
}));

router.post("/login", ...loginLimiters, asyncHandler(async (req, res) => {
  const input = validate(z.object({
    email: z.string().email(),
    password: z.string().min(1)
  }), req.body);
  const result = await login(input, req, res);
  resetAccountFailedLoginLimit(req, res);
  await audit({ actorType: "staff", actorStaff: result.user.id, action: "staff.login", entityType: "staff", entityId: String(result.user.id), req });
  res.json({ success: true, ...result });
}));

router.post("/refresh", asyncHandler(async (req, res) => {
  const result = await refresh(req, res);
  res.json({ success: true, ...result });
}));

router.post("/logout", asyncHandler(async (req, res) => {
  await logout(req, res);
  res.json({ success: true });
}));

router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  res.json({ success: true, user: publicStaffUser(req.user) });
}));

router.get("/users", requireAuth, requireRole("super_admin"), asyncHandler(async (req, res) => {
  res.json({ success: true, users: await listStaffUsers() });
}));

router.post("/users", requireAuth, requireRole("super_admin"), asyncHandler(async (req, res) => {
  const input = validate(staffSchema, req.body);
  const user = await createStaffUser(input);
  await audit({ actorType: "staff", actorStaff: req.user._id, action: "staff.created", entityType: "staff", entityId: user._id.toString(), req });
  res.status(201).json({ success: true, user: publicStaffUser(user) });
}));

router.patch("/users/:id", requireAuth, requireRole("super_admin"), asyncHandler(async (req, res) => {
  const input = validate(z.object({
    name: z.string().min(2).max(120).optional(),
    role: z.enum(["super_admin", "admin", "receptionist"]).optional(),
    isActive: z.boolean().optional()
  }), req.body);
  const user = await updateStaffUser(req.params.id, input);
  await audit({ actorType: "staff", actorStaff: req.user._id, action: "staff.updated", entityType: "staff", entityId: req.params.id, req });
  res.json({ success: true, user });
}));

module.exports = router;
