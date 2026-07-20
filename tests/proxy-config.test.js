const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTrustProxy } = require("../src/config/env");
const { safeClientIp } = require("../src/middleware/security");

test("TRUST_PROXY accepts explicit topology and rejects unsafe wildcard trust", () => {
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("1"), 1);
  assert.deepEqual(parseTrustProxy("loopback, 10.0.0.0/8"), ["loopback", "10.0.0.0/8"]);
  assert.throws(() => parseTrustProxy("true"), /TRUST_PROXY/);
  assert.throws(() => parseTrustProxy("*"), /TRUST_PROXY/);
});

test("malformed forwarded client identity falls back to the socket address", () => {
  assert.equal(safeClientIp({ ip: "not-an-ip", socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
  assert.equal(safeClientIp({ ip: "203.0.113.9", socket: { remoteAddress: "127.0.0.1" } }), "203.0.113.9");
});
