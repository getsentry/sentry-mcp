import { setAttribute, setTag } from "@sentry/core";

export function setOrganizationContext(organizationSlug: string): void {
  // Streamed spans use scope attributes; errors still use scope tags.
  setAttribute("organization.slug", organizationSlug);
  setTag("organization.slug", organizationSlug);
}
