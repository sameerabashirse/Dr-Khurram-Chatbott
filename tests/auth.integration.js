const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { StaffUser } = require("../src/models");
const { createStaffUser, login, refresh, logout } = require("../src/services/authService");
const { refreshCookieName } = require("../src/middleware/auth");

function request(cookies = {}) {
  return {
    ip: "203.0.113.40",
    signedCookies: cookies,
    get: (name) => name === "user-agent" ? "auth-integration-test" : undefined
  };
}

function response() {
  return {
    cookies: new Map(),
    cookie(name, value) { this.cookies.set(name, value); },
    clearCookie(name) { this.cookies.delete(name); }
  };
}

test("authentication counters, lock expiry, refresh, logout, and relogin work against an isolated MongoDB", async () => {
  const database = await MongoMemoryServer.create({ instance: { dbName: "auth-integration" } });
  await mongoose.connect(database.getUri(), { dbName: "auth-integration" });
  try {
    const password = "StrongPassword!42";
    await createStaffUser({
      name: "Integration Admin",
      email: "Admin@Example.com",
      password,
      role: "admin"
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(
        login({ email: "admin@example.com", password: "wrong" }, request(), response()),
        (error) => error.statusCode === 401 && error.message === "Email or password is incorrect."
      );
    }
    assert.equal((await StaffUser.findOne({ email: "admin@example.com" })).failedLoginAttempts, 3);

    const firstResponse = response();
    await login({ email: " ADMIN@example.com ", password }, request(), firstResponse);
    let storedUser = await StaffUser.findOne({ email: "admin@example.com" });
    assert.equal(storedUser.failedLoginAttempts, 0);
    assert.equal(storedUser.lockUntil, undefined);

    const firstRefreshToken = firstResponse.cookies.get(refreshCookieName);
    const refreshedResponse = response();
    await refresh(request({ [refreshCookieName]: firstRefreshToken }), refreshedResponse);
    const rotatedRefreshToken = refreshedResponse.cookies.get(refreshCookieName);
    assert.ok(rotatedRefreshToken);
    assert.notEqual(rotatedRefreshToken, firstRefreshToken);

    await logout(request({ [refreshCookieName]: rotatedRefreshToken }), response());
    await login({ email: "admin@example.com", password }, request(), response());

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await assert.rejects(login({ email: "admin@example.com", password: "wrong" }, request(), response()));
    }
    storedUser = await StaffUser.findOne({ email: "admin@example.com" });
    assert.equal(storedUser.failedLoginAttempts, 10);
    assert.ok(storedUser.lockUntil > new Date());

    await assert.rejects(
      login({ email: "admin@example.com", password }, request(), response()),
      (error) => error.statusCode === 429 && error.retryAfterSeconds > 0
    );

    await StaffUser.updateOne(
      { email: "admin@example.com" },
      { $set: { lockUntil: new Date(Date.now() - 1000) } }
    );
    await login({ email: "admin@example.com", password }, request(), response());
    storedUser = await StaffUser.findOne({ email: "admin@example.com" });
    assert.equal(storedUser.failedLoginAttempts, 0);
    assert.equal(storedUser.lockUntil, undefined);
  } finally {
    await mongoose.disconnect();
    await database.stop();
  }
});
