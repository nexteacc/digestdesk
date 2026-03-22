import type { Request } from "express";

export function getRequestUserId(req: Request): string {
  if (!req.userId) {
    throw new Error("Resolved user id is missing from request context.");
  }
  return req.userId;
}
