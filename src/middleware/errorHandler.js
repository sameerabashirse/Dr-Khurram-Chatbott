const { AppError } = require("../utils/errors");
const { config } = require("../config/env");

function notFoundHandler(req, res, next) {
  next(new AppError(404, "NOT_FOUND", "The requested endpoint was not found"));
}

function errorHandler(error, req, res, next) {
  const isTrusted = error instanceof AppError;
  const statusCode = isTrusted ? error.statusCode : 500;
  const body = {
    success: false,
    error: {
      code: isTrusted ? error.code : "INTERNAL_SERVER_ERROR",
      message: isTrusted ? error.message : "Something went wrong. Please try again later."
    }
  };

  if (isTrusted && error.details) body.error.details = error.details;
  if (!config.isProduction && !isTrusted) body.error.debug = error.message;

  if (!isTrusted) {
    console.error("Unhandled error:", {
      message: error.message,
      path: req.originalUrl,
      method: req.method
    });
  }

  res.status(statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };
