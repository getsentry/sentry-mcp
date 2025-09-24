/**
 * Shared HTML utilities for consistent styling across server-rendered pages
 */

/**
 * Sanitizes HTML content to prevent XSS attacks
 */
export function sanitizeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Common CSS styles used across all pages
 */
const SHARED_STYLES = `
  /* Modern, responsive styling with system fonts */
  :root {
    --primary-color: oklch(0.205 0 0);
    --highlight-color: oklch(0.811 0.111 293.571);
    --border-color: oklch(0.278 0.033 256.848);
    --error-color: #f44336;
    --success-color: #4caf50;
    --border-color: oklch(0.269 0 0);
    --text-color: oklch(0.872 0.01 258.338);
    --background-color: oklab(0 0 0 / 0.3);
  }
  
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
                 Helvetica, Arial, sans-serif, "Apple Color Emoji", 
                 "Segoe UI Emoji", "Segoe UI Symbol";
    line-height: 1.6;
    color: var(--text-color);
    background: linear-gradient(oklch(0.13 0.028 261.692) 0%, oklch(0.21 0.034 264.665) 50%, oklch(0.13 0.028 261.692) 100%);
    min-height: 100vh;
    margin: 0;
    padding: 0;
  }
  
  .container {
    max-width: 600px;
    margin: 2rem auto;
    padding: 1rem;
  }
  
  .precard {
    padding: 2rem;
    text-align: center;
  }
  
  .card {
    background-color: var(--background-color);
    padding: 2rem;
    text-align: center;
  }
  
  .header {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1.5rem;
  }
  
  .logo {
    width: 36px;
    height: 36px;
    margin-right: 1rem;
    color: var(--highlight-color);
  }
  
  .title {
    margin: 0;
    font-size: 26px;
    font-weight: 400;
    color: white;
  }
  
  .status-message {
    margin: 1.5rem 0;
    font-size: 1.5rem;
    font-weight: 400;
    color: white;
  }
  
  .description {
    margin: 1rem 0;
    color: var(--text-color);
    font-size: 1rem;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-color);
    border-top: 2px solid var(--highlight-color);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 1rem auto;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  /* Responsive adjustments */
  @media (max-width: 640px) {
    .container {
      margin: 1rem auto;
      padding: 0.5rem;
    }
    
    .card {
      padding: 1.5rem;
    }
    
    .precard {
      padding: 1rem;
    }
  }
`;

/**
 * Sentry logo SVG
 */
const SENTRY_LOGO = `
  <svg class="logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-labelledby="icon-title">
    <title id="icon-title">Sentry Logo</title>
    <path d="M17.48 1.996c.45.26.823.633 1.082 1.083l13.043 22.622a2.962 2.962 0 0 1-2.562 4.44h-3.062c.043-.823.039-1.647 0-2.472h3.052a.488.488 0 0 0 .43-.734L16.418 4.315a.489.489 0 0 0-.845 0L12.582 9.51a23.16 23.16 0 0 1 7.703 8.362 23.19 23.19 0 0 1 2.8 11.024v1.234h-7.882v-1.236a15.284 15.284 0 0 0-6.571-12.543l-1.48 2.567a12.301 12.301 0 0 1 5.105 9.987v1.233h-9.3a2.954 2.954 0 0 1-2.56-1.48A2.963 2.963 0 0 1 .395 25.7l1.864-3.26a6.854 6.854 0 0 1 2.15 1.23l-1.883 3.266a.49.49 0 0 0 .43.734h6.758a9.985 9.985 0 0 0-4.83-7.272l-1.075-.618 3.927-6.835 1.075.615a17.728 17.728 0 0 1 6.164 5.956 17.752 17.752 0 0 1 2.653 8.154h2.959a20.714 20.714 0 0 0-3.05-9.627 20.686 20.686 0 0 0-7.236-7.036l-1.075-.618 4.215-7.309a2.958 2.958 0 0 1 4.038-1.083Z" fill="currentColor"></path>
  </svg>
`;

/**
 * Options for creating HTML pages
 */
export interface HtmlPageOptions {
  title: string;
  serverName?: string;
  statusMessage: string;
  description?: string;
  type?: "success" | "error" | "info";
  showSpinner?: boolean;
  additionalStyles?: string;
  bodyScript?: string;
}

/**
 * Creates a consistent HTML page with Sentry branding and styling
 */
export function createHtmlPage(options: HtmlPageOptions): string {
  const {
    title,
    serverName = "Sentry MCP",
    statusMessage,
    description,
    showSpinner = false,
    additionalStyles = "",
    bodyScript = "",
  } = options;

  const safeTitle = sanitizeHtml(title);
  const safeServerName = sanitizeHtml(serverName);
  const safeStatusMessage = sanitizeHtml(statusMessage);
  const safeDescription = description ? sanitizeHtml(description) : "";

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${safeTitle}</title>
        <style>
          ${SHARED_STYLES}
          ${additionalStyles}
        </style>
      </head>
      <body>
        <div class="container">
          <div class="precard">
            <div class="header">
              ${SENTRY_LOGO}
              <h1 class="title"><strong>${safeServerName}</strong></h1>
            </div>
          </div>
          
          <div class="card">
            <h2 class="status-message">${safeStatusMessage}</h2>
            
            ${showSpinner ? '<div class="spinner"></div>' : ""}
            
            ${safeDescription ? `<p class="description">${safeDescription}</p>` : ""}
          </div>
        </div>
        
        ${bodyScript ? `<script>${bodyScript}</script>` : ""}
      </body>
    </html>
  `;
}

/**
 * Creates a success page for OAuth flows
 */
export function createSuccessPage(
  options: Partial<HtmlPageOptions> = {},
): string {
  return createHtmlPage({
    title: "Authentication Successful",
    statusMessage: "Authentication Successful",
    description: "Authentication completed successfully.",
    type: "success",
    ...options,
  });
}

/**
 * Creates an error page for OAuth flows
 */
export function createErrorPage(
  title: string,
  message: string,
  options: Partial<HtmlPageOptions> = {},
): string {
  return createHtmlPage({
    title: sanitizeHtml(title),
    statusMessage: sanitizeHtml(title),
    description: sanitizeHtml(message),
    type: "error",
    ...options,
  });
}
