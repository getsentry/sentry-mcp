import { getActiveSpan, setTag } from "@sentry/core";

/** Record the organization resolved by a tool for errors and span analytics. */
export function setOrganizationSlug(organizationSlug: string): void {
  setTag("organization.slug", organizationSlug);
  getActiveSpan()?.setAttribute("app.organization.slug", organizationSlug);
}
