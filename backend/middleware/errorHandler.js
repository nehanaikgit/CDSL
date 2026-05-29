function errorHandler(error, req, res, _next) {
  const statusCode = error.statusCode || 500;

  console.error("Backend error:", {
    message: error.message,
    stack: error.stack,
  });

  res.status(statusCode).json({
    success: false,
    message: error.message || "Internal server error",
  });
}

module.exports = errorHandler;