import { createFetchMock } from "miniflare";
import {
  registerFetchMockInterceptors,
  type FetchMockLike,
} from "./fetch-mock-setup";

export function createConfiguredFetchMock(): FetchMockLike {
  const fetchMock = createFetchMock() as FetchMockLike;
  fetchMock.disableNetConnect();
  registerFetchMockInterceptors(fetchMock);
  return fetchMock;
}
