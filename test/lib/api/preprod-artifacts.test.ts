/**
 * Tests for the preprod-artifacts (mobile build) API.
 *
 * Pure URL helpers are tested directly. `getBuildInstallDetails` mocks the
 * region request layer; `downloadBuildArtifact` mocks `customFetch` and the
 * auth-token getter so the streaming write and — critically — the
 * same-origin-only auth attachment can be verified without a network.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, ValidationError } from "../../../src/lib/errors.js";

const {
  customFetchMock,
  apiRequestToRegionMock,
  apiRequestToRegionNoContentMock,
  getAuthTokenMock,
  uploadMissingBufferChunksMock,
} = vi.hoisted(() => ({
  customFetchMock: vi.fn(),
  apiRequestToRegionMock: vi.fn(),
  apiRequestToRegionNoContentMock: vi.fn(() => Promise.resolve()),
  getAuthTokenMock: vi.fn<() => string | undefined>(() => "secret-token"),
  uploadMissingBufferChunksMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../src/lib/region.js", () => ({
  resolveOrgRegion: vi.fn(async () => "https://us.sentry.io"),
}));
vi.mock("../../../src/lib/api/infrastructure.js", () => ({
  apiRequestToRegion: apiRequestToRegionMock,
  apiRequestToRegionNoContent: apiRequestToRegionNoContentMock,
}));
vi.mock("../../../src/lib/custom-ca.js", () => ({
  customFetch: customFetchMock,
}));
vi.mock("../../../src/lib/db/auth.js", () => ({
  getAuthToken: getAuthTokenMock,
}));
vi.mock("../../../src/lib/api/chunk-upload.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/lib/api/chunk-upload.js")
    >();
  return {
    ...actual,
    getChunkUploadOptions: vi.fn(async () => ({
      url: "https://us.sentry.io/api/0/chunk-upload/",
      chunkSize: 8192,
      chunksPerRequest: 64,
      maxRequestSize: 1_048_576,
      hashAlgorithm: "sha1",
      concurrency: 8,
      compression: ["gzip"],
    })),
    uploadMissingBufferChunks: uploadMissingBufferChunksMock,
  };
});

import {
  buildFormatFromUrl,
  createPreprodSnapshot,
  downloadBuildArtifact,
  fetchSnapshotsUploadOptions,
  getBuildInstallDetails,
  getLatestBaseSnapshot,
  LatestBaseSnapshotSchema,
  openSnapshotArchive,
  toBinaryDownloadUrl,
  uploadBuild,
  waitForSnapshotArchive,
} from "../../../src/lib/api/preprod-artifacts.js";

describe("toBinaryDownloadUrl", () => {
  test("rewrites a plist manifest URL to fetch the ipa binary", () => {
    expect(
      toBinaryDownloadUrl("https://us.sentry.io/dl/?response_format=plist")
    ).toBe("https://us.sentry.io/dl/?response_format=ipa");
  });

  test("leaves non-plist URLs unchanged", () => {
    expect(
      toBinaryDownloadUrl("https://us.sentry.io/dl/?response_format=apk")
    ).toBe("https://us.sentry.io/dl/?response_format=apk");
  });
});

describe("buildFormatFromUrl", () => {
  test("detects ipa", () => {
    expect(buildFormatFromUrl("https://x/?response_format=ipa")).toBe("ipa");
  });
  test("detects apk", () => {
    expect(buildFormatFromUrl("https://x/?response_format=apk")).toBe("apk");
  });
  test("throws on an unrecognized format", () => {
    expect(() => buildFormatFromUrl("https://x/?response_format=zip")).toThrow(
      ValidationError
    );
  });
});

describe("getBuildInstallDetails", () => {
  beforeEach(() => {
    apiRequestToRegionMock.mockReset();
  });

  test("hits the install-details endpoint and returns parsed data", async () => {
    apiRequestToRegionMock.mockResolvedValue({
      data: { isInstallable: true, installUrl: "https://u/" },
      headers: new Headers(),
    });

    const result = await getBuildInstallDetails("my-org", "build 1");

    expect(result).toEqual({ isInstallable: true, installUrl: "https://u/" });
    const lastCall = apiRequestToRegionMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("https://us.sentry.io");
    // Build id is URL-encoded into the path.
    expect(lastCall?.[1]).toBe(
      "organizations/my-org/preprodartifacts/build%201/install-details/"
    );
    expect(lastCall?.[2]?.schema).toBeDefined();
  });
});

describe("downloadBuildArtifact", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "preprod-dl-"));
    customFetchMock.mockReset();
    getAuthTokenMock.mockReturnValue("secret-token");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("streams the body to disk and attaches auth for a same-origin URL", async () => {
    customFetchMock.mockResolvedValue(
      new Response("FAKE-BINARY", { status: 200 })
    );
    const dest = join(tmpDir, "out.ipa");

    await downloadBuildArtifact(
      "https://us.sentry.io",
      "https://us.sentry.io/dl/?response_format=ipa",
      dest
    );

    expect(await readFile(dest, "utf8")).toBe("FAKE-BINARY");
    const init = customFetchMock.mock.calls.at(-1)?.[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe("Bearer secret-token");
  });

  test("does NOT attach the auth token to a cross-origin (signed) URL", async () => {
    customFetchMock.mockResolvedValue(new Response("X", { status: 200 }));

    await downloadBuildArtifact(
      "https://us.sentry.io",
      "https://cdn.example.com/blob?response_format=ipa",
      join(tmpDir, "o2.ipa")
    );

    const init = customFetchMock.mock.calls.at(-1)?.[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBeUndefined();
  });

  test("omits auth when no token is available", async () => {
    getAuthTokenMock.mockReturnValue(undefined);
    customFetchMock.mockResolvedValue(new Response("X", { status: 200 }));

    await downloadBuildArtifact(
      "https://us.sentry.io",
      "https://us.sentry.io/dl/?response_format=ipa",
      join(tmpDir, "o3.ipa")
    );

    const init = customFetchMock.mock.calls.at(-1)?.[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBeUndefined();
  });

  test("throws ApiError on a non-2xx response", async () => {
    customFetchMock.mockResolvedValue(
      new Response("nope", { status: 404, statusText: "Not Found" })
    );

    await expect(
      downloadBuildArtifact(
        "https://us.sentry.io",
        "https://us.sentry.io/dl/?response_format=ipa",
        join(tmpDir, "o4.ipa")
      )
    ).rejects.toThrow(ApiError);
  });
});

describe("uploadBuild", () => {
  const content = Buffer.from("normalized-build-zip-bytes");

  beforeEach(() => {
    apiRequestToRegionMock.mockReset();
    uploadMissingBufferChunksMock.mockClear();
  });

  test("returns the artifactUrl and folds metadata into the assemble body", async () => {
    apiRequestToRegionMock.mockResolvedValue({
      data: { state: "ok", artifactUrl: "https://sentry.io/artifact/1" },
      headers: new Headers(),
    });

    const url = await uploadBuild({
      org: "my-org",
      project: "my-project",
      content,
      metadata: {
        buildConfiguration: "Release",
        releaseNotes: "notes",
        installGroups: ["qa", "beta"],
      },
    });

    expect(url).toBe("https://sentry.io/artifact/1");
    const call = apiRequestToRegionMock.mock.calls.at(-1);
    expect(call?.[1]).toBe(
      "projects/my-org/my-project/files/preprodartifacts/assemble/"
    );
    const body = call?.[2]?.body as Record<string, unknown>;
    expect(body.checksum).toEqual(expect.any(String));
    expect(Array.isArray(body.chunks)).toBe(true);
    expect(body.build_configuration).toBe("Release");
    expect(body.release_notes).toBe("notes");
    expect(body.install_groups).toEqual(["qa", "beta"]);
    // No missing chunks on the first (and only) response.
    expect(uploadMissingBufferChunksMock).not.toHaveBeenCalled();
  });

  test("uploads missing chunks then returns the artifactUrl", async () => {
    vi.useFakeTimers();
    try {
      apiRequestToRegionMock
        .mockResolvedValueOnce({
          data: { state: "created", missingChunks: ["deadbeef"] },
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          data: { state: "ok", artifactUrl: "https://sentry.io/artifact/2" },
          headers: new Headers(),
        });

      const promise = uploadBuild({
        org: "my-org",
        project: "my-project",
        content,
        metadata: {},
      });
      // Advance past the inter-poll sleep so the second assemble POST runs.
      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe("https://sentry.io/artifact/2");
      expect(uploadMissingBufferChunksMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("flattens vcs fields into the top level of the assemble body", async () => {
    apiRequestToRegionMock.mockResolvedValue({
      data: { state: "ok", artifactUrl: "https://sentry.io/artifact/9" },
      headers: new Headers(),
    });

    await uploadBuild({
      org: "my-org",
      project: "my-project",
      content,
      metadata: { vcs: { head_sha: "abc", provider: "github", pr_number: 3 } },
    });

    const body = apiRequestToRegionMock.mock.calls.at(-1)?.[2]?.body as Record<
      string,
      unknown
    >;
    // Flattened alongside checksum/chunks — not nested under a "vcs" key.
    expect(body.head_sha).toBe("abc");
    expect(body.provider).toBe("github");
    expect(body.pr_number).toBe(3);
    expect(body).not.toHaveProperty("vcs");
  });

  test("omits optional metadata fields when unset", async () => {
    apiRequestToRegionMock.mockResolvedValue({
      data: { state: "ok", artifactUrl: "https://sentry.io/artifact/3" },
      headers: new Headers(),
    });

    await uploadBuild({
      org: "my-org",
      project: "my-project",
      content,
      metadata: {},
    });

    const body = apiRequestToRegionMock.mock.calls.at(-1)?.[2]?.body as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual(["checksum", "chunks"]);
  });

  test("throws ApiError when assembly reports an error", async () => {
    apiRequestToRegionMock.mockResolvedValue({
      data: { state: "error", detail: "bad build" },
      headers: new Headers(),
    });

    await expect(
      uploadBuild({
        org: "my-org",
        project: "my-project",
        content,
        metadata: {},
      })
    ).rejects.toThrow(ApiError);
  });

  test("fails fast when finished (ok) without an artifact URL", async () => {
    apiRequestToRegionMock.mockResolvedValue({
      data: { state: "ok" },
      headers: new Headers(),
    });

    await expect(
      uploadBuild({
        org: "my-org",
        project: "my-project",
        content,
        metadata: {},
      })
    ).rejects.toThrow(/no artifact URL/i);
  });
});

describe("snapshots", () => {
  beforeEach(() => {
    apiRequestToRegionMock.mockReset();
    apiRequestToRegionNoContentMock.mockClear();
    customFetchMock.mockReset();
  });

  test("LatestBaseSnapshotSchema expects snake_case (server contract)", () => {
    // The server returns snake_case; the schema must accept it and reject
    // camelCase, guarding against the C1 regression.
    expect(
      LatestBaseSnapshotSchema.safeParse({
        head_artifact_id: "art-1",
        image_count: 5,
      }).success
    ).toBe(true);
    expect(
      LatestBaseSnapshotSchema.safeParse({
        headArtifactId: "art-1",
        imageCount: 5,
      }).success
    ).toBe(false);
  });

  test("fetchSnapshotsUploadOptions hits the upload-options endpoint", async () => {
    apiRequestToRegionMock.mockResolvedValue({
      data: {
        objectstore: {
          url: "https://os.example.com",
          scopes: [["org", "1"]],
          authToken: "tok",
          expirationPolicy: "ttl:30d",
        },
      },
    });
    const opts = await fetchSnapshotsUploadOptions("my-org", "my-project");
    expect(opts.objectstore.url).toBe("https://os.example.com");
    const [, endpoint] = apiRequestToRegionMock.mock.calls.at(-1) ?? [];
    expect(endpoint).toBe(
      "projects/my-org/my-project/preprodartifacts/snapshots/upload-options/"
    );
  });

  test("createPreprodSnapshot POSTs the manifest and parses the response", async () => {
    apiRequestToRegionMock.mockResolvedValue({
      data: { artifactId: "snap-1", imageCount: 3, snapshotUrl: "https://s" },
    });
    const manifest = { app_id: "app", images: {} };
    const res = await createPreprodSnapshot("my-org", "my-project", manifest);
    expect(res.artifactId).toBe("snap-1");
    expect(res.imageCount).toBe(3);
    const [, endpoint, options] =
      apiRequestToRegionMock.mock.calls.at(-1) ?? [];
    expect(endpoint).toBe(
      "projects/my-org/my-project/preprodartifacts/snapshots/"
    );
    expect(options.method).toBe("POST");
    expect(options.body).toBe(manifest);
  });

  test("getLatestBaseSnapshot maps the response and forwards params", async () => {
    // apiRequestToRegion returns schema-validated snake_case data.
    apiRequestToRegionMock.mockResolvedValue({
      data: { head_artifact_id: "art-1", image_count: 5 },
      headers: new Headers(),
    });

    await expect(
      getLatestBaseSnapshot("my-org", "my-app", {
        branch: "main",
        project: "proj-1",
      })
    ).resolves.toEqual({ headArtifactId: "art-1", imageCount: 5 });
    // app_id + optional branch/project go through as query params.
    const params = apiRequestToRegionMock.mock.calls.at(-1)?.[2]?.params;
    expect(params).toEqual({
      app_id: "my-app",
      branch: "main",
      project: "proj-1",
    });
  });

  test("getLatestBaseSnapshot returns null on 404", async () => {
    apiRequestToRegionMock.mockRejectedValue(
      new ApiError("not found", 404, "", "endpoint")
    );
    await expect(
      getLatestBaseSnapshot("my-org", "missing")
    ).resolves.toBeNull();
  });

  test("waitForSnapshotArchive triggers a build then resolves when ready", async () => {
    apiRequestToRegionMock
      .mockResolvedValueOnce({ data: { ready: false }, headers: new Headers() })
      .mockResolvedValueOnce({ data: { ready: true }, headers: new Headers() });
    const onBuild = vi.fn();

    await waitForSnapshotArchive("my-org", "snap-1", onBuild);

    expect(apiRequestToRegionNoContentMock).toHaveBeenCalledTimes(1);
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  test("waitForSnapshotArchive skips the build when already ready", async () => {
    apiRequestToRegionMock.mockResolvedValue({
      data: { ready: true },
      headers: new Headers(),
    });
    const onBuild = vi.fn();

    await waitForSnapshotArchive("my-org", "snap-1", onBuild);

    expect(apiRequestToRegionNoContentMock).not.toHaveBeenCalled();
    expect(onBuild).not.toHaveBeenCalled();
  });

  test("openSnapshotArchive returns the response for streaming", async () => {
    const response = { ok: true, status: 200, body: {} };
    customFetchMock.mockResolvedValue(response);

    await expect(openSnapshotArchive("my-org", "snap-1")).resolves.toBe(
      response
    );
    // Auth token attached; URL targets the region archive endpoint.
    const [url, init] = customFetchMock.mock.calls.at(-1) ?? [];
    expect(url).toContain(
      "/preprodartifacts/snapshots/snap-1/archive/?download"
    );
    expect(init?.headers?.Authorization).toBe("Bearer secret-token");
  });

  test("openSnapshotArchive throws on a non-2xx response", async () => {
    customFetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
    });
    await expect(openSnapshotArchive("my-org", "snap-1")).rejects.toThrow(
      ApiError
    );
  });
});
