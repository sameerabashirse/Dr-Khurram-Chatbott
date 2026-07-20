const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { StaffUser, RefreshTokenSession } = require("../src/models");
const { login } = require("../src/services/authService");

function stubUser(overrides = {}) {
  return {
    _id: { toString: () => "507f1f77bcf86cd799439011" },
    name: "Administrator",
    email: "admin@example.com",
    passwordHash: "hash",
    role: "admin",
    isActive: true,
    failedLoginAttempts: 0,
    ...overrides
  };
}

async function withAuthStubs({ user, passwordMatches = true }, run) {
  const originals = {
    findOne: StaffUser.findOne,
    findOneAndUpdate: StaffUser.findOneAndUpdate,
    updateOne: StaffUser.updateOne,
    createSession: RefreshTokenSession.create,
    compare: bcrypt.compare
  };
  const calls = {};
  StaffUser.findOne = (filter) => {
    calls.findFilter = filter;
    return { select: async () => user };
  };
  StaffUser.findOneAndUpdate = async (...args) => { calls.failedUpdate = args; return user; };
  StaffUser.updateOne = async (...args) => { calls.successUpdate = args; return { acknowledged: true }; };
  RefreshTokenSession.create = async (value) => { calls.session = value; return value; };
  bcrypt.compare = async () => passwordMatches;
  const req = { ip: "203.0.113.4", get: () => "test-agent" };
  const res = { cookie: (...args) => { calls.cookie = args; } };
  try {
    await run({ req, res, calls });
  } finally {
    StaffUser.findOne = originals.findOne;
    StaffUser.findOneAndUpdate = originals.findOneAndUpdate;
    StaffUser.updateOne = originals.updateOne;
    RefreshTokenSession.create = originals.createSession;
    bcrypt.compare = originals.compare;
  }
}

test("successful login normalizes email and atomically clears failure state", async () => {
  await withAuthStubs({ user: stubUser({ failedLoginAttempts: 7 }) }, async ({ req, res, calls }) => {
    const result = await login({ email: "  ADMIN@Example.COM ", password: "correct" }, req, res);
    assert.equal(calls.findFilter.email, "admin@example.com");
    assert.deepEqual(calls.successUpdate[1].$set.failedLoginAttempts, 0);
    assert.deepEqual(calls.successUpdate[1].$unset, { lockUntil: 1, lastFailedLoginAt: 1 });
    assert.ok(calls.successUpdate[1].$set.lastLoginAt instanceof Date);
    assert.ok(calls.session.tokenHash);
    assert.ok(calls.cookie);
    assert.equal(result.user.email, "admin@example.com");
  });
});

test("wrong password uses one atomic update pipeline and returns the safe credential message", async () => {
  await withAuthStubs({ user: stubUser(), passwordMatches: false }, async ({ req, res, calls }) => {
    await assert.rejects(
      login({ email: "admin@example.com", password: "wrong" }, req, res),
      (error) => error.statusCode === 401 && error.message === "Email or password is incorrect."
    );
    assert.equal(calls.failedUpdate[1].length, 2);
    assert.equal(calls.successUpdate, undefined);
  });
});

test("unknown accounts use the same credential response as wrong passwords", async () => {
  await withAuthStubs({ user: null }, async ({ req, res }) => {
    await assert.rejects(
      login({ email: "missing@example.com", password: "wrong" }, req, res),
      (error) => error.statusCode === 401 && error.message === "Email or password is incorrect."
    );
  });
});

test("an active temporary lock returns 429 with a retry interval", async () => {
  const lockUntil = new Date(Date.now() + 5 * 60 * 1000);
  await withAuthStubs({ user: stubUser({ lockUntil }) }, async ({ req, res }) => {
    await assert.rejects(
      login({ email: "admin@example.com", password: "correct" }, req, res),
      (error) => error.statusCode === 429 && error.retryAfterSeconds > 0
    );
  });
});
