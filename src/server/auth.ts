import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "./errors.js";

/**
 * Bearer-token auth against a static key list. This is deliberately the
 * minimum viable gate, not real IAM — no per-key scoping, no rotation, no
 * org/tenant isolation. Swap for a real identity provider before this is
 * anything but a pilot.
 */
export function requireApiKey(validKeys: ReadonlySet<string>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (validKeys.size === 0) {
      next(); // no keys configured: auth disabled (local/dev use)
      return;
    }
    const header = req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token || !validKeys.has(token)) {
      next(unauthorized("missing or invalid API key"));
      return;
    }
    next();
  };
}
