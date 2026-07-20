class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

function badRequest(message, details) {
  return new AppError(400, "BAD_REQUEST", message, details);
}

function unauthorized(message = "Authentication is required") {
  return new AppError(401, "UNAUTHORIZED", message);
}

function forbidden(message = "You are not authorized to perform this action") {
  return new AppError(403, "FORBIDDEN", message);
}

function notFound(message = "Resource not found") {
  return new AppError(404, "NOT_FOUND", message);
}

function conflict(message, details) {
  return new AppError(409, "CONFLICT", message, details);
}

function tooManyRequests(message, retryAfterSeconds) {
  const error = new AppError(429, "RATE_LIMITED", message);
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, tooManyRequests };
