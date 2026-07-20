const rateLimit = require("express-rate-limit");
const { forbidden } = require("../utils/errors");
const { config } = require("../config/env");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many login attempts. Please try again later." }
  }
});

const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 900,
  standardHeaders: true,
  legacyHeaders: false
});

function strictOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path.startsWith("/api/whatsapp/webhook")) return next();

  const origin = req.get("origin");
  if (!origin) return next();
  if (config.corsOrigins.includes(origin)) return next();
  return next(forbidden("Request origin is not allowed"));
}

module.exports = { apiLimiter, authLimiter, publicFormLimiter, webhookLimiter, strictOrigin };
