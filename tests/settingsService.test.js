const test = require("node:test");
const assert = require("node:assert/strict");
const { ClinicSettings, DoctorProfileSettings } = require("../src/models");
const {
  updateClinicSettings,
  updateDoctorProfile
} = require("../src/services/settingsService");

test("settings upserts do not update the key through conflicting operators", async (t) => {
  const originalClinicUpdate = ClinicSettings.findOneAndUpdate;
  const originalDoctorUpdate = DoctorProfileSettings.findOneAndUpdate;
  const calls = [];

  t.after(() => {
    ClinicSettings.findOneAndUpdate = originalClinicUpdate;
    DoctorProfileSettings.findOneAndUpdate = originalDoctorUpdate;
  });

  ClinicSettings.findOneAndUpdate = (...args) => {
    calls.push({ model: "clinic", args });
    return Promise.resolve({ contactNumber: args[1].$set.contactNumber });
  };
  DoctorProfileSettings.findOneAndUpdate = (...args) => {
    calls.push({ model: "doctor", args });
    return Promise.resolve({ contactNumber: args[1].$set.contactNumber });
  };

  await updateDoctorProfile({ contactNumber: "+92 300 1234567" });
  await updateClinicSettings({ contactNumber: "+92 300 7654321" });

  assert.equal(calls.length, 2);
  for (const { args } of calls) {
    const [filter, update, options] = args;
    assert.deepEqual(filter, { key: "default" });
    assert.equal(update.$setOnInsert, undefined);
    assert.equal(Object.hasOwn(update.$set, "key"), false);
    assert.deepEqual(options, { new: true, upsert: true, runValidators: true });
  }
  assert.equal(calls[0].args[1].$set.contactNumber, "+92 300 1234567");
  assert.equal(calls[1].args[1].$set.contactNumber, "+92 300 7654321");
});
