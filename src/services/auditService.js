const { AuditLog } = require("../models");

async function audit({ actorType, actorStaff, actorPhone, action, entityType, entityId, metadata, req }) {
  try {
    await AuditLog.create({
      actorType,
      actorStaff,
      actorPhone,
      action,
      entityType,
      entityId,
      metadata,
      ip: req?.ip,
      userAgent: req?.get?.("user-agent")
    });
  } catch (error) {
    console.error("Audit log write failed:", error.message);
  }
}

module.exports = { audit };
