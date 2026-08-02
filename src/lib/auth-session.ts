import type { SessionTask, SetActive } from "@clerk/react";

export const AUTH_SESSION_TASK_ROUTES: Record<SessionTask["key"], string> = {
  "choose-organization": "/session-task/choose-organization",
  "reset-password": "/session-task/reset-password",
  "setup-mfa": "/session-task/setup-mfa",
};

export function getAuthSessionRoute(task?: SessionTask) {
  return task ? AUTH_SESSION_TASK_ROUTES[task.key] : "/";
}

export function getAuthSessionUrl(task?: SessionTask) {
  return `/#${getAuthSessionRoute(task)}`;
}

export function getLocalAuthRoute(url: string, fallback: string) {
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(hashIndex + 1) || fallback : fallback;
}

export async function finalizeAuthSession({
  setActive,
  sessionId,
  navigate,
  navigateExternal = (url) => window.location.assign(url),
}: {
  setActive: SetActive;
  sessionId: string;
  navigate: (route: string) => void;
  navigateExternal?: (url: string) => void;
}) {
  await setActive({
    session: sessionId,
    navigate: async ({ session, decorateUrl }) => {
      const fallbackRoute = getAuthSessionRoute(session.currentTask);
      const destination = decorateUrl(getAuthSessionUrl(session.currentTask));
      if (/^https?:\/\//.test(destination)) {
        navigateExternal(destination);
        return;
      }
      navigate(getLocalAuthRoute(destination, fallbackRoute));
    },
  });
}
