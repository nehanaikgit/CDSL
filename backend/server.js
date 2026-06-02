const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");

const processRoutes = require("./routes/processRoutes");
const errorHandler  = require("./middleware/errorHandler");

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "CDSL backend is running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "CDSL Backend",
    status: "OK",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/process", processRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`CDSL backend running on http://localhost:${PORT}`);
});