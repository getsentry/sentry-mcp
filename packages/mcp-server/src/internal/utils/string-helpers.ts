// Just some string utilities i find helpful

export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function truncate(str: string, maxLength = 50): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 3)}...`;
}

// Helper to clean up whitespace
export const cleanWhitespace = (input: string) => {
  return input.trim().replace(/\s+/g, " ");
};
