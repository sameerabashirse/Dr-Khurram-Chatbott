require("dotenv").config();

const requiredInProduction = [
  "MONGODB_URI",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "COOKIE_SECRET",
  "FRONTEND_URL",
  "CORS_ORIGINS",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "META_APP_SECRET",
  "WHATSAPP_TEMPLATE_APPOINTMENT_CONFIRMATION",
  "WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER",
  "WHATSAPP_TEMPLATE_RESCHEDULE_CONFIRMATION",
  "WHATSAPP_TEMPLATE_CANCELLATION_CONFIRMATION"
];

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

for (const key of requiredInProduction) {
  if (isProduction && !process.env[key]) {
    throw new Error(`Missing required production environment variable: ${key}`);
  }
}

function read(name, fallback = "") {
  return process.env[name] || fallback;
}

function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function readOrigins() {
  return read("CORS_ORIGINS", read("FRONTEND_URL", "http://localhost:3000"))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const config = {
  nodeEnv,
  isProduction,
  port: readNumber("PORT", 3000),
  mongoUri: read("MONGODB_URI", "mongodb://127.0.0.1:27017/dr-khurram-chatbot"),
  frontendUrl: read("FRONTEND_URL", "http://localhost:3000"),
  corsOrigins: readOrigins(),
  jwtAccessSecret: read("JWT_ACCESS_SECRET", "dev-only-change-this-access-secret"),
  jwtRefreshSecret: read("JWT_REFRESH_SECRET", "dev-only-change-this-refresh-secret"),
  cookieSecret: read("COOKIE_SECRET", "dev-only-change-this-cookie-secret"),
  accessTokenTtl: read("ACCESS_TOKEN_TTL", "15m"),
  refreshTokenTtlDays: readNumber("REFRESH_TOKEN_TTL_DAYS", 30),
  clinicTimezone: read("CLINIC_TIMEZONE", "Asia/Karachi"),
  clinicContactNumber: read("CLINIC_CONTACT_NUMBER", "+92 324 4754566"),
  openaiApiKey: read("OPENAI_API_KEY"),
  openaiModel: read("OPENAI_MODEL", "gpt-4o-mini"),
  whatsapp: {
    graphVersion: read("WHATSAPP_GRAPH_VERSION", "v20.0"),
    accessToken: read("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: read("WHATSAPP_PHONE_NUMBER_ID"),
    businessAccountId: read("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    verifyToken: read("WHATSAPP_VERIFY_TOKEN"),
    metaAppSecret: read("META_APP_SECRET"),
    templates: {
      appointmentConfirmation: read("WHATSAPP_TEMPLATE_APPOINTMENT_CONFIRMATION"),
      appointmentReminder: read("WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER"),
      rescheduleConfirmation: read("WHATSAPP_TEMPLATE_RESCHEDULE_CONFIRMATION"),
      cancellationConfirmation: read("WHATSAPP_TEMPLATE_CANCELLATION_CONFIRMATION")
    }
  }
};

module.exports = { config };
