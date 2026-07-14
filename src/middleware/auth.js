const jwt = require("jsonwebtoken");
const { StaffUser } = require("../models");
const { config } = require("../config/env");
const { unauthorized, forbidden } = require("../utils/errors");
const { asyncHandler } = require("../utils/asyncHandler");

const refreshCookieName = "drkhurram_refresh";

const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw unauthorized();

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwtAccessSecret);
  } catch (error) {
    throw unauthorized("Your session has expired. Please sign in again.");
  }

  const user = await StaffUser.findOne({ _id: decoded.sub, isActive: true });
  if (!user) throw unauthorized("Staff account is inactive or no longer exists.");

  req.user = user;
  next();
});

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };
}

module.exports = { requireAuth, requireRole, refreshCookieName };
