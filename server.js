const { config } = require("./src/config/env");
const { connectDatabase } = require("./src/config/db");
const { createApp } = require("./src/app");
const { startReminderScheduler } = require("./src/services/reminderService");

async function main() {
  await connectDatabase();
  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`Dr. Khurram chatbot server listening on port ${config.port}`);
  });

  startReminderScheduler();

  const shutdown = async (signal) => {
    console.log(`${signal} received. Shutting down gracefully.`);
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("Startup failed:", error.message);
  process.exit(1);
});
