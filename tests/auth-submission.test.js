const test = require("node:test");
const assert = require("node:assert/strict");
const { runOnce } = require("../auth-submission");

test("double submission starts only one login request", async () => {
  const form = { dataset: {} };
  let requests = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const task = () => {
    requests += 1;
    return pending;
  };

  const first = runOnce(form, task);
  const second = runOnce(form, task);
  assert.equal(requests, 1);
  assert.equal(await second, false);
  release();
  assert.equal(await first, true);
});

test("failed submission releases the guard so the button can be re-enabled and retried", async () => {
  const form = { dataset: {} };
  await assert.rejects(runOnce(form, async () => { throw new Error("failed"); }));
  assert.equal(form.dataset.submitting, undefined);
  assert.equal(await runOnce(form, async () => {}), true);
});
