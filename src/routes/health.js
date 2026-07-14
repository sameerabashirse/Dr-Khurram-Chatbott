const express = require("express");
const mongoose = require("mongoose");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ success: true, status: "ok", uptime: process.uptime() });
});

router.get("/ready", asyncHandler(async (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    success: ready,
    database: ready ? "connected" : "not_connected"
  });
}));

module.exports = router;
