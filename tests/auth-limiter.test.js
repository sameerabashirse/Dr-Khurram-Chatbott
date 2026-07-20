const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createLoginLimiters, normalizedLoginEmail } = require("../src/middleware/security");

async function withLoginServer(run) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  const { accountFailures, ipFailures, accountSuccesses } = createLoginLimiters();
  app.post("/login", accountFailures, ipFailures, accountSuccesses, (req, res) => {
    const status = req.body.succeeds ? 200 : 401;
    if (status === 200) {
      res.once("finish", () => accountFailures.resetKey(normalizedLoginEmail(req)));
    }
    res.status(status).json({ success: status === 200 });
  });
  app.post("/refresh", (req, res) => res.json({ success: true }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function login(baseUrl, { email = "Admin@Example.com ", succeeds = true, ip = "203.0.113.10" } = {}) {
  return fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, succeeds })
  });
}

test("1, 3, 20, 100, and 500 successful logins are accepted without consuming failed-attempt limits", async () => {
  await withLoginServer(async (baseUrl) => {
    const checkpoints = new Set([1, 3, 20, 100, 500]);
    for (let attempt = 1; attempt <= 500; attempt += 1) {
      const response = await login(baseUrl);
      assert.equal(response.status, 200, `successful login ${attempt} should be accepted`);
      if (checkpoints.has(attempt)) assert.equal(response.status, 200);
    }
    assert.equal((await login(baseUrl)).status, 429);
  });
});

test("failed account attempts are limited only after ten failures and include Retry-After", async () => {
  await withLoginServer(async (baseUrl) => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      assert.equal((await login(baseUrl, { succeeds: false })).status, 401);
    }
    const blocked = await login(baseUrl, { succeeds: false });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.match((await blocked.json()).error.message, /unsuccessful sign-in attempts/i);
  });
});

test("a successful login resets the account failure counter", async () => {
  await withLoginServer(async (baseUrl) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await login(baseUrl, { succeeds: false })).status, 401);
    }
    assert.equal((await login(baseUrl)).status, 200);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal((await login(baseUrl, { succeeds: false })).status, 401);
    }
    assert.equal((await login(baseUrl, { succeeds: false })).status, 429);
  });
});

test("separate client IPs have independent abuse limits and refresh is not login-limited", async () => {
  await withLoginServer(async (baseUrl) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await login(baseUrl, {
        email: `admin-${attempt}@example.com`,
        succeeds: false,
        ip: "203.0.113.20"
      });
      assert.equal(response.status, 401);
    }
    assert.equal((await login(baseUrl, { email: "other@example.com", succeeds: false, ip: "198.51.100.8" })).status, 401);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      assert.equal((await fetch(`${baseUrl}/refresh`, { method: "POST" })).status, 200);
    }
  });
});
