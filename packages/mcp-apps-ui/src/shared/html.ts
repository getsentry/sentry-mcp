const HTML_ESCAPE_CHARACTERS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPE_CHARACTERS[character] ?? character,
  );
}

export function renderNumberDisplayHtml(value: unknown, label: string): string {
  return `
    <div class="number-display">
      <div class="number-value">${escapeHtml(value)}</div>
      <div class="number-label">${escapeHtml(label)}</div>
    </div>
  `;
}

export function renderTableHtml(
  data: Record<string, unknown>[],
  columns: string[],
): string {
  const headerCells = columns
    .map((column) => `<th>${escapeHtml(column)}</th>`)
    .join("");
  const rows = data
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => `<td>${escapeHtml(row[column])}</td>`)
          .join("")}</tr>`,
    )
    .join("");

  return `
    <div class="table-container">
      <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function renderErrorHtml(message: string): string {
  return `<div class="error">${escapeHtml(message)}</div>`;
}
