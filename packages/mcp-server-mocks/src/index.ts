import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const AutofixPayload = {
  autofix: {
    run_id: 21831,
    request: {
      project_id: 4505138086019073,
      issue: {
        id: 6507376925,
        title: "Error: Tool list_organizations is already registered",
        short_id: "REMOTE-MCP-41",
      },
    },
    status: "NEED_MORE_INFORMATION",
    updated_at: "2025-04-09T22:39:50.778146",
    steps: [
      {
        active_comment_thread: null,
        agent_comment_thread: null,
        completedMessage: null,
        id: "5c3238ea-4c3a-4c02-a94b-92a3ca25c946",
        index: 0,
        initial_memory_length: 1,
        insights: [
          {
            change_diff: null,
            generated_at_memory_index: 0,
            insight:
              "The `bottleById` query fails because the input ID (3216) doesn't exist in the database.\n",
            justification:
              'The exception details show that the `input` value at the time of the `TRPCError` in `bottleById.ts` was 3216, and the query likely failed because a bottle with ID 3216 was not found in the database.\n\n```\nVariable values at the time of the exception::\n{\n  "input": 3216\n}\n```\n',
            type: "insight",
          },
          {
            change_diff: null,
            generated_at_memory_index: 22,
            insight:
              "However, the request also includes a different ID (16720) for `bottlePriceList`.\n",
            justification:
              'The root cause is likely a mismatch of input IDs within the batched TRPC request, where `bottlePriceList` expects bottle ID 16720, but `bottleById` receives a different ID (3216) leading to the "Bottle not found" error.\n\n```\nGET http://api.peated.com/trpc/bottlePriceList,bottleById\n```\n\n```json\n{\n  "input": 3216\n}\n```\n\n```\nTRPCError: Bottle not found. (occurred in: GET /trpc/bottlePriceList,bottleById)\n```\n',
            type: "insight",
          },
          {
            change_diff: null,
            generated_at_memory_index: 22,
            insight:
              "This suggests a data consistency issue or incorrect client-side request.\n",
            justification:
              'The `TRPCError` originates from `bottleById.ts` with the input value being `3216`, indicating the procedure failed to find a bottle with that specific ID in the database.\n\n```\n <anonymous> in file /app/apps/server/src/trpc/routes/bottleById.ts [Line 33, column 13] (In app)\n      .select({\n        ...getTableColumns(bottles),\n      })\n      .from(bottleTombstones)\n      .innerJoin(bottles, eq(bottleTombstones.newBottleId, bottles.id))\n      .where(eq(bottleTombstones.bottleId, input));\n    if (!bottle) {\n      throw new TRPCError({  <-- SUSPECT LINE\n        message: "Bottle not found.",\n        code: "NOT_FOUND",\n      });\n    }\n  }\n\n  const createdBy = await db.query.users.findFirst({\n---\nVariable values at the time of the exception::\n{\n  "input": 3216\n}\n```\n',
            type: "insight",
          },
        ],
        key: "root_cause_analysis_processing",
        output_confidence_score: null,
        output_stream:
          "Let me summarize what I know about this issue:\n\n1. The error occurs in the `bottleById.ts` endpoint, with the error \"Bottle not found.\"\n2. The request is to `/trpc/bottlePriceList,bottleById` - which suggests that two TRPC procedures are being called in the same request.\n3. According to the error trace, the input ID is 16720, but the exception details show 3216 as the input value.\n4. The code in `bottleById.ts` tries to look up a bottle in two places:\n   - First in the main `bottles` table\n   - Then in the `bottleTombstones` table (which handles redirects for bottles that have been merged/moved)\n\nThe most significant clue is the discrepancy between the ID mentioned in the error (16720) and the ID in the exception details (3216). This suggests there's something fishy going on with how the IDs are being processed.\n\nGiven that the URL shows `bottlePriceList,bottleById`, this suggests a batched TRPC request where two procedures are being called simultaneously. The batched nature of TRPC calls might be relevant here.\n\nLet's think about potential root causes:\n\n1. **Data problem**: Neither bottle ID 16720 nor 3216 exists in the database.\n2. **Race condition**: The bottle might have been deleted between the two calls.\n3. **TRPC batching issue**: There might be a problem with how the batched request is handling the different IDs for the two procedures.\n4. **Input switching**: The ID is somehow being switched between the procedures.\n\nBased on the evidence, I think the most likely explanation is related to the TRPC batching. When the client makes a request to `/trpc/bottlePriceList,bottleById`, it's calling two procedures:\n- `bottlePriceList` with one ID (maybe 16720)\n- `bottleById` with another ID (3216)\n\nThe error is occurring in the `bottleById` procedure with ID 3216, but the overall request is being reported with ID 16720 (which might be from the `bottlePriceList` part of the batch).\n\nSince the exception is specifically coming from `bottleById.ts` with input 3216, the root cause is that there is no bottle with ID 3216 in the database (neither in `bottles` nor in `bottleTombstones`).\n\nThe confusing part is that the error message mentions 16720, which might be:\n1. A UI issue where the ID displayed doesn't match what's being requested\n2. A client-side issue where the wrong ID is being provided to `bottleById`\n3. A batching issue where the ID from one procedure is being displayed in the error for another\n\nGiven this analysis, the true root cause is: **The `bottleById` procedure is being called with ID 3216, but no bottle with that ID exists in the database.**\n\nThis is definitely a data consistency issue - either the bottle with ID 3216 was deleted without creating a tombstone, or the client is requesting a non-existent ID.# Root Cause Analysis: TRPCError: Bottle not found\n\nAfter examining all the available evidence, I can identify the true root cause of this issue:\n\n## Root Cause\n\n**The issue is related to a TRPC batch request inconsistency between the requested bottle ID and what's being processed.**\n\nThis conclusion is based on several key observations:\n\n1. The request is made to `/trpc/bottlePriceList,bottleById` - this is a batched TRPC request calling two procedures simultaneously.\n\n2. **Critical discrepancy**: The error message references bottle ID 16720, but the exception details show the procedure was actually processing ID 3216.\n\n3. Both procedures (`bottleById` and `bottlePriceList`) contain similar \"Bottle not found\" error checks, but the one that's triggering is in `bottleById.ts`.\n\n4. The `bottleById` procedure is attempting to find bottle ID 3216, not finding it in the main bottles table, then failing to find it in the tombstones table as well.\n\n## Detailed Explanation\n\nWhat's happening is:\n\n1. The client makes a batched request to both `bottlePriceList` and `bottleById` endpoints.\n\n2. Based on the URL and error, it appears that:\n   - The `bottlePriceList` procedure might be receiving ID 16720\n   - The `bottleById` procedure is receiving ID 3216\n\n3. When `bottleById` tries to process ID 3216, it can't find this bottle in the database or in tombstones, so it throws the \"Bottle not found\" error.\n\n4. The error reporting is showing the ID from the overall request (16720) while the actual failure is happening with a different ID (3216).\n\n## Why This Is Happening\n\nThis is likely either:\n\n1. **Client-side issue**: The client is passing the wrong ID to `bottleById` in the batched request\n2. **Data integrity issue**: Bottle ID 3216 may have been deleted without creating a tombstone entry\n3. **Parameter mixing**: The batched TRPC request might be incorrectly mapping parameters between the two procedures\n\nThe fact that two different IDs are involved (16720 and 3216) strongly suggests this is not a simple case of a missing bottle, but rather a data inconsistency or parameter handling issue in the batched request.\n\nTo fix this issue, you would need to:\n1. Check if bottle ID 3216 should exist in the database\n2. Verify how the client is forming the batched request and what IDs it's sending to each procedure\n3. Consider adding more detailed logging that shows the exact inputs to each procedure in batched requests",
        proceed_confidence_score: null,
        progress: [
          {
            data: null,
            message: "Figuring out the root cause...",
            timestamp: "2025-04-09T22:35:43.590244",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/trpc/routes/bottleById.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:35:52.808244",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/db/schema.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:36:14.424666",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Searching files with `find apps/server/src/db -type f -name "*.ts"`...',
            timestamp: "2025-04-09T22:36:16.500156",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/db/schema/index.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:36:18.687233",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/db/schema/bottles.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:36:21.205568",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/db/index.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:36:24.013172",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/db/schema/storePrices.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:36:27.236327",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/db/schema/stores.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:36:29.450102",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/db/schema/tastings.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:36:31.593538",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Searching for "Get information about the bottle price list controller or route that might be calling bottleById.ts"...',
            timestamp: "2025-04-09T22:36:34.373043",
            type: "INFO",
          },
          {
            data: null,
            message: "Simulating profound thought...",
            timestamp: "2025-04-09T22:36:56.212382",
            type: "INFO",
          },
          {
            data: null,
            message: "Arranging data in a way that looks intentional...",
            timestamp: "2025-04-09T22:37:33.353804",
            type: "INFO",
          },
        ],
        queued_user_messages: [],
        status: "COMPLETED",
        title: "Analyzing the Issue",
        type: "default",
      },
      {
        active_comment_thread: null,
        agent_comment_thread: null,
        causes: [
          {
            description:
              'Batched TRPC request incorrectly passed bottle ID 3216 to `bottleById`, instead of 16720, resulting in a "Bottle not found" error.',
            id: 0,
            root_cause_reproduction: [
              {
                code_snippet_and_analysis:
                  "This is the entry point where the client requests data from two different procedures in a single HTTP request. The server needs to correctly route and process the parameters for each procedure.",
                is_most_important_event: false,
                relevant_code_file: null,
                timeline_item_type: "human_action",
                title:
                  "The client initiates a batched TRPC request to the `/trpc/bottlePriceList,bottleById` endpoint, intending to fetch both the price list and details for a specific bottle.",
              },
              {
                code_snippet_and_analysis:
                  "```typescript\n// apps/server/src/trpc/routes/bottlePriceList.ts\n.input(z.object({ bottle: z.number(), onlyValid: z.boolean().optional() }))\n.query(async function ({ input, ctx }) {\n  const [bottle] = await db.select().from(bottles).where(eq(bottles.id, input.bottle));\n  if (!bottle) { ... }\n```\nThis procedure expects a 'bottle' parameter in the input, which is used to query the database.",
                is_most_important_event: false,
                relevant_code_file: {
                  file_path: "apps/server/src/trpc/routes/bottlePriceList.ts",
                  repo_name: "dcramer/peated",
                },
                timeline_item_type: "internal_code",
                title:
                  "The TRPC server receives the batched request and begins processing the `bottlePriceList` procedure, intending to fetch the price list for bottle ID 16720.",
              },
              {
                code_snippet_and_analysis:
                  "```typescript\n// apps/server/src/trpc/routes/bottleById.ts\nexport default publicProcedure.input(z.number()).query(async function ({ input, ctx }) {\n  let [bottle] = await db.select().from(bottles).where(eq(bottles.id, input));\n  if (!bottle) { ... }\n```\nThis procedure expects a numerical ID as input to find the bottle.",
                is_most_important_event: true,
                relevant_code_file: {
                  file_path: "apps/server/src/trpc/routes/bottleById.ts",
                  repo_name: "dcramer/peated",
                },
                timeline_item_type: "internal_code",
                title:
                  "The TRPC server also processes the `bottleById` procedure, but due to a parameter mapping issue or client-side error, it receives bottle ID 3216 as input instead of 16720.",
              },
              {
                code_snippet_and_analysis:
                  "The database query returns no results because bottle ID 3216 is not present in the `bottles` table.",
                is_most_important_event: false,
                relevant_code_file: {
                  file_path: "apps/server/src/trpc/routes/bottleById.ts",
                  repo_name: "dcramer/peated",
                },
                timeline_item_type: "external_system",
                title:
                  "The `bottleById` procedure queries the `bottles` table for a bottle with ID 3216, but no such bottle exists.",
              },
              {
                code_snippet_and_analysis:
                  "The query to `bottleTombstones` also returns no results, indicating that bottle ID 3216 has not been redirected.",
                is_most_important_event: false,
                relevant_code_file: {
                  file_path: "apps/server/src/trpc/routes/bottleById.ts",
                  repo_name: "dcramer/peated",
                },
                timeline_item_type: "external_system",
                title:
                  "The `bottleById` procedure then checks the `bottleTombstones` table to see if bottle ID 3216 has been tombstoned (redirected to a new ID), but no such tombstone exists.",
              },
              {
                code_snippet_and_analysis:
                  '```typescript\n// apps/server/src/trpc/routes/bottleById.ts\nif (!bottle) {\n  throw new TRPCError({ message: "Bottle not found.", code: "NOT_FOUND" });\n}\n```\nThis is where the error is thrown, indicating that the bottle could not be found.',
                is_most_important_event: false,
                relevant_code_file: {
                  file_path: "apps/server/src/trpc/routes/bottleById.ts",
                  repo_name: "dcramer/peated",
                },
                timeline_item_type: "internal_code",
                title:
                  'Since the `bottleById` procedure cannot find a bottle with ID 3216 in either the `bottles` or `bottleTombstones` tables, it throws a `TRPCError` with the message "Bottle not found."',
              },
            ],
          },
        ],
        completedMessage: null,
        id: "39166714-b14d-4fa0-a122-3ac241f7b46a",
        index: 1,
        key: "root_cause_analysis",
        output_confidence_score: 0.95,
        output_stream: null,
        proceed_confidence_score: 0.9,
        progress: [
          {
            data: null,
            message: "Here is Autofix's proposed root cause.",
            timestamp: "2025-04-09T22:37:40.934397",
            type: "INFO",
          },
        ],
        queued_user_messages: [],
        selection: { cause_id: 0, instruction: null },
        status: "COMPLETED",
        termination_reason: null,
        title: "Root Cause Analysis",
        type: "root_cause_analysis",
      },
      {
        active_comment_thread: null,
        agent_comment_thread: null,
        completedMessage: null,
        id: "649acf61-9922-4ac4-925d-9b73302ac8e9",
        index: 2,
        initial_memory_length: 5,
        insights: [
          {
            change_diff: null,
            generated_at_memory_index: 4,
            insight:
              "The discrepancy between inputs suggests a potential issue with batch request handling.\n",
            justification:
              'The `TRPCError` occurred in `bottleById.ts` with an input of `3216`, while the request was initiated with a bottle ID of `16720`, indicating a mismatch in the bottle ID being processed.\n\n```\nVariable values at the time of the exception::\n{\n  "input": 3216\n}\n```\n\n```\nGET http://api.peated.com/trpc/bottlePriceList,bottleById\n```\n',
            type: "insight",
          },
          {
            change_diff: null,
            generated_at_memory_index: 44,
            insight:
              "The client-side batch request construction is the most likely source of error.\n",
            justification:
              'The discrepancy between the bottle ID in the error message (16720) and the ID being processed (3216) strongly suggests a client-side parameter mapping issue in the batched TRPC request.\n\nTo fix this, I propose the following steps:\n\n1.  **Inspect the Client-Side Code:** Identify the code responsible for constructing the TRPC batch request to `/trpc/bottlePriceList,bottleById`.\n\n2.  **Verify Parameter Mapping:** Ensure that both `bottlePriceList` and `bottleById` are receiving the correct bottle ID (which should be 16720 in this case).\n\n3.  **Correct Parameter Assignment:** If the parameters are being incorrectly assigned, modify the client-side code to ensure that both procedures receive the same, correct bottle ID.\n\n4.  **Add Logging (Client-Side):** Add temporary logging to the client-side code to confirm the parameters being sent to each procedure in the batch request. This will help verify the fix.\n\n    ```typescript\n    // Example logging (add to the client-side code where the batch request is created)\n    console.log("bottlePriceList input:", { bottle: 16720 }); // Replace 16720 with the actual ID\n    console.log("bottleById input:", { bottle: 16720 }); // Replace 16720 with the actual ID\n    ```\n\n5.  **Test the Fix:** After applying the fix, test the affected functionality to ensure that the "Bottle not found" error is resolved and that both procedures are working correctly.\n\n6.  **Remove Logging:** Once the fix is verified, remove the temporary logging.\n\nThis approach directly addresses the most likely cause of the issue and provides a clear path to resolution.\n',
            type: "insight",
          },
          {
            change_diff: null,
            generated_at_memory_index: 44,
            insight:
              "Ensuring consistent bottle IDs will likely resolve this inconsistency.\n",
            justification:
              'The error message references bottle ID 16720, but the exception details show the procedure was actually processing ID 3216, indicating a parameter mismatch in the batch request.\n\nTo fix this, I recommend the following steps:\n\n1.  **Client-Side Investigation**:\n\n    *   Examine the client-side code where the TRPC batch request is constructed.\n    *   Verify that the same `bottleId` parameter is being passed to both `bottlePriceList` and `bottleById` procedures.\n    *   If the IDs are being passed correctly, inspect the network request payload to confirm the correct structure of the batched request.\n\n    ```typescript\n    // Example (Hypothetical) Client-Side Code\n    const bottleId = 16720; // Example bottle ID\n\n    // Ensure both procedures receive the same bottleId\n    const [priceList, bottleDetails] = await trpc.batch(() => [\n      trpc.bottlePriceList.fetch({ bottle: bottleId }),\n      trpc.bottleById.fetch(bottleId),\n    ]);\n    ```\n\n2.  **Server-Side Logging (Temporary)**:\n\n    *   Add temporary logging to both `bottlePriceList` and `bottleById` procedures to log the received `input` value.\n    *   This will help confirm whether the server is receiving the correct IDs from the client.\n    *   **Important**: Remove these logs after debugging to avoid unnecessary overhead.\n\n    ```typescript\n    // apps/server/src/trpc/routes/bottlePriceList.ts\n    export default publicProcedure\n      .input(\n        z.object({\n          bottle: z.number(),\n          onlyValid: z.boolean().optional(),\n        }),\n      )\n      .query(async function ({ input, ctx }) {\n        console.log("bottlePriceList input:", input); // Add this line\n        // ... rest of the code\n      });\n\n    // apps/server/src/trpc/routes/bottleById.ts\n    export default publicProcedure.input(z.number()).query(async function ({\n      input,\n      ctx,\n    }) {\n      console.log("bottleById input:", input); // Add this line\n      // ... rest of the code\n    });\n    ```\n\n3.  **TRPC Batch Request Configuration**:\n\n    *   Review the TRPC batch link configuration on the client-side.\n    *   Ensure that the batching logic is correctly mapping parameters to the corresponding procedures.\n    *   If using a custom batching implementation, verify its correctness.\n\n4.  **Data Integrity Check**:\n\n    *   If the client-side code appears correct, investigate whether bottle ID 3216 should exist in the database.\n    *   Check the `bottles` table and `bottleTombstones` table for any entries related to bottle ID 3216.\n    *   If the bottle should exist but is missing, investigate potential data deletion or migration issues.\n\n5.  **Tombstone Logic**:\n\n    *   Double-check the logic for creating and using tombstones.\n    *   Ensure that when a bottle is deleted, a tombstone entry is created correctly, pointing to the new bottle (if any).\n\n6.  **Error Handling**:\n\n    *   While this isn\'t the primary fix, consider improving the error message in `bottleById.ts` to include more context.\n    *   Include the original requested bottle ID (if available) in the error message to aid debugging.\n\n7.  **Client-Side Retries**:\n\n    *   Implement a retry mechanism on the client-side for TRPC requests.\n    *   If a "Bottle not found" error occurs, retry the request a few times before giving up. This can help mitigate transient issues.\n\nBy following these steps, you should be able to identify the root cause of the parameter mismatch and implement a fix that ensures consistent bottle IDs are passed to both TRPC procedures in the batch request.\n',
            type: "insight",
          },
        ],
        key: "solution_processing",
        output_confidence_score: null,
        output_stream:
          "Based on all the information I've gathered, I'm going to develop a clear fix for this issue. Let's summarize the core problem first:\n\n1. We have a TRPC batch request that calls both `bottlePriceList` and `bottleById` procedures in a single HTTP request.\n2. The error shows a discrepancy between the bottle ID in the error message (16720) and the ID being processed when the error occurred (3216).\n3. The `bottleById` procedure fails because it's trying to find bottle ID 3216, which doesn't exist in the database or in tombstones.\n\nThe most likely issue is a parameter mismatch in the batch TRPC request. When examining the client code and the trace, it seems like the client-side code is sending different bottle IDs to the two procedures incorrectly.\n\nLet's analyze the most probable causes and their solutions:\n\n1. **Client-side parameter mismatch**: The client might be configuring the batch request incorrectly, sending bottle ID 16720 to `bottlePriceList` and bottle ID 3216 to `bottleById`.\n\n2. **Server-side parameter confusion**: There could be some issue with how parameters are being mapped in batched TRPC requests on the server side.\n\n3. **Application-level logic issue**: The application might be assuming that both procedures should operate on the same bottle ID, but this assumption is being violated during batch requests.\n\nFrom the code snippets I've seen, the most likely issue is in the client-side code where the batch request is being constructed. The solution should ensure consistency in parameters across the batch request.\n\nSince we can see from traces that the client is attempting to fetch bottle details, and the frontend code shows that the `bottlePriceList` and `bottleById` are supposed to operate on the same bottle ID, I'm going to recommend a solution that ensures parameter consistency.\n\nThe most actionable and effective fix would be to ensure that both procedures receive the same bottle ID in the batch request. Let's outline that solution in detail:# Solution to Fix the \"Bottle not found\" TRPC Error\n\n## Root Cause\nThe issue stems from a parameter mismatch in TRPC batch requests. When a request is made to `/trpc/bottlePriceList,bottleById`, the procedures are receiving different bottle IDs:\n- `bottlePriceList` receives ID **16720**\n- `bottleById` receives ID **3216**\n\nThe error occurs because bottle ID **3216** doesn't exist in the database.\n\n## Solution Steps\n\n### 1. Fix the Client-Side Batch Request Configuration\n\nThe most direct solution is to ensure parameter consistency in the batch request. Based on the web app's bottle page implementation, both procedures should receive the same bottle ID.\n\n```typescript\n// In apps/web/src/app/(default)/bottles/[bottleId]/(tabs)/page.tsx\nexport default async function BottleDetails({\n  params: { bottleId },\n}: {\n  params: { bottleId: string };\n}) {\n  const trpcClient = await getTrpcClient();\n  \n  // PROBLEM: These are being called separately, potentially with different batching behavior\n  const bottle = await trpcClient.bottleById.fetch(Number(bottleId));\n  \n  // ...rest of the function\n}\n\n// In apps/web/src/app/(default)/bottles/[bottleId]/(tabs)/prices/page.tsx\nexport default async function BottlePrices({\n  params: { bottleId },\n}: {\n  params: { bottleId: string };\n}) {\n  const trpcClient = await getTrpcClient();\n  const priceList = await trpcClient.bottlePriceList.fetch({\n    bottle: Number(bottleId),\n  });\n  \n  // ...rest of the function\n}\n```\n\n### 2. Implement Proper Error Handling for Missing Bottles\n\nAdd graceful handling when a bottle isn't found, especially in the context of batch requests:\n\n```typescript\n// In apps/server/src/trpc/routes/bottleById.ts\nexport default publicProcedure.input(z.number()).query(async function ({\n  input,\n  ctx,\n}) {\n  try {\n    let [bottle] = await db.select().from(bottles).where(eq(bottles.id, input));\n\n    if (!bottle) {\n      // check for a tombstone\n      [bottle] = await db\n        .select({\n          ...getTableColumns(bottles),\n        })\n        .from(bottleTombstones)\n        .innerJoin(bottles, eq(bottleTombstones.newBottleId, bottles.id))\n        .where(eq(bottleTombstones.bottleId, input));\n      if (!bottle) {\n        throw new TRPCError({\n          message: `Bottle not found with ID: ${input}`,  // Include ID in error for better debugging\n          code: \"NOT_FOUND\",\n        });\n      }\n    }\n    \n    // Rest of the function...\n  } catch (error) {\n    // Log the error with context\n    console.error(`Error fetching bottle ID ${input}:`, error);\n    throw error;\n  }\n});\n```\n\n### 3. Update the Batch Request Implementation to Ensure Parameter Consistency\n\nThe most thorough solution is to modify how pages that need both bottle details and price data fetch their information:\n\n```typescript\n// In a shared utility function or component\nexport async function getBottleWithPrices(bottleId: number) {\n  const trpcClient = await getTrpcClient();\n  \n  // Use Promise.all to ensure both requests are part of the same batch\n  // and receive the same parameters\n  const [bottle, priceList] = await Promise.all([\n    trpcClient.bottleById.fetch(bottleId),\n    trpcClient.bottlePriceList.fetch({ bottle: bottleId }),\n  ]);\n  \n  return { bottle, priceList };\n}\n\n// Then in the page components:\nconst { bottle, priceList } = await getBottleWithPrices(Number(bottleId));\n```\n\n### 4. Add Debugging to TRPC Batch Requests\n\nTo prevent similar issues in the future, add better logging for TRPC batch requests:\n\n```typescript\n// In apps/server/src/trpc/index.ts\nexport const publicProcedure = t.procedure.use(sentryMiddleware).use(\n  t.middleware(async ({ ctx, next, path, input }) => {\n    // Log the procedure name and input for debugging\n    console.log(`TRPC procedure: ${path}, input:`, input);\n    \n    return next({\n      ctx,\n    });\n  })\n);\n```\n\n## Implementation Priority\n\n1. **First implement solution #3** - Update how batch requests are made to ensure parameter consistency\n2. **Then implement solution #2** - Improve error messaging and handling\n3. **Consider solution #4** for monitoring and preventing future issues\n\nThis approach addresses the immediate problem while also improving the robustness of the application against similar issues in the future.",
        proceed_confidence_score: null,
        progress: [
          {
            data: null,
            message: "Figuring out a solution...",
            timestamp: "2025-04-09T22:37:41.090125",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/db/schema.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:37:58.226774",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Searching files with `find . -name "schema.ts" -o -name "*schema*.ts"`...',
            timestamp: "2025-04-09T22:38:06.650338",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Searching for "database schema definition for bottles and bottleTombstones"...',
            timestamp: "2025-04-09T22:38:09.204410",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/db/schema/storePrices.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:38:12.727565",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Searching for "database schema for storePrices and externalSites"...',
            timestamp: "2025-04-09T22:38:14.892955",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Searching for "schema definition for storePrices table"...',
            timestamp: "2025-04-09T22:38:18.078667",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Grepping codebase with `grep -r "public_trpc" --include="*.ts" --include="*.tsx"`...',
            timestamp: "2025-04-09T22:38:22.072610",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Grepping codebase with `grep -r "createTRPCRouter" --include="*.ts" --include="*.tsx"`...',
            timestamp: "2025-04-09T22:38:24.640654",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Searching for "TRPC router definition or main TRPC setup"...',
            timestamp: "2025-04-09T22:38:27.296050",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/trpc/index.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:38:31.342500",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Grepping codebase with `grep -r "SELECT.*FROM bottle" --include="*.ts" --include="*.tsx"`...',
            timestamp: "2025-04-09T22:38:33.896598",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/web/src/routes/[regionSlug]/[...bottleSlug].tsx` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:38:36.691936",
            type: "INFO",
          },
          {
            data: null,
            message:
              'Searching files with `find . -path "*bottle*" -name "*.tsx"`...',
            timestamp: "2025-04-09T22:38:39.431421",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/web/src/app/(default)/bottles/[bottleId]/(tabs)/prices/page.tsx` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:38:43.030734",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/web/src/app/(default)/bottles/[bottleId]/(tabs)/page.tsx` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:38:45.535641",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/web/src/lib/trpc/client.server.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:38:48.766893",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/trpc/links.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:38:51.786534",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Looking at `apps/server/src/trpc/context.ts` in `dcramer/peated`...",
            timestamp: "2025-04-09T22:38:54.281514",
            type: "INFO",
          },
          {
            data: null,
            message:
              "Studying spans under `http.server - GET /trpc/bottlePriceList,bottleById`...",
            timestamp: "2025-04-09T22:39:00.325683",
            type: "INFO",
          },
          {
            data: null,
            message: "Being artificially intelligent...",
            timestamp: "2025-04-09T22:39:19.353863",
            type: "INFO",
          },
          {
            data: null,
            message: "Formatting for human consumption...",
            timestamp: "2025-04-09T22:39:47.228661",
            type: "INFO",
          },
        ],
        queued_user_messages: [],
        status: "COMPLETED",
        title: "Planning Solution",
        type: "default",
      },
      {
        active_comment_thread: null,
        agent_comment_thread: null,
        completedMessage: null,
        custom_solution: null,
        description:
          "Consolidate bottle and price data fetching into a single batched TRPC request using `Promise.all` to ensure ID consistency.",
        id: "87ba0ee3-af4e-458e-b3a9-6fd5f9d4a471",
        index: 3,
        key: "solution",
        output_confidence_score: null,
        output_stream: null,
        proceed_confidence_score: null,
        progress: [
          {
            data: null,
            message: "Here is Autofix's proposed solution.",
            timestamp: "2025-04-09T22:39:50.191715",
            type: "INFO",
          },
        ],
        queued_user_messages: [],
        selected_mode: null,
        solution: [
          {
            code_snippet_and_analysis:
              "```typescript\n// In a shared utility function or component\nexport async function getBottleWithPrices(bottleId: number) {\n  const trpcClient = await getTrpcClient();\n  \n  // Use Promise.all to ensure both requests are part of the same batch\n  // and receive the same parameters\n  const [bottle, priceList] = await Promise.all([\n    trpcClient.bottleById.fetch(bottleId),\n    trpcClient.bottlePriceList.fetch({ bottle: bottleId }),\n  ]);\n  \n  return { bottle, priceList };\n}\n```\nThis code creates a function that uses `Promise.all` to fetch both bottle details and price data concurrently. This ensures that both TRPC procedures are part of the same batch and receive the same `bottleId`.",
            is_active: true,
            is_most_important_event: true,
            relevant_code_file: null,
            timeline_item_type: "internal_code",
            title:
              "Create a shared utility function to fetch bottle details and price data together.",
          },
          {
            code_snippet_and_analysis:
              "```typescript\n// Then in the page components:\nconst { bottle, priceList } = await getBottleWithPrices(Number(bottleId));\n```\nThis code replaces the separate calls to `bottleById` and `bottlePriceList` with a single call to the `getBottleWithPrices` function, ensuring that both components receive data for the same bottle.",
            is_active: true,
            is_most_important_event: false,
            relevant_code_file: null,
            timeline_item_type: "internal_code",
            title:
              "Modify the page components to use the shared utility function.",
          },
          {
            code_snippet_and_analysis: null,
            is_active: false,
            is_most_important_event: false,
            relevant_code_file: null,
            timeline_item_type: "repro_test",
            title: "Add a unit test that reproduces the issue.",
          },
        ],
        solution_selected: false,
        status: "COMPLETED",
        title: "Solution",
        type: "solution",
      },
    ],
  },
};

const TagsPayload = [
  { key: "transaction", name: "Transaction", totalValues: 1080 },
  { key: "runtime.name", name: "Runtime.Name", totalValues: 1080 },
  { key: "level", name: "Level", totalValues: 1144 },
  { key: "device", name: "Device", totalValues: 25 },
  { key: "os", name: "OS", totalValues: 1133 },
  { key: "user", name: "User", totalValues: 1080 },
  { key: "runtime", name: "Runtime", totalValues: 1080 },
  { key: "release", name: "Release", totalValues: 1135 },
  { key: "url", name: "URL", totalValues: 1080 },
  { key: "uptime_rule", name: "Uptime Rule", totalValues: 9 },
  { key: "server_name", name: "Server", totalValues: 1080 },
  { key: "browser", name: "Browser", totalValues: 56 },
  { key: "os.name", name: "Os.Name", totalValues: 1135 },
  { key: "device.family", name: "Device.Family", totalValues: 25 },
  { key: "replayId", name: "Replayid", totalValues: 55 },
  { key: "client_os.name", name: "Client Os.Name", totalValues: 1 },
  { key: "environment", name: "Environment", totalValues: 1144 },
  { key: "service", name: "Service", totalValues: 1135 },
  { key: "browser.name", name: "Browser.Name", totalValues: 56 },
];

const ReleasePayload = {
  id: 1402755016,
  version: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
  status: "open",
  shortVersion: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
  versionInfo: {
    package: null,
    version: { raw: "8ce89484-0fec-4913-a2cd-e8e2d41dee36" },
    description: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
    buildHash: null,
  },
  ref: null,
  url: null,
  dateReleased: null,
  dateCreated: "2025-04-13T19:54:21.764000Z",
  data: {},
  newGroups: 0,
  owner: null,
  commitCount: 0,
  lastCommit: null,
  deployCount: 0,
  lastDeploy: null,
  authors: [],
  projects: [
    {
      id: 4509062593708032,
      slug: "cloudflare-mcp",
      name: "cloudflare-mcp",
      newGroups: 0,
      platform: "bun",
      platforms: ["javascript"],
      hasHealthData: false,
    },
  ],
  firstEvent: "2025-04-13T19:54:21Z",
  lastEvent: "2025-04-13T20:28:23Z",
  currentProjectMeta: {},
  userAgent: null,
};

const ClientKeyPayload = {
  id: "d20df0a1ab5031c7f3c7edca9c02814d",
  name: "Default",
  label: "Default",
  public: "d20df0a1ab5031c7f3c7edca9c02814d",
  secret: "154001fd3dfe38130e1c7948a323fad8",
  projectId: 4509109104082945,
  isActive: true,
  rateLimit: null,
  dsn: {
    secret:
      "https://d20df0a1ab5031c7f3c7edca9c02814d:154001fd3dfe38130e1c7948a323fad8@o4509106732793856.ingest.us.sentry.io/4509109104082945",
    public:
      "https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945",
    csp: "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/csp-report/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
    security:
      "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/security/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
    minidump:
      "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/minidump/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
    nel: "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/nel/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
    unreal:
      "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/unreal/d20df0a1ab5031c7f3c7edca9c02814d/",
    crons:
      "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/cron/___MONITOR_SLUG___/d20df0a1ab5031c7f3c7edca9c02814d/",
    cdn: "https://js.sentry-cdn.com/d20df0a1ab5031c7f3c7edca9c02814d.min.js",
  },
  browserSdkVersion: "8.x",
  browserSdk: {
    choices: [
      ["9.x", "9.x"],
      ["8.x", "8.x"],
      ["7.x", "7.x"],
    ],
  },
  dateCreated: "2025-04-07T00:12:25.139394Z",
  dynamicSdkLoaderOptions: {
    hasReplay: true,
    hasPerformance: true,
    hasDebug: false,
  },
};

const IssuePayload = {
  id: "6507376925",
  shareId: null,
  shortId: "CLOUDFLARE-MCP-41",
  title: "Error: Tool list_organizations is already registered",
  culprit: "Object.fetch(index)",
  permalink: "https://sentry-mcp-evals.sentry.io/issues/6507376925/",
  logger: null,
  level: "error",
  status: "unresolved",
  statusDetails: {},
  substatus: "ongoing",
  isPublic: false,
  platform: "javascript",
  project: {
    id: "4509062593708032",
    name: "CLOUDFLARE-MCP",
    slug: "CLOUDFLARE-MCP",
    platform: "bun",
  },
  type: "error",
  metadata: {
    value: "Tool list_organizations is already registered",
    type: "Error",
    filename: "index.js",
    function: "Object.fetch",
    in_app_frame_mix: "in-app-only",
    sdk: {
      name: "sentry.javascript.cloudflare",
      name_normalized: "sentry.javascript.cloudflare",
    },
    severity: 0.0,
    severity_reason: "ml",
    initial_priority: 50,
    title: null,
  },
  numComments: 0,
  assignedTo: null,
  isBookmarked: false,
  isSubscribed: false,
  subscriptionDetails: null,
  hasSeen: true,
  annotations: [],
  issueType: "error",
  issueCategory: "error",
  priority: "medium",
  priorityLockedAt: null,
  isUnhandled: true,
  count: "25",
  userCount: 1,
  firstSeen: "2025-04-03T22:51:19.403000Z",
  lastSeen: "2025-04-12T11:34:11Z",
  firstRelease: null,
  lastRelease: null,
  tags: [
    { key: "environment", name: "Environment", totalValues: 25 },
    { key: "handled", name: "Handled", totalValues: 25 },
    { key: "level", name: "Level", totalValues: 25 },
    { key: "mechanism", name: "Mechanism", totalValues: 25 },
    { key: "runtime.name", name: "Runtime.Name", totalValues: 25 },
    { key: "url", name: "URL", totalValues: 25 },
    { key: "user", name: "User", totalValues: 25 },
  ],
  activity: [
    {
      id: "4633815464",
      user: null,
      type: "auto_set_ongoing",
      data: { after_days: 7 },
      dateCreated: "2025-04-10T22:55:22.411699Z",
    },
    {
      id: "0",
      user: null,
      type: "first_seen",
      data: { priority: "medium" },
      dateCreated: "2025-04-03T22:51:19.403000Z",
    },
  ],
  openPeriods: [
    {
      start: "2025-04-03T22:51:19.403000Z",
      end: null,
      duration: null,
      isOpen: true,
      lastChecked: "2025-04-12T11:34:11.310000Z",
    },
  ],
  seenBy: [
    {
      id: "1",
      name: "David Cramer",
      username: "david@example.com",
      email: "david@example.com",
      avatarUrl: null,
      isActive: true,
      hasPasswordAuth: true,
      isManaged: false,
      dateJoined: "2012-01-14T22:08:29.270831Z",
      lastLogin: "2025-04-13T14:00:11.516852Z",
      has2fa: true,
      lastActive: "2025-04-13T18:10:49.177605Z",
      isSuperuser: true,
      isStaff: true,
      experiments: {},
      emails: [{ id: "87429", email: "david@example.com", is_verified: true }],
      options: {
        theme: "light",
        language: "en",
        stacktraceOrder: 2,
        defaultIssueEvent: "recommended",
        timezone: "US/Pacific",
        clock24Hours: false,
      },
      flags: { newsletter_consent_prompt: false },
      avatar: {
        avatarType: "upload",
        avatarUuid: "51e63edabf31412aa2a955e9cf2c1ca0",
        avatarUrl: "https://sentry.io/avatar/51e63edabf31412aa2a955e9cf2c1ca0/",
      },
      identities: [],
      lastSeen: "2025-04-08T23:15:26.569455Z",
    },
  ],
  pluginActions: [],
  pluginIssues: [],
  pluginContexts: [],
  userReportCount: 0,
  stats: {
    "24h": [
      [1744480800, 0],
      [1744484400, 0],
      [1744488000, 0],
      [1744491600, 0],
      [1744495200, 0],
      [1744498800, 0],
      [1744502400, 0],
      [1744506000, 0],
      [1744509600, 0],
      [1744513200, 0],
      [1744516800, 0],
      [1744520400, 0],
      [1744524000, 0],
      [1744527600, 0],
      [1744531200, 0],
      [1744534800, 0],
      [1744538400, 0],
      [1744542000, 0],
      [1744545600, 0],
      [1744549200, 0],
      [1744552800, 0],
      [1744556400, 0],
      [1744560000, 0],
      [1744563600, 0],
      [1744567200, 0],
    ],
    "30d": [
      [1741910400, 0],
      [1741996800, 0],
      [1742083200, 0],
      [1742169600, 0],
      [1742256000, 0],
      [1742342400, 0],
      [1742428800, 0],
      [1742515200, 0],
      [1742601600, 0],
      [1742688000, 0],
      [1742774400, 0],
      [1742860800, 0],
      [1742947200, 0],
      [1743033600, 0],
      [1743120000, 0],
      [1743206400, 0],
      [1743292800, 0],
      [1743379200, 0],
      [1743465600, 0],
      [1743552000, 0],
      [1743638400, 1],
      [1743724800, 0],
      [1743811200, 0],
      [1743897600, 0],
      [1743984000, 0],
      [1744070400, 20],
      [1744156800, 1],
      [1744243200, 1],
      [1744329600, 0],
      [1744416000, 2],
      [1744502400, 0],
    ],
  },
  participants: [],
};

// a newer issue, seen less recently
const IssuePayload2 = {
  ...IssuePayload,
  id: 6507376926,
  shortId: "CLOUDFLARE-MCP-42",
  count: 1,
  title: "Error: Tool list_issues is already registered",
  firstSeen: "2025-04-11T22:51:19.403000Z",
  lastSeen: "2025-04-12T11:34:11Z",
};

const EventPayload = {
  id: "7ca573c0f4814912aaa9bdc77d1a7d51",
  groupID: "6507376925",
  eventID: "7ca573c0f4814912aaa9bdc77d1a7d51",
  projectID: "4509062593708032",
  size: 5891,
  entries: [
    {
      data: {
        values: [
          {
            type: "Error",
            value: "Tool list_organizations is already registered",
            mechanism: { type: "cloudflare", handled: false },
            threadId: null,
            module: null,
            stacktrace: {
              frames: [
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: null,
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 7809,
                  colNo: 27,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: "OAuthProviderImpl.fetch",
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 8029,
                  colNo: 24,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: "Object.fetch",
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 19631,
                  colNo: 28,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
              ],
              framesOmitted: null,
              registers: null,
              hasSystemFrames: true,
            },
            rawStacktrace: {
              frames: [
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: null,
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 7809,
                  colNo: 27,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: "OAuthProviderImpl.fetch",
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 8029,
                  colNo: 24,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: "Object.fetch",
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 19631,
                  colNo: 28,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
              ],
              framesOmitted: null,
              registers: null,
              hasSystemFrames: true,
            },
          },
        ],
        hasSystemFrames: true,
        excOmitted: null,
      },
      type: "exception",
    },
    {
      data: {
        apiTarget: null,
        method: "GET",
        url: "https://mcp.sentry.dev/sse",
        query: [],
        fragment: null,
        data: null,
        headers: [
          ["Accept", "text/event-stream"],
          ["Accept-Encoding", "gzip, br"],
          ["Accept-Language", "*"],
          ["Authorization", "[Filtered]"],
          ["Cache-Control", "no-cache"],
          ["Cf-Ipcountry", "GB"],
          ["Cf-Ray", "92d4c7266c8f48c9"],
          ["Cf-Visitor", '{"scheme":"https"}'],
          ["Connection", "Keep-Alive"],
          ["Host", "mcp.sentry.dev"],
          ["Pragma", "no-cache"],
          ["Sec-Fetch-Mode", "cors"],
          ["User-Agent", "node"],
          ["X-Forwarded-Proto", "https"],
        ],
        cookies: [],
        env: null,
        inferredContentType: null,
      },
      type: "request",
    },
  ],
  dist: null,
  message: "",
  title: "Error: Tool list_organizations is already registered",
  location: "index.js",
  user: {
    id: null,
    email: null,
    username: null,
    ip_address: "2a06:98c0:3600::103",
    name: null,
    geo: { country_code: "US", region: "United States" },
    data: null,
  },
  contexts: {
    cloud_resource: { "cloud.provider": "cloudflare", type: "default" },
    culture: { timezone: "Europe/London", type: "default" },
    runtime: { name: "cloudflare", type: "runtime" },
    trace: {
      trace_id: "3032af8bcdfe4423b937fc5c041d5d82",
      span_id: "953da703d2a6f4c7",
      status: "unknown",
      client_sample_rate: 1.0,
      sampled: true,
      type: "trace",
    },
  },
  sdk: { name: "sentry.javascript.cloudflare", version: "9.12.0" },
  context: {},
  packages: {},
  type: "error",
  metadata: {
    filename: "index.js",
    function: "Object.fetch",
    in_app_frame_mix: "in-app-only",
    type: "Error",
    value: "Tool list_organizations is already registered",
  },
  tags: [
    { key: "environment", value: "development" },
    { key: "handled", value: "no" },
    { key: "level", value: "error" },
    { key: "mechanism", value: "cloudflare" },
    { key: "runtime.name", value: "cloudflare" },
    { key: "url", value: "https://mcp.sentry.dev/sse" },
  ],
  platform: "javascript",
  dateReceived: "2025-04-08T21:15:04.700878Z",
  errors: [
    {
      type: "js_no_source",
      message: "Source code was not found",
      data: { symbolicator_type: "missing_source", url: "/index.js" },
    },
  ],
  occurrence: null,
  _meta: {
    entries: {
      "1": {
        data: {
          "": null,
          apiTarget: null,
          method: null,
          url: null,
          query: null,
          data: null,
          headers: {
            "3": {
              "1": {
                "": {
                  rem: [["@password:filter", "s", 0, 10]],
                  len: 64,
                  chunks: [
                    {
                      type: "redaction",
                      text: "[Filtered]",
                      rule_id: "@password:filter",
                      remark: "s",
                    },
                  ],
                },
              },
            },
          },
          cookies: null,
          env: null,
        },
      },
    },
    message: null,
    user: null,
    contexts: null,
    sdk: null,
    context: null,
    packages: null,
    tags: {},
  },
  crashFile: null,
  culprit: "Object.fetch(index)",
  dateCreated: "2025-04-08T21:15:04Z",
  fingerprints: ["60d1c667b173018c004e399b29dc927d"],
  groupingConfig: {
    enhancements: "KLUv_SAYwQAAkwKRs25ld3N0eWxlOjIwMjMtMDEtMTGQ",
    id: "newstyle:2023-01-11",
  },
  release: null,
  userReport: null,
  sdkUpdates: [],
  resolvedWith: [null],
  nextEventID: null,
  previousEventID: "b7ed18493f4f4817a217b03839d4c017",
};

const EventsErrorsMeta = {
  fields: {
    "issue.id": "integer",
    title: "string",
    project: "string",
    "count()": "integer",
    "last_seen()": "date",
  },
  units: {
    "issue.id": null,
    title: null,
    project: null,
    "count()": null,
    "last_seen()": null,
  },
  isMetricsData: false,
  isMetricsExtractedData: false,
  tips: { query: null, columns: null },
  datasetReason: "unchanged",
  dataset: "errors",
};

const EmptyEventsErrorsPayload = {
  data: [],
  meta: EventsErrorsMeta,
};

const EventsErrorsPayload = {
  data: [
    {
      "issue.id": 6114575469,
      title: "Error: Tool list_organizations is already registered",
      project: "test-suite",
      "count()": 2,
      "last_seen()": "2025-04-07T12:23:39+00:00",
      issue: "CLOUDFLARE-MCP-41",
    },
  ],
  meta: EventsErrorsMeta,
};

const EventsSpansMeta = {
  fields: {
    id: "string",
    "span.op": "string",
    "span.description": "string",
    "span.duration": "duration",
    transaction: "string",
    timestamp: "string",
    is_transaction: "boolean",
    project: "string",
    trace: "string",
    "transaction.span_id": "string",
    "project.name": "string",
  },
  units: {
    id: null,
    "span.op": null,
    "span.description": null,
    "span.duration": "millisecond",
    transaction: null,
    timestamp: null,
    is_transaction: null,
    project: null,
    trace: null,
    "transaction.span_id": null,
    "project.name": null,
  },
  isMetricsData: false,
  isMetricsExtractedData: false,
  tips: {},
  datasetReason: "unchanged",
  dataset: "spans",
  dataScanned: "full",
  accuracy: {
    confidence: [
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
    ],
  },
};

const EmptyEventsSpansPayload = {
  data: [],
  meta: EventsSpansMeta,
};

const EventsSpansPayload = {
  data: [
    {
      id: "07752c6aeb027c8f",
      "span.op": "http.server",
      "span.description": "GET /trpc/bottleList",
      "span.duration": 12.0,
      transaction: "GET /trpc/bottleList",
      timestamp: "2025-04-13T14:19:18+00:00",
      is_transaction: true,
      project: "peated",
      trace: "6a477f5b0f31ef7b6b9b5e1dea66c91d",
      "transaction.span_id": "07752c6aeb027c8f",
      "project.name": "peated",
    },
    {
      id: "7ab5edf5b3ba42c9",
      "span.op": "http.server",
      "span.description": "GET /trpc/bottleList",
      "span.duration": 18.0,
      transaction: "GET /trpc/bottleList",
      timestamp: "2025-04-13T14:19:17+00:00",
      is_transaction: true,
      project: "peated",
      trace: "54177131c7b192a446124daba3136045",
      "transaction.span_id": "7ab5edf5b3ba42c9",
      "project.name": "peated",
    },
  ],
  meta: EventsSpansMeta,
  confidence: [
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
  ],
};

export const restHandlers = [
  http.get("https://sentry.io/api/0/organizations/", () => {
    return HttpResponse.json([
      {
        id: "4509106740723712",
        slug: "sentry-mcp-evals",
        name: "sentry-mcp-evals",
      },
    ]);
  }),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
    () => {
      return HttpResponse.json([
        {
          id: "4509106740854784",
          slug: "the-goats",
          name: "the-goats",
          dateCreated: "2025-04-06T14:11:23.961739Z",
          isMember: true,
          teamRole: "admin",
          flags: { "idp:provisioned": false },
          access: [
            "team:read",
            "alerts:read",
            "event:write",
            "team:write",
            "team:admin",
            "event:read",
            "org:read",
            "member:read",
            "project:admin",
            "project:write",
            "org:integrations",
            "project:releases",
            "alerts:write",
            "event:admin",
            "project:read",
          ],
          hasAccess: true,
          isPending: false,
          memberCount: 1,
          avatar: { avatarType: "letter_avatar", avatarUuid: null },
          externalTeams: [],
          projects: [],
        },
      ]);
    },
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/projects/",
    () => {
      return HttpResponse.json([
        {
          team: {
            id: "4509106733776896",
            slug: "the-goats",
            name: "the-goats",
          },
          teams: [
            {
              id: "4509106733776896",
              slug: "the-goats",
              name: "the-goats",
            },
          ],
          id: "4509106749636608",
          name: "cloudflare-mcp",
          slug: "cloudflare-mcp",
          isBookmarked: false,
          isMember: true,
          access: [
            "event:admin",
            "alerts:read",
            "project:write",
            "org:integrations",
            "alerts:write",
            "member:read",
            "team:write",
            "project:read",
            "event:read",
            "event:write",
            "project:admin",
            "org:read",
            "team:admin",
            "project:releases",
            "team:read",
          ],
          hasAccess: true,
          dateCreated: "2025-04-06T14:13:37.825970Z",
          environments: [],
          eventProcessing: { symbolicationDegraded: false },
          features: [
            "discard-groups",
            "alert-filters",
            "similarity-embeddings",
            "similarity-indexing",
            "similarity-view",
          ],
          firstEvent: null,
          firstTransactionEvent: false,
          hasSessions: false,
          hasProfiles: false,
          hasReplays: false,
          hasFeedbacks: false,
          hasNewFeedbacks: false,
          hasMonitors: false,
          hasMinifiedStackTrace: false,
          hasInsightsHttp: false,
          hasInsightsDb: false,
          hasInsightsAssets: false,
          hasInsightsAppStart: false,
          hasInsightsScreenLoad: false,
          hasInsightsVitals: false,
          hasInsightsCaches: false,
          hasInsightsQueues: false,
          hasInsightsLlmMonitoring: false,
          platform: "node",
          platforms: [],
          latestRelease: null,
          hasUserReports: false,
          hasFlags: false,
          latestDeploys: null,
        },
      ]);
    },
  ),
  http.post(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
    () => {
      // TODO: validate payload (only accept 'the-goats' for team name)
      return HttpResponse.json({
        id: "4509109078196224",
        slug: "the-goats",
        name: "the-goats",
        dateCreated: "2025-04-07T00:05:48.196710Z",
        isMember: true,
        teamRole: "admin",
        flags: { "idp:provisioned": false },
        access: [
          "event:read",
          "org:integrations",
          "org:read",
          "member:read",
          "alerts:write",
          "event:admin",
          "team:admin",
          "project:releases",
          "team:read",
          "project:write",
          "event:write",
          "team:write",
          "project:read",
          "project:admin",
          "alerts:read",
        ],
        hasAccess: true,
        isPending: false,
        memberCount: 1,
        avatar: { avatarType: "letter_avatar", avatarUuid: null },
      });
    },
  ),
  http.post(
    "https://sentry.io/api/0/teams/sentry-mcp-evals/the-goats/projects/",
    () => {
      // TODO: validate payload (only accept 'cloudflare-mcp' for project name)
      return HttpResponse.json({
        id: "4509109104082945",
        slug: "cloudflare-mcp",
        name: "cloudflare-mcp",
        platform: "javascript",
        dateCreated: "2025-04-07T00:12:23.143074Z",
        isBookmarked: false,
        isMember: true,
        features: [
          "discard-groups",
          "alert-filters",
          "similarity-embeddings",
          "similarity-indexing",
          "similarity-view",
        ],
        firstEvent: null,
        firstTransactionEvent: false,
        access: [
          "team:write",
          "alerts:write",
          "event:write",
          "org:read",
          "alerts:read",
          "event:admin",
          "project:admin",
          "event:read",
          "org:integrations",
          "project:read",
          "project:releases",
          "project:write",
          "member:read",
          "team:read",
          "team:admin",
        ],
        hasAccess: true,
        hasMinifiedStackTrace: false,
        hasMonitors: false,
        hasProfiles: false,
        hasReplays: false,
        hasFeedbacks: false,
        hasFlags: false,
        hasNewFeedbacks: false,
        hasSessions: false,
        hasInsightsHttp: false,
        hasInsightsDb: false,
        hasInsightsAssets: false,
        hasInsightsAppStart: false,
        hasInsightsScreenLoad: false,
        hasInsightsVitals: false,
        hasInsightsCaches: false,
        hasInsightsQueues: false,
        hasInsightsLlmMonitoring: false,
        isInternal: false,
        isPublic: false,
        avatar: { avatarType: "letter_avatar", avatarUuid: null },
        color: "#bf3f55",
        status: "active",
      });
    },
  ),
  http.post(
    "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
    () => {
      // TODO: validate payload (only accept 'Default' for key name)
      return HttpResponse.json(ClientKeyPayload);
    },
  ),
  http.get(
    "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
    () => {
      return HttpResponse.json([ClientKeyPayload]);
    },
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/events/",
    async ({ request }) => {
      const url = new URL(request.url);
      const dataset = url.searchParams.get("dataset");
      const query = url.searchParams.get("query");
      const fields = url.searchParams.getAll("field");

      if (dataset === "spans") {
        //[sentryApi] GET https://sentry.io/api/0/organizations/sentry-mcp-evals/events/?dataset=spans&per_page=10&referrer=sentry-mcp&sort=-span.duration&allowAggregateConditions=0&useRpc=1&field=id&field=trace&field=span.op&field=span.description&field=span.duration&field=transaction&field=project&field=timestamp&query=is_transaction%3Atrue
        if (query !== "is_transaction:true") {
          return HttpResponse.json(EmptyEventsSpansPayload);
        }

        if (url.searchParams.get("useRpc") !== "1") {
          return HttpResponse.json("Invalid useRpc", { status: 400 });
        }

        if (
          !fields.includes("id") ||
          !fields.includes("trace") ||
          !fields.includes("span.op") ||
          !fields.includes("span.description") ||
          !fields.includes("span.duration")
        ) {
          return HttpResponse.json("Invalid fields", { status: 400 });
        }
        return HttpResponse.json(EventsSpansPayload);
      }
      if (dataset === "errors") {
        //https://sentry.io/api/0/organizations/sentry-mcp-evals/events/?dataset=errors&per_page=10&referrer=sentry-mcp&sort=-count&statsPeriod=1w&field=issue&field=title&field=project&field=last_seen%28%29&field=count%28%29&query=

        if (
          !fields.includes("issue") ||
          !fields.includes("title") ||
          !fields.includes("project") ||
          !fields.includes("last_seen()") ||
          !fields.includes("count()")
        ) {
          return HttpResponse.json("Invalid fields", { status: 400 });
        }

        if (
          !["-count", "-last_seen"].includes(
            url.searchParams.get("sort") as string,
          )
        ) {
          return HttpResponse.json("Invalid sort", { status: 400 });
        }

        // TODO: this is not correct, but itll fix test flakiness for now
        const sortedQuery = query ? query?.split(" ").sort().join(" ") : null;
        if (
          ![
            null,
            "",
            "error.handled:false",
            "error.unhandled:true",
            "error.handled:false is:unresolved",
            "error.unhandled:true is:unresolved",
            "is:unresolved project:cloudflare-mcp",
            "project:cloudflare-mcp",
            "user.email:david@sentry.io",
          ].includes(sortedQuery)
        ) {
          return HttpResponse.json(EmptyEventsErrorsPayload);
        }

        return HttpResponse.json(EventsErrorsPayload);
      }

      return HttpResponse.json("Invalid dataset", { status: 400 });
    },
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/",
    ({ request }) => {
      const url = new URL(request.url);
      const sort = url.searchParams.get("sort");

      if (![null, "user", "freq", "date", "new", null].includes(sort)) {
        return HttpResponse.json(
          `Invalid sort: ${url.searchParams.get("sort")}`,
          {
            status: 400,
          },
        );
      }

      const collapse = url.searchParams.getAll("collapse");
      if (collapse.includes("stats")) {
        return HttpResponse.json(`Invalid collapse: ${collapse.join(",")}`, {
          status: 400,
        });
      }

      const query = url.searchParams.get("query");
      const queryTokens = query?.split(" ").sort() ?? [];
      const sortedQuery = queryTokens ? queryTokens.join(" ") : null;
      if (
        ![
          null,
          "",
          "is:unresolved",
          "error.handled:false is:unresolved",
          "error.unhandled:true is:unresolved",
          "project:cloudflare-mcp",
          "is:unresolved project:cloudflare-mcp",
          "user.email:david@sentry.io",
        ].includes(sortedQuery)
      ) {
        if (queryTokens.includes("project:remote-mcp")) {
          return HttpResponse.json(
            {
              detail:
                "Invalid query. Project(s) remote-mcp do not exist or are not actively selected.",
            },
            { status: 400 },
          );
        }
        return HttpResponse.json([]);
      }

      if (queryTokens.includes("user.email:david@sentry.io")) {
        return HttpResponse.json([IssuePayload]);
      }

      if (sort === "date") {
        return HttpResponse.json([IssuePayload, IssuePayload2]);
      }
      return HttpResponse.json([IssuePayload2, IssuePayload]);
    },
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
    () => HttpResponse.json(IssuePayload),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/6507376925/",
    () => HttpResponse.json(IssuePayload),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-42/",
    () => HttpResponse.json(IssuePayload2),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/6507376926/",
    () => HttpResponse.json(IssuePayload2),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/latest/",
    () => HttpResponse.json(EventPayload),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/6507376925/events/latest/",
    () => HttpResponse.json(EventPayload),
  ),
  // TODO: event payload should be tweaked to match issue
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-42/events/latest/",
    () => HttpResponse.json(EventPayload),
  ),
  // TODO: event payload should be tweaked to match issue
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/6507376926/events/latest/",
    () => HttpResponse.json(EventPayload),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/releases/",
    () => HttpResponse.json([ReleasePayload]),
  ),
  http.get(
    "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/",
    () => HttpResponse.json([ReleasePayload]),
  ),
  http.get("https://sentry.io/api/0/organizations/sentry-mcp-evals/tags/", () =>
    HttpResponse.json(TagsPayload),
  ),
  http.get("https://sentry.io/api/0/issues/6507376925/autofix/", () => {
    return HttpResponse.json({
      run_id: 123,
    });
  }),
  // this mock here isnt ideal as its unrelated to the above
  http.post("https://sentry.io/api/0/issues/6507376925/autofix/", () => {
    return HttpResponse.json(AutofixPayload);
  }),
];

export const mswServer = setupServer(...restHandlers);
