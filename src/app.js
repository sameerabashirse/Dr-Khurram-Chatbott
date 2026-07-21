const path = require("path");
const { randomUUID } = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const mongoSanitize = require("express-mongo-sanitize");
const { config } = require("./config/env");
const { apiLimiter, strictOrigin } = require("./middleware/security");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

function createApp() {
  const app = express();
  const rootDir = path.resolve(__dirname, "..");

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const incoming = String(req.get("x-request-id") || "");
    req.requestId = /^[a-zA-Z0-9._-]{8,100}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  }));
  app.use(compression());
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: true
  }));
  app.use(express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));
  app.use(express.urlencoded({ extended: false, limit: "500kb" }));
  app.use(cookieParser(config.cookieSecret));
  app.use(mongoSanitize());
  app.use(strictOrigin);
  app.use("/api", apiLimiter);

  app.use("/api/auth", require("./routes/auth"));
  app.use("/api/appointments", require("./routes/appointments"));
  app.use("/api/availability", require("./routes/availability"));
  app.use("/api/whatsapp", require("./routes/whatsapp"));
  app.use("/api/settings", require("./routes/settings"));
  app.use("/api/health", require("./routes/health"));

  app.use(express.static(rootDir, {
    index: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    }
  }));

  app.get("/", (req, res) => res.sendFile(path.join(rootDir, "index.html")));
  app.get(["/staff", "/appointments"], (req, res) => res.sendFile(path.join(rootDir, "index.html")));

  app.use("/api", notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
