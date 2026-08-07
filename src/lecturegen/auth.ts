import type { IncomingMessage, ServerResponse } from "node:http";

import type { LectureGenJobRecord, LectureGenOwnerRole } from "./types.ts";

export type LectureGenAuthRole = "service" | "worker" | "ide";



function readToken(name: string): string {

  return process.env[name]?.trim() || "";

}



export function getServiceToken(): string {

  return readToken("LECTUREGEN_SERVICE_TOKEN");

}



export function getWorkerToken(): string {

  return readToken("LECTUREGEN_WORKER_TOKEN");

}



export function getIdeToken(): string {

  return readToken("LECTUREGEN_IDE_TOKEN");

}



export function requireAuthInProduction(): boolean {

  return (

    process.env.NODE_ENV === "production" ||

    process.env.LECTUREGEN_REQUIRE_AUTH === "1"

  );

}



export function authMisconfigured(): boolean {

  if (!requireAuthInProduction()) return false;

  return !getServiceToken() || !getWorkerToken();

}



export function bearerToken(req: IncomingMessage): string {

  const header = req.headers.authorization?.trim() ?? "";

  const match = header.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() ?? "";

}



export function resolveAuthRole(

  provided: string,

  allowed: LectureGenAuthRole[],

): LectureGenAuthRole | null {

  const serviceToken = getServiceToken();

  const workerToken = getWorkerToken();

  const ideToken = getIdeToken();



  if (allowed.includes("service") && serviceToken && provided === serviceToken) {

    return "service";

  }

  if (allowed.includes("worker") && workerToken && provided === workerToken) {

    return "worker";

  }

  if (allowed.includes("ide") && ideToken && provided === ideToken) {

    return "ide";

  }

  return null;

}

export function getRequestAuthRole(
  req: IncomingMessage,
  allowed: LectureGenAuthRole[],
): LectureGenAuthRole | null {
  const serviceToken = getServiceToken();
  const workerToken = getWorkerToken();
  const ideToken = getIdeToken();

  if (!serviceToken && !workerToken && !ideToken) {
    if (allowed.includes("service")) return "service";
    if (allowed.includes("ide")) return "ide";
    if (allowed.includes("worker")) return "worker";
    return null;
  }

  return resolveAuthRole(bearerToken(req), allowed);
}

export function authRoleToOwnerRole(
  role: LectureGenAuthRole,
): LectureGenOwnerRole | null {
  if (role === "service") return "website";
  if (role === "ide") return "ide";
  return null;
}

export function resolveOwnerRole(record: LectureGenJobRecord): LectureGenOwnerRole {
  if (record.ownerRole) return record.ownerRole;
  return record.websiteJobId ? "website" : "ide";
}

export function assertOwnerAccess(
  record: LectureGenJobRecord,
  role: LectureGenAuthRole,
): boolean {
  const expected = authRoleToOwnerRole(role);
  if (!expected) return false;
  return resolveOwnerRole(record) === expected;
}

export function checkAuth(
  req: IncomingMessage,
  res: ServerResponse,
  sendJson: (res: ServerResponse, status: number, body: Record<string, unknown>) => void,
  allowed: LectureGenAuthRole[],
): LectureGenAuthRole | null {
  if (authMisconfigured()) {
    sendJson(res, 503, {
      error: "LectureGen authentication is not configured.",
    });
    return null;
  }

  const role = getRequestAuthRole(req, allowed);
  const hasTokens = Boolean(
    getServiceToken() || getWorkerToken() || getIdeToken(),
  );

  if (!role) {
    if (hasTokens) {
      sendJson(res, 401, { error: "Unauthorized" });
    }
    return null;
  }

  return role;
}


