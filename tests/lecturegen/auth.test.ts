import assert from "node:assert/strict";
import { test } from "node:test";
import { createJobRecord } from "../../src/lecturegen/job-store.ts";
import {
  assertOwnerAccess,
  authMisconfigured,
  authRoleToOwnerRole,
  resolveAuthRole,
  resolveOwnerRole,
} from "../../src/lecturegen/auth.ts";

test("production auth requires separate service and worker credentials", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousService = process.env.LECTUREGEN_SERVICE_TOKEN;
  const previousWorker = process.env.LECTUREGEN_WORKER_TOKEN;
  process.env.NODE_ENV = "production";
  process.env.LECTUREGEN_SERVICE_TOKEN = "service-secret";
  delete process.env.LECTUREGEN_WORKER_TOKEN;
  try {
    assert.equal(authMisconfigured(), true);
    process.env.LECTUREGEN_WORKER_TOKEN = "worker-secret";
    assert.equal(authMisconfigured(), false);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousService === undefined) delete process.env.LECTUREGEN_SERVICE_TOKEN;
    else process.env.LECTUREGEN_SERVICE_TOKEN = previousService;
    if (previousWorker === undefined) delete process.env.LECTUREGEN_WORKER_TOKEN;
    else process.env.LECTUREGEN_WORKER_TOKEN = previousWorker;
  }
});

test("resolveAuthRole maps service token only when service role allowed", () => {
  const previousService = process.env.LECTUREGEN_SERVICE_TOKEN;
  const previousIde = process.env.LECTUREGEN_IDE_TOKEN;
  process.env.LECTUREGEN_SERVICE_TOKEN = "service-secret";
  process.env.LECTUREGEN_IDE_TOKEN = "ide-secret";

  try {
    assert.equal(resolveAuthRole("service-secret", ["service"]), "service");
    assert.equal(resolveAuthRole("service-secret", ["ide"]), null);
    assert.equal(resolveAuthRole("ide-secret", ["ide"]), "ide");
    assert.equal(resolveAuthRole("ide-secret", ["service"]), null);
    assert.equal(resolveAuthRole("ide-secret", ["service", "ide"]), "ide");
    assert.equal(resolveAuthRole("service-secret", ["service", "ide"]), "service");
  } finally {
    if (previousService === undefined) {
      delete process.env.LECTUREGEN_SERVICE_TOKEN;
    } else {
      process.env.LECTUREGEN_SERVICE_TOKEN = previousService;
    }
    if (previousIde === undefined) {
      delete process.env.LECTUREGEN_IDE_TOKEN;
    } else {
      process.env.LECTUREGEN_IDE_TOKEN = previousIde;
    }
  }
});

test("assertOwnerAccess isolates website and IDE job ownership", () => {
  const websiteJob = createJobRecord(
    { prompt: "web", websiteJobId: "site-1" },
    "website",
  );
  const ideJob = createJobRecord({ prompt: "ide" }, "ide");

  assert.equal(resolveOwnerRole(websiteJob), "website");
  assert.equal(resolveOwnerRole(ideJob), "ide");
  assert.equal(authRoleToOwnerRole("service"), "website");
  assert.equal(authRoleToOwnerRole("ide"), "ide");

  assert.equal(assertOwnerAccess(websiteJob, "service"), true);
  assert.equal(assertOwnerAccess(websiteJob, "ide"), false);
  assert.equal(assertOwnerAccess(ideJob, "ide"), true);
  assert.equal(assertOwnerAccess(ideJob, "service"), false);
  assert.equal(assertOwnerAccess(websiteJob, "worker"), false);
});
