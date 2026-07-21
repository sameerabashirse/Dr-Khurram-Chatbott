const { ClinicSettings, DoctorProfileSettings, AuditLog } = require("../models");
const { config } = require("../config/env");
const { defaultWeeklyHours } = require("../utils/time");

async function getClinicSettings() {
  let settings = await ClinicSettings.findOne({ key: "default" });
  if (!settings) {
    settings = await ClinicSettings.create({
      key: "default",
      contactNumber: config.clinicContactNumber,
      timezone: config.clinicTimezone,
      weeklyHours: defaultWeeklyHours(),
      slotDurationMinutes: 30,
      reminderIntervalsMinutes: [4320, 1440, 120]
    });
  }
  return settings;
}

async function updateClinicSettings(input, staffUser) {
  const allowed = {
    contactNumber: input.contactNumber,
    timezone: input.timezone,
    slotDurationMinutes: input.slotDurationMinutes,
    weeklyHours: input.weeklyHours,
    reminderIntervalsMinutes: input.reminderIntervalsMinutes,
    updatedBy: staffUser?._id
  };

  Object.keys(allowed).forEach((key) => allowed[key] === undefined && delete allowed[key]);

  return ClinicSettings.findOneAndUpdate(
    { key: "default" },
    { $set: allowed },
    { new: true, upsert: true, runValidators: true }
  );
}

async function getDoctorProfile() {
  let profile = await DoctorProfileSettings.findOne({ key: "default" });
  if (!profile) {
    profile = await DoctorProfileSettings.create({
      key: "default",
      doctorName: "Dr. Khurram",
      contactNumber: config.clinicContactNumber,
      profileImageUrl: "assets/dr-khurram-neutral-doctor.png"
    });
  }
  return profile;
}

async function updateDoctorProfile(input, staffUser) {
  const allowed = {
    doctorName: input.doctorName,
    contactNumber: input.contactNumber,
    specialty: input.specialty,
    qualifications: input.qualifications,
    experience: input.experience,
    biography: input.biography,
    clinicLocation: input.clinicLocation,
    profileImageUrl: input.profileImageUrl,
    updatedBy: staffUser?._id
  };

  Object.keys(allowed).forEach((key) => allowed[key] === undefined && delete allowed[key]);

  return DoctorProfileSettings.findOneAndUpdate(
    { key: "default" },
    { $set: allowed },
    { new: true, upsert: true, runValidators: true }
  );
}

async function listAuditLogs({ limit = 100 } = {}) {
  return AuditLog.find().sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 100, 300)).lean();
}

module.exports = {
  getClinicSettings,
  updateClinicSettings,
  getDoctorProfile,
  updateDoctorProfile,
  listAuditLogs
};
