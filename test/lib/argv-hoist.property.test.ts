/**
 * Property-based tests for {@link hoistGlobalFlags}.
 *
 * These verify invariants that must hold for any valid input:
 * 1. Token conservation — no tokens added or dropped
 * 2. Order preservation — non-hoisted tokens keep their relative order
 * 3. Idempotency — hoisting twice gives the same result as hoisting once
 */

import { array, constantFrom, assert as fcAssert, property } from "fast-check";
import { describe, expect, test } from "vitest";
import { hoistGlobalFlags } from "../../src/lib/argv-hoist.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

/** Tokens that should be hoisted (global flags and their values) */
const GLOBAL_FLAG_TOKENS = [
  "--verbose",
  "--no-verbose",
  "--json",
  "--no-json",
  "-v",
  "--log-level",
  "--fields",
  "--org",
  "--project",
] as const;

/** Tokens that should never be hoisted */
const NON_GLOBAL_TOKENS = [
  "issue",
  "list",
  "view",
  "my-org/",
  "my-org/my-project",
  "123",
  "--limit",
  "25",
  "--sort",
  "date",
  "-x",
  "-h",
  "help",
  "cli",
  "upgrade",
  "api",
] as const;

/** All tokens mixed together (excluding -- separator, handled separately) */
const ALL_TOKENS = [...GLOBAL_FLAG_TOKENS, ...NON_GLOBAL_TOKENS] as const;

const nonGlobalTokenArb = constantFrom(...NON_GLOBAL_TOKENS);
const allTokenArb = constantFrom(...ALL_TOKENS);
const argvArb = array(allTokenArb, { minLength: 0, maxLength: 12 });

/**
 * Check if a token is a hoistable global flag or its negation/short form.
 * Must match the flag registry in argv-hoist.ts.
 */
const HOISTABLE_SET = new Set([
  "--verbose",
  "--no-verbose",
  "--json",
  "--no-json",
  "-v",
  "--log-level",
  "--fields",
  "--org",
  "--project",
]);

function isHoistableToken(token: string): boolean {
  return HOISTABLE_SET.has(token);
}

describe("property: hoistGlobalFlags", () => {
  test("token conservation: output contains exactly the same tokens as input", () => {
    fcAssert(
      property(argvArb, (argv) => {
        const result = hoistGlobalFlags(argv);
        expect([...result].sort()).toEqual([...argv].sort());
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("order preservation: non-hoistable tokens keep relative order", () => {
    const mixedArgvArb = array(
      constantFrom(
        "--verbose",
        "-v",
        "--json",
        "issue",
        "list",
        "my-org/",
        "--limit",
        "25",
        "cli",
        "upgrade"
      ),
      { minLength: 0, maxLength: 12 }
    );

    fcAssert(
      property(mixedArgvArb, (argv) => {
        const result = hoistGlobalFlags(argv);
        const nonHoisted = result.filter((t) => !isHoistableToken(t));
        const originalNonHoisted = argv.filter((t) => !isHoistableToken(t));
        expect(nonHoisted).toEqual(originalNonHoisted);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("idempotency: hoisting twice gives the same result as once", () => {
    fcAssert(
      property(argvArb, (argv) => {
        const once = hoistGlobalFlags(argv);
        const twice = hoistGlobalFlags(once);
        expect(twice).toEqual(once);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("hoisted tokens appear after all non-hoisted tokens", () => {
    /** Value-taking flags whose next token also gets hoisted */
    const VALUE_TAKING = new Set([
      "--log-level",
      "--fields",
      "--org",
      "--project",
    ]);

    fcAssert(
      property(argvArb, (argv) => {
        const result = hoistGlobalFlags(argv);
        // Find the index of the first hoisted token
        const firstHoistedIdx = result.findIndex((t) => isHoistableToken(t));
        if (firstHoistedIdx === -1) {
          return; // No hoistable tokens — nothing to check
        }
        // All tokens after the first hoisted token should be either:
        // (a) a hoistable flag, or (b) a value following a value-taking flag
        const tail = result.slice(firstHoistedIdx);
        let skipNext = false;
        for (const token of tail) {
          if (skipNext) {
            skipNext = false;
            continue;
          }
          if (isHoistableToken(token)) {
            // If it's a value-taking flag, skip the next token (its value)
            if (VALUE_TAKING.has(token)) {
              skipNext = true;
            }
            continue;
          }
          // Token is not hoistable — fail
          expect(token).toBe(
            `<expected hoistable token, got non-hoistable: ${token}>`
          );
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("no-op for argv with only non-global tokens", () => {
    const nonGlobalArgvArb = array(nonGlobalTokenArb, {
      minLength: 0,
      maxLength: 10,
    });
    fcAssert(
      property(nonGlobalArgvArb, (argv) => {
        expect(hoistGlobalFlags(argv)).toEqual(argv);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
