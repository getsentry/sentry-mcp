import * as Sentry from "@sentry/cloudflare";
import { getClientIp } from "./client-ip";

type SentryUserContext = {
  id?: string;
  ip_address?: string;
};

export function setSentryUserFromRequest(
  request: Request,
  userId?: string | null,
): SentryUserContext {
  const user: SentryUserContext = {};
  const clientIP = getClientIp(request);

  if (userId) {
    user.id = userId;
  }
  if (clientIP) {
    user.ip_address = clientIP;
  }

  if (Object.keys(user).length > 0) {
    Sentry.setUser(user);
  }

  return user;
}
