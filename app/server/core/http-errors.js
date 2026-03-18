class AppError extends Error {
  constructor(message, options = {}) {
    super(String(message || "Internal Server Error"));
    this.name = "AppError";
    this.statusCode = Number(options.statusCode || 500);
    this.code = String(options.code || "internal_error");
    this.details = options.details;
  }
}

function createHttpError(statusCode, code, message, details) {
  return new AppError(message, {
    statusCode,
    code,
    details,
  });
}

function badRequestError(message, details) {
  return createHttpError(400, "bad_request", message, details);
}

function forbiddenError(message, details) {
  return createHttpError(403, "forbidden", message, details);
}

function notFoundError(message, details) {
  return createHttpError(404, "not_found", message, details);
}

function conflictError(message, details) {
  return createHttpError(409, "conflict", message, details);
}

function badGatewayError(message, details) {
  return createHttpError(502, "bad_gateway", message, details);
}

function isAppError(error) {
  return !!error && error instanceof AppError;
}

function normalizeError(error) {
  if (isAppError(error)) {
    return error;
  }
  return createHttpError(
    Number(error?.statusCode || 500),
    String(error?.code || "internal_error"),
    String(error?.message || "Internal Server Error"),
    error?.details,
  );
}

module.exports = {
  AppError,
  badRequestError,
  forbiddenError,
  notFoundError,
  conflictError,
  badGatewayError,
  isAppError,
  normalizeError,
};
