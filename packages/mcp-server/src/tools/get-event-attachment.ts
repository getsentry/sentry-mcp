import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import type { ServerContext } from "../types";
import type {
  TextContent,
  ImageContent,
  EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ParamOrganizationSlug,
  ParamProjectSlug,
  ParamEventId,
  ParamAttachmentId,
  ParamRegionUrl,
} from "../schema";
import { setTag } from "@sentry/core";

export default defineTool({
  name: "get_event_attachment",
  requiredSkills: ["inspect"], // Only available in inspect skill
  requiredScopes: ["event:read"],
  description: [
    "Download attachments from a Sentry event.",
    "",
    "Use this tool when you need to:",
    "- Download files attached to a specific event",
    "- Access screenshots, log files, or other attachments uploaded with an error report",
    "- Retrieve attachment metadata and download URLs",
    "",
    "<examples>",
    "### Download a specific attachment by ID",
    "",
    "```",
    "get_event_attachment(organizationSlug='my-organization', projectSlug='my-project', eventId='c49541c747cb4d8aa3efb70ca5aba243', attachmentId='12345')",
    "```",
    "",
    "### List all attachments for an event",
    "",
    "```",
    "get_event_attachment(organizationSlug='my-organization', projectSlug='my-project', eventId='c49541c747cb4d8aa3efb70ca5aba243')",
    "```",
    "",
    "</examples>",
    "",
    "<hints>",
    "- If `attachmentId` is provided, the specific attachment will be downloaded as an embedded resource",
    "- If `attachmentId` is omitted, all attachments for the event will be listed with download information",
    "- The `projectSlug` is required to identify which project the event belongs to",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    projectSlug: ParamProjectSlug,
    eventId: ParamEventId,
    attachmentId: ParamAttachmentId.optional(),
    regionUrl: ParamRegionUrl.optional(),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });

    setTag("organization.slug", params.organizationSlug);

    // If attachmentId is provided, download the specific attachment
    if (params.attachmentId) {
      const attachment = await apiService.getEventAttachment({
        organizationSlug: params.organizationSlug,
        projectSlug: params.projectSlug,
        eventId: params.eventId,
        attachmentId: params.attachmentId,
      });

      const contentParts: (TextContent | ImageContent | EmbeddedResource)[] =
        [];
      const isBinary = !attachment.attachment.mimetype?.startsWith("text/");

      if (isBinary) {
        const isImage = attachment.attachment.mimetype?.startsWith("image/");
        // Base64 encode the binary attachment content
        // and add to the content as an embedded resource
        const uint8Array = new Uint8Array(await attachment.blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < uint8Array.byteLength; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        if (isImage) {
          const image: ImageContent = {
            type: "image",
            mimeType: attachment.attachment.mimetype,
            data: btoa(binary),
          };
          contentParts.push(image);
        } else {
          const resource: EmbeddedResource = {
            id: params.attachmentId,
            type: "resource",
            resource: {
              uri: `file://${attachment.filename}`,
              mimeType: attachment.attachment.mimetype,
              blob: btoa(binary),
            },
          };
          contentParts.push(resource);
        }
      }

      let output = `# Event Attachment Download\n\n`;
      output += `**Event ID:** ${params.eventId}\n`;
      output += `**Attachment ID:** ${params.attachmentId}\n`;
      output += `**Filename:** ${attachment.filename}\n`;
      output += `**Type:** ${attachment.attachment.type}\n`;
      output += `**Size:** ${attachment.attachment.size} bytes\n`;
      output += `**MIME Type:** ${attachment.attachment.mimetype}\n`;
      output += `**Created:** ${attachment.attachment.dateCreated}\n`;
      output += `**SHA1:** ${attachment.attachment.sha1}\n\n`;
      output += `**Download URL:** ${attachment.downloadUrl}\n\n`;

      if (isBinary) {
        output += `## Binary Content\n\n`;
        output += `The attachment is included as a resource and accessible through your client.\n`;
      } else {
        // If it's a text file and we have blob content, decode and display it instead
        // of embedding it as an image or resource
        const textContent = await attachment.blob.text();
        output += `## File Content\n\n`;
        output += `\`\`\`\n${textContent}\n\`\`\`\n\n`;
      }

      const text: TextContent = {
        type: "text",
        text: output,
      };
      contentParts.push(text);

      return contentParts;
    }

    // List all attachments for the event
    const attachments = await apiService.listEventAttachments({
      organizationSlug: params.organizationSlug,
      projectSlug: params.projectSlug,
      eventId: params.eventId,
    });

    let output = `# Event Attachments\n\n`;
    output += `**Event ID:** ${params.eventId}\n`;
    output += `**Project:** ${params.projectSlug}\n\n`;

    if (attachments.length === 0) {
      output += "No attachments found for this event.\n";
      return output;
    }

    output += `Found ${attachments.length} attachment(s):\n\n`;

    attachments.forEach((attachment, index) => {
      output += `## Attachment ${index + 1}\n\n`;
      output += `**ID:** ${attachment.id}\n`;
      output += `**Name:** ${attachment.name}\n`;
      output += `**Type:** ${attachment.type}\n`;
      output += `**Size:** ${attachment.size} bytes\n`;
      output += `**MIME Type:** ${attachment.mimetype}\n`;
      output += `**Created:** ${attachment.dateCreated}\n`;
      output += `**SHA1:** ${attachment.sha1}\n\n`;
      output += `To download this attachment, use the "get_event_attachment" tool with the attachmentId provided:\n`;
      output += `\`get_event_attachment(organizationSlug="${params.organizationSlug}", projectSlug="${params.projectSlug}", eventId="${params.eventId}", attachmentId="${attachment.id}")\`\n\n`;
    });

    return output;
  },
});
