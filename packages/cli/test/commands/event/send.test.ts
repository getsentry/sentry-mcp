/**
 * Tests for `sentry event send` command func().
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sendCommand } from "../../../src/commands/event/send.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn
import * as transport from "../../../src/lib/envelope/transport.js";
import { ValidationError } from "../../../src/lib/errors.js";
import { useTestConfigDir } from "../../helpers.js";

useTestConfigDir("send-event-");

const SAAS_DSN = "https://abc123@o1.ingest.us.sentry.io/999";

function makeContext() {
  const writes: string[] = [];
  return {
    ctx: {
      stdout: {
        write: (s: string) => {
          writes.push(s);
          return true;
        },
      },
      stderr: { write: vi.fn(() => true) },
      cwd: "/tmp",
    },
    writes,
  };
}

describe("sendCommand.func()", () => {
  let func: Awaited<ReturnType<typeof sendCommand.loader>>;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    func = await sendCommand.loader();
    sendSpy = vi
      .spyOn(transport, "sendEnvelopeRequest")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  test("inline message sends an envelope and prints event ID", async () => {
    const { ctx, writes } = makeContext();
    await func.call(ctx, {
      dsn: SAAS_DSN,
      message: ["Test message"],
      level: "error",
      "no-environ": true,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [calledDsn, calledBody] = sendSpy.mock.calls[0] as [string, string];
    expect(calledDsn).toBe(SAAS_DSN);
    expect(calledBody).toContain('"type":"event"');

    const output = writes.join("");
    expect(output).toContain("Event dispatched");
    expect(output).toMatch(/[0-9a-f]{32}/); // event ID in output
  });

  test("--level flag is included in envelope body", async () => {
    const { ctx } = makeContext();
    await func.call(ctx, {
      dsn: SAAS_DSN,
      message: ["boom"],
      level: "fatal",
      "no-environ": true,
    });

    const body = sendSpy.mock.calls[0]?.[1] as string;
    expect(body).toContain('"level":"fatal"');
  });

  test("--tag pairs appear in envelope body", async () => {
    const { ctx } = makeContext();
    await func.call(ctx, {
      dsn: SAAS_DSN,
      message: ["hi"],
      tag: ["env:prod", "region:us"],
      "no-environ": true,
    });

    const body = sendSpy.mock.calls[0]?.[1] as string;
    expect(body).toContain('"env":"prod"');
    expect(body).toContain('"region":"us"');
  });

  test("missing DSN throws ConfigError", async () => {
    const savedDsn = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    const { ctx } = makeContext();
    try {
      await expect(func.call(ctx, { "no-environ": true })).rejects.toThrow();
    } finally {
      if (savedDsn !== undefined) process.env.SENTRY_DSN = savedDsn;
    }
  });

  test("--json outputs JSON with eventId field", async () => {
    const { ctx, writes } = makeContext();
    await func.call(ctx, {
      dsn: SAAS_DSN,
      message: ["hello"],
      json: true,
      "no-environ": true,
    });

    const output = writes.join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("eventId");
    expect(parsed.eventId).toMatch(/^[0-9a-f]{32}$/);
  });

  test("nonexistent file throws ValidationError (not raw stack trace)", async () => {
    const { ctx } = makeContext();

    await expect(
      func.call(
        ctx,
        { dsn: SAAS_DSN, "no-environ": true },
        "/nonexistent/missing.json"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("--raw requires file arguments", async () => {
    const { ctx } = makeContext();

    await expect(
      func.call(ctx, { dsn: SAAS_DSN, raw: true, "no-environ": true })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
