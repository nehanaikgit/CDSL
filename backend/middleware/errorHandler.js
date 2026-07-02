function errorHandler(error, req, res, _next) {
  // express.json() throws a SyntaxError with type "entity.parse.failed" and
  // status 400 for malformed JSON bodies — surface that as a clean 400
  // instead of falling through to a generic 500.
  const isMalformedJson = error.type === "entity.parse.failed";
  const statusCode = error.statusCode || error.status || (isMalformedJson ? 400 : 500);
  const message = isMalformedJson
    ? "Malformed JSON body"
    : (error.message || "Internal server error");

  console.error("Backend error:", {
    message: error.message,
    stack: error.stack,
  });

  res.status(statusCode).json({
    success: false,
    message,
  });
}

module.exports = errorHandler;