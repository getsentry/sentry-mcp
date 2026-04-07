import { afterEach, beforeEach } from "vitest";
import { resetFetchMock, setupFetchMock } from "./fetch-mock-setup";

beforeEach(async () => {
  await setupFetchMock();
});

afterEach(async () => {
  await resetFetchMock();
});
