/**
 * Tests for `sentry snapshots upload`.
 *
 * Drives the command via its wrapper `loader()`. Org/project resolution, the
 * upload-options + create-snapshot API, and the objectstore HEAD/PUT primitives
 * are spied; image collection runs for real against PNG fixtures in a temp dir.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { uploadCommand } from "../../../src/commands/snapshots/upload.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as preprod from "../../../src/lib/api/preprod-artifacts.js";
import { ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as objectstore from "../../../src/lib/objectstore.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";

let tmpDir: string;

function createContext() {
  const writes: string[] = [];
  return {
    context: {
      stdout: {
        write: (data: string | Uint8Array) => {
          writes.push(
            typeof data === "string" ? data : new TextDecoder().decode(data)
          );
          return true;
        },
      },
      stderr: { write: () => true },
      cwd: tmpDir,
      env: {} as NodeJS.ProcessEnv,
      process: { ...process, exitCode: undefined } as typeof process,
    },
    output: () => writes.join(""),
    get exitCode() {
      return this.context.process.exitCode;
    },
  };
}

function pngBytes(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(0xff);
  return PNG.sync.write(png);
}

const UPLOAD_OPTIONS = {
  objectstore: {
    url: "https://os.example.com",
    scopes: [
      ["org", "1"],
      ["project", "2"],
    ] as [string, string][],
    authToken: "tok",
    expirationPolicy: "ttl:30d",
  },
};

describe("snapshots upload", () => {
  let existsSpy: ReturnType<typeof vi.spyOn>;
  let putSpy: ReturnType<typeof vi.spyOn>;
  let createSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "snap-up-"));
    vi.spyOn(resolveTarget, "resolveOrgAndProject").mockResolvedValue({
      org: "test-org",
      project: "test-project",
    });
    vi.spyOn(preprod, "fetchSnapshotsUploadOptions").mockResolvedValue(
      UPLOAD_OPTIONS
    );
    existsSpy = vi.spyOn(objectstore, "objectExists").mockResolvedValue(false);
    putSpy = vi.spyOn(objectstore, "putObject").mockResolvedValue(undefined);
    createSpy = vi.spyOn(preprod, "createPreprodSnapshot").mockResolvedValue({
      artifactId: "snap-1",
      imageCount: 2,
      snapshotUrl: "https://sentry.io/snap-1",
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Write a folder with two PNGs (one nested) + a sidecar; returns its path. */
  async function writeShots(): Promise<string> {
    const dir = join(tmpDir, "shots");
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "a.png"), pngBytes(4, 3));
    await writeFile(join(dir, "a.json"), JSON.stringify({ note: "hi" }));
    await writeFile(join(dir, "sub", "b.png"), pngBytes(2, 2));
    return dir;
  }

  test("uploads images and creates a snapshot with a correct manifest", async () => {
    const dir = await writeShots();
    const harness = createContext();
    const func = await uploadCommand.loader();

    await func.call(harness.context, { "app-id": "com.example.app" }, dir);

    // Two images uploaded (none pre-existing).
    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(createSpy).toHaveBeenCalledTimes(1);

    const [, , manifest] = createSpy.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(manifest.app_id).toBe("com.example.app");
    const images = manifest.images as Record<string, Record<string, unknown>>;
    expect(Object.keys(images).sort()).toEqual(["a.png", "sub/b.png"]);
    expect(images["a.png"]).toMatchObject({
      width: 4,
      height: 3,
      note: "hi",
    });
    expect(images["a.png"].content_hash).toMatch(/^[0-9a-f]{64}$/);
    // selective omitted when not requested.
    expect(manifest.selective).toBeUndefined();
    expect(harness.output()).toContain("snap-1");

    // The objectstore key is `{orgId}/{projectId}/{sha256}` from the scope.
    const hash = images["a.png"].content_hash as string;
    const key = putSpy.mock.calls.find(([, k]) =>
      (k as string).endsWith(hash)
    )?.[1] as string;
    expect(key).toMatch(/^1\/2\/[0-9a-f]{64}$/);
    expect(key.endsWith(hash)).toBe(true);
  });

  test("CLI width/height/content_hash override sidecar keys", async () => {
    const dir = join(tmpDir, "shots");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "a.png"), pngBytes(4, 3));
    await writeFile(
      join(dir, "a.json"),
      JSON.stringify({ width: 999, height: 888, content_hash: "nope", keep: 1 })
    );
    const harness = createContext();
    const func = await uploadCommand.loader();

    await func.call(harness.context, { "app-id": "app" }, dir);

    const [, , manifest] = createSpy.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    const entry = (manifest.images as Record<string, Record<string, unknown>>)[
      "a.png"
    ];
    expect(entry.width).toBe(4);
    expect(entry.height).toBe(3);
    expect(entry.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.keep).toBe(1);
  });

  test("rejects --pr-number without a resolvable base SHA", async () => {
    const dir = await writeShots();
    const func = await uploadCommand.loader();
    await expect(
      func.call(
        createContext().context,
        { "app-id": "app", "pr-number": 7 },
        dir
      )
    ).rejects.toThrow(ValidationError);
  });

  test("resolves a relative folder path against the command cwd", async () => {
    await writeShots(); // creates <cwd>/shots
    const harness = createContext(); // cwd === tmpDir
    const func = await uploadCommand.loader();

    await func.call(harness.context, { "app-id": "app" }, "shots");

    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  test("skips objects already present in objectstore", async () => {
    const dir = await writeShots();
    // First image already exists, second does not.
    existsSpy.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const harness = createContext();
    const func = await uploadCommand.loader();

    await func.call(harness.context, { "app-id": "app" }, dir);

    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  test("reports no images and creates nothing for an empty folder", async () => {
    const dir = join(tmpDir, "empty");
    await mkdir(dir);
    const harness = createContext();
    const func = await uploadCommand.loader();

    await func.call(harness.context, { "app-id": "app" }, dir);

    expect(createSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
    expect(harness.output()).toContain("No image files found");
  });

  test("rejects a path that is not a directory", async () => {
    const file = join(tmpDir, "a.png");
    await writeFile(file, pngBytes(1, 1));
    const func = await uploadCommand.loader();
    await expect(
      func.call(createContext().context, { "app-id": "app" }, file)
    ).rejects.toThrow(ValidationError);
  });

  test("marks selective + rejects images missing from --all-image-file-names", async () => {
    const dir = await writeShots();
    const func = await uploadCommand.loader();
    await expect(
      func.call(
        createContext().context,
        { "app-id": "app", "all-image-file-names": "a.png" },
        dir
      )
    ).rejects.toThrow(ValidationError);
  });

  test("passes diff-threshold and selective into the manifest", async () => {
    const dir = await writeShots();
    const harness = createContext();
    const func = await uploadCommand.loader();

    await func.call(
      harness.context,
      { "app-id": "app", "diff-threshold": 0.05, selective: true },
      dir
    );

    const [, , manifest] = createSpy.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(manifest.diff_threshold).toBe(0.05);
    expect(manifest.selective).toBe(true);
  });
});
