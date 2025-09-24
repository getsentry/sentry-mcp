/**
 * Validates that a slug is safe and follows expected patterns.
 * Used to validate organization and project slugs from URL paths.
 */
export function isValidSlug(slug: string): boolean {
  // Reject empty strings
  if (!slug || slug.length === 0) {
    return false;
  }

  // Reject excessively long slugs (prevent DOS)
  if (slug.length > 100) {
    return false;
  }

  // Reject path traversal attempts
  if (slug.includes("..") || slug.includes("//")) {
    return false;
  }

  // Reject URLs or suspicious patterns
  if (slug.includes("://") || slug.includes("%")) {
    return false;
  }

  // Must start and end with alphanumeric
  if (!/^[a-zA-Z0-9].*[a-zA-Z0-9]$/.test(slug) && slug.length > 1) {
    return false;
  }

  // Single character must be alphanumeric
  if (slug.length === 1 && !/^[a-zA-Z0-9]$/.test(slug)) {
    return false;
  }

  // Only allow alphanumeric, dots, dashes, and underscores
  if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
    return false;
  }

  return true;
}
