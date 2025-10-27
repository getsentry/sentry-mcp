import { describe, it, expect } from "vitest";
import getEventAttachment from "./get-event-attachment.js";

describe("get_event_attachment", () => {
  it("lists attachments for an event", async () => {
    const result = await getEventAttachment.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        eventId: "7ca573c0f4814912aaa9bdc77d1a7d51",
        attachmentId: undefined,
        regionUrl: undefined,
      },
      {
        constraints: {
          organizationSlug: null,
          projectSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Event Attachments

      **Event ID:** 7ca573c0f4814912aaa9bdc77d1a7d51
      **Project:** cloudflare-mcp

      Found 1 attachment(s):

      ## Attachment 1

      **ID:** 123
      **Name:** screenshot.png
      **Type:** event.attachment
      **Size:** 1024 bytes
      **MIME Type:** image/png
      **Created:** 2025-04-08T21:15:04.000Z
      **SHA1:** abc123def456

      To download this attachment, use the "get_event_attachment" tool with the attachmentId provided:
      \`get_event_attachment(organizationSlug="sentry-mcp-evals", projectSlug="cloudflare-mcp", eventId="7ca573c0f4814912aaa9bdc77d1a7d51", attachmentId="123")\`

      "
    `);
  });

  it("downloads a specific attachment by ID", async () => {
    const result = await getEventAttachment.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        eventId: "7ca573c0f4814912aaa9bdc77d1a7d51",
        attachmentId: "123",
        regionUrl: undefined,
      },
      {
        constraints: {
          organizationSlug: null,
          projectSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    // Should return an array with both text description and image content
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);

    // First item should be the image content
    expect(result[0]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      data: expect.any(String), // base64 encoded data
    });

    // Second item should be the text description
    expect(result[1]).toMatchInlineSnapshot(`
      {
        "text": "# Event Attachment Download

      **Event ID:** 7ca573c0f4814912aaa9bdc77d1a7d51
      **Attachment ID:** 123
      **Filename:** screenshot.png
      **Type:** event.attachment
      **Size:** 1024 bytes
      **MIME Type:** image/png
      **Created:** 2025-04-08T21:15:04.000Z
      **SHA1:** abc123def456

      **Download URL:** https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/events/7ca573c0f4814912aaa9bdc77d1a7d51/attachments/123/?download=1

      ## Binary Content

      The attachment is included as a resource and accessible through your client.
      ",
        "type": "text",
      }
    `);
  });

  it("throws error for malformed regionUrl", async () => {
    await expect(
      getEventAttachment.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          eventId: "7ca573c0f4814912aaa9bdc77d1a7d51",
          attachmentId: undefined,
          regionUrl: "https",
        },
        {
          constraints: {
            organizationSlug: null,
            projectSlug: null,
          },
          accessToken: "access-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow(
      "Invalid regionUrl provided: https. Must be a valid URL.",
    );
  });
});
