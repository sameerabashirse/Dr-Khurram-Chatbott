const rateLimit = require("express-rate-limit");
const net = require("node:net");
const { forbidden } = require("../utils/errors");
const { config } = require("../config/env");

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function normalizedLoginEmail(req) {
  return String(req.body?.email || "").trim().toLowerCase();
}

function safeClientIp(req) {
  if (net.isIP(req.ip)) return req.ip;
  const socketIp = req.socket?.remoteAddress;
  return net.isIP(socketIp) ? socketIp : "invalid-client-ip";
}

function loginLimitMessage(req, res) {
  const resetTime = req.rateLimit?.resetTime?.getTime?.() || Date.now() + FIFTEEN_MINUTES;
  const minutes = Math.max(1, Math.ceil((resetTime - Date.now()) / 60000));
  res.status(429).json({
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: `Too many unsuccessful sign-in attempts. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`
    }
  });
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ["/auth/login", "/auth/refresh"].includes(req.path)
});

function createLoginLimiters() {
  const accountFailures = rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit: 10,
    keyGenerator: normalizedLoginEmail,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: loginLimitMessage
  });

  const ipFailures = rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit: 30,
    keyGenerator: safeClientIp,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: loginLimitMessage
  });

  const accountSuccesses = rateLimit({
    windowMs: ONE_DAY,
    limit: 500,
    keyGenerator: normalizedLoginEmail,
    skipFailedRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: "RATE_LIMITED", message: "The daily sign-in allowance has been reached. Please try again later." }
    }
  });

  return { accountFailures, ipFailures, accountSuccesses };
}

const {
  accountFailures: failedLoginAccountLimiter,
  ipFailures: failedLoginIpLimiter,
  accountSuccesses: successfulLoginLimiter
} = createLoginLimiters();

const setupLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

const loginLimiters = [failedLoginAccountLimiter, failedLoginIpLimiter, successfulLoginLimiter];

function resetAccountFailedLoginLimit(req, res) {
  const reset = () => failedLoginAccountLimiter.resetKey(normalizedLoginEmail(req));
  if (res?.once) res.once("finish", reset);
  else reset();
}

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

module.exports = {
  apiLimiter,
  loginLimiters,
  setupLimiter,
  resetAccountFailedLoginLimit,
  publicFormLimiter,
  webhookLimiter,
  strictOrigin,
  normalizedLoginEmail,
  safeClientIp,
  createLoginLimiters
};
