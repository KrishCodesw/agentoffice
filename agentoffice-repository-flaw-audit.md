# AgentOffice Repository Flaw Audit

**Review type:** Static code and repository review\
**Repository:** `KrishCodesw/agentoffice`\
**Review date:** 23 November 2026\
**Execution status:** No build, test suite, runtime test, or security
scan was run during this review.

> This document lists issues found during the static review. Confirm
> each issue against the current branch before changing code. Some
> findings depend on the intended deployment model.

## Severity guide

-   **Critical:** Can allow unauthorised access, unsafe control, or a
    serious security failure.
-   **High:** Can cause incorrect behaviour, data loss, or a major
    reliability problem.
-   **Medium:** Can cause maintenance, testing, or user-experience
    problems.
-   **Low:** Cleanup or documentation issue.

------------------------------------------------------------------------

## 1. Authentication and network security

### 1.1 Socket.IO handlers may run before authentication completes --- Critical

The server appears to register Socket.IO handlers before asynchronous
token validation finishes.

**Risk:** A client may send commands before the server confirms its
identity.

**Required action:** - Authenticate in Socket.IO middleware. - Reject
the connection if authentication fails. - Register control handlers only
after authentication succeeds. - Add tests for missing, invalid,
expired, and valid tokens.

### 1.2 First token can become the stored token --- Critical

The authentication code appears to accept any non-empty token when no
token is stored, then saves that token.

**Risk:** An unauthorised first client may claim the initial token if it
can reach the server.

**Required action:** - Use a clear first-run setup process. - Restrict
initial setup to local access. - Require an explicit setup action. -
Disable bootstrap behaviour after setup. - Never use this flow in a
network-exposed production deployment.

### 1.3 CORS allows every origin --- Critical

The server uses a wildcard origin policy.

**Risk:** Untrusted websites may be able to make browser requests to the
service.

**Required action:** - Use an explicit origin allowlist. - Separate
local development and production settings. - Reject unknown origins. -
Test the configured policy.

### 1.4 Server may listen on every network interface --- Critical

The server appears to use `0.0.0.0` as its default host.

**Risk:** The service may be reachable from other devices on the
network.

**Required action:** - Use `127.0.0.1` by default for local mode. -
Require an explicit setting to expose the service to a network. -
Document the firewall and authentication requirements for network mode.

### 1.5 WebSocket commands do not appear to have their own strong access checks --- High

The HTTP agent adapter accepts WebSocket commands without a clear
authentication and authorisation layer.

**Risk:** A client that can connect may be able to send commands it
should not control.

**Required action:** - Authenticate every connection. - Authorise every
command. - Validate the agent, session, and command scope. - Reject
unknown command types. - Add negative tests.

### 1.6 No clear token lifecycle --- High

The reviewed flow does not show a complete token lifecycle for expiry,
rotation, revocation, and safe storage.

**Risk:** A leaked token may remain useful for too long.

**Required action:** - Define token expiry and rotation. - Support
revocation. - Avoid logging tokens. - Store secrets outside source
control. - Document recovery after token loss.

------------------------------------------------------------------------

## 2. Approval and policy control

### 2.1 Approval ID may be replaced --- Critical

The server appears to generate a new approval ID when it receives a
`needs_approval` event from an agent.

**Risk:** The approval response may not refer to the original request.
The server may approve or deny the wrong operation, or fail to complete
the correct one.

**Required action:** - Keep a server-owned approval ID. - Store a
mapping to the original request ID. - Bind the approval to the exact
agent, session, requester, and action. - Test the full
request-to-approval-to-result flow.

### 2.2 Approval function accepts missing IDs --- High

The policy code appears to handle a missing approval ID as an expired
result instead of rejecting invalid input.

**Risk:** Invalid requests may be treated as normal approval states.

**Required action:** - Validate the ID before lookup. - Return a clear
invalid-request result. - Do not use one status to represent both
invalid and expired requests.

### 2.3 Approval expiry is not enforced clearly --- Critical

The approval path does not appear to check the expiry time before
accepting an approval.

**Risk:** A user may approve an old request after it is no longer valid.

**Required action:** - Store an expiry timestamp. - Check expiry at the
point of approval and execution. - Reject expired approvals. - Test
boundary times.

### 2.4 Approval state can change more than once --- High

The policy code appears to allow repeated status changes.

**Risk:** A request may be approved, then denied, or processed more than
once.

**Required action:** - Use a strict state machine. - Allow only valid
state transitions. - Make approval decisions atomic. - Reject duplicate
decisions.

### 2.5 Approval state is only in memory --- High

Approval records do not appear to be stored durably.

**Risk:** A server restart may lose pending approvals and their history.

**Required action:** - Store approval records in durable storage. -
Record the actor, decision, time, request, and final result. - Define
restart and recovery behaviour.

### 2.6 Approval may not bind to the exact operation --- Critical

The approval record must identify the exact operation that the user
reviewed.

**Risk:** An agent may change the command after approval, while keeping
the same approval reference.

**Required action:** - Store a hash or immutable representation of the
approved action. - Compare it with the action that will execute. -
Reject any mismatch. - Include command arguments and target scope in the
approval record.

### 2.7 Budget accounting may accept invalid cost values --- High

The budget path needs strict validation for cost values.

**Risk:** Negative, non-finite, or malformed values may corrupt budget
totals.

**Required action:** - Accept only finite, non-negative numbers. -
Reject invalid values. - Define what happens when a request exceeds its
budget. - Test concurrent usage updates.

### 2.8 Budget updates may not be atomic --- High

Concurrent usage events may update the same budget without a transaction
or lock.

**Risk:** The recorded usage may be incorrect under load.

**Required action:** - Use atomic database updates or transactions. -
Define whether over-budget usage is recorded. - Test concurrent updates.

------------------------------------------------------------------------

## 3. Architecture and module boundaries

### 3.1 Server imports the mock adapter directly --- High

The server application appears to import `MockAdapter` directly.

**Risk:** The server becomes coupled to a development adapter. This
conflicts with the stated design in which adapters implement a core
contract and can be selected independently.

**Required action:** - Use dependency injection or an adapter
registry. - Keep mock adapter selection in development or test
composition. - Keep production composition separate.

### 3.2 Architecture plan and implementation structure do not fully match --- Medium

The project plan describes module boundaries that do not appear to match
all current imports and folders.

**Risk:** Developers and coding agents may follow the plan while the
code follows a different design.

**Required action:** - Update the architecture document to match the
actual repository. - Record planned changes separately from current
behaviour. - Add tests or lint rules for important module boundaries.

### 3.3 Core contracts are not the single source of truth --- High

Some event and command rules appear in comments or documentation but are
not present in the TypeScript types.

**Risk:** Different modules may implement different versions of the same
contract.

**Required action:** - Define event and command contracts in the core
package. - Make adapters and server code use those contracts. - Generate
or validate API documentation from the contracts where possible.

### 3.4 Adapter configuration is not used consistently --- Medium

The HTTP adapter's `connect(config)` method appears not to use its
configuration argument.

**Risk:** Callers may believe that configuration options are active when
they are ignored.

**Required action:** - Use and validate every supported option. - Remove
unsupported options from the type. - Return a clear error for invalid
configuration.

### 3.5 Adapter capability declarations are inconsistent --- Medium

The HTTP adapter appears to declare approval capability in more than one
place, and capability behaviour may not match configuration.

**Risk:** The server may believe an adapter supports a feature when it
does not.

**Required action:** - Build capabilities from one validated source. -
Avoid duplicate entries. - Test each capability against actual adapter
behaviour.

------------------------------------------------------------------------

## 4. Event and command reliability

### 4.1 Event sequence numbers are documented but missing from the event type --- High

The adapter contract comments refer to per-session event sequence
numbers, but the event union does not appear to define them.

**Risk:** The server cannot reliably detect missing, duplicate, or
out-of-order events.

**Required action:** - Add a standard event envelope. - Include
`eventId`, `sessionId`, `sequence`, `timestamp`, and payload. - Validate
the envelope at the system boundary.

### 4.2 Commands are described as idempotent but have no command ID --- High

The adapter contract describes commands as idempotent, but the command
type does not appear to contain a command ID or idempotency key.

**Risk:** A retry may execute the same operation more than once.

**Required action:** - Add a unique `commandId`. - Store command
execution state. - Deduplicate repeated commands. - Define retry and
timeout behaviour.

### 4.3 External events do not have clear runtime validation --- High

TypeScript types do not validate data received over a network.

**Risk:** Invalid or hostile payloads may reach application logic.

**Required action:** - Validate all external payloads at runtime. -
Reject unknown or malformed fields where needed. - Set size limits. -
Add tests for malformed payloads.

### 4.4 No clear event replay or recovery protocol --- High

The reviewed adapter path does not show a complete replay mechanism
after a disconnect.

**Risk:** The server may miss events and display incorrect agent state.

**Required action:** - Define event offsets or sequence numbers. -
Support replay from the last confirmed event. - Detect gaps. - Define
snapshot and resynchronisation behaviour.

### 4.5 No clear duplicate-event handling --- High

The event path needs a defined method to detect duplicate deliveries.

**Risk:** Duplicate events may create repeated state changes or repeated
records.

**Required action:** - Use stable event IDs. - Store processed event IDs
or offsets. - Make event handlers idempotent.

------------------------------------------------------------------------

## 5. HTTP agent adapter

### 5.1 Server startup uses a fixed delay --- Medium

The adapter appears to wait for a fixed period after starting its
server.

**Risk:** Startup may fail on slow systems or waste time on fast
systems. The delay does not prove that the server is ready.

**Required action:** - Wait for the server `listening` event. - Handle
startup errors. - Add a startup timeout.

### 5.2 Adapter emits scripted events --- High

The adapter appears to generate demonstration events instead of
consuming a complete external agent event stream.

**Risk:** The UI may show activity that does not represent a real agent.

**Required action:** - Mark the adapter as a mock or demo adapter. - Do
not use scripted events in production. - Implement a real event source
for production use.

### 5.3 Use of `any` in message handling --- Medium

The adapter uses `any` for a message argument.

**Risk:** Type errors and invalid message shapes may pass unnoticed.

**Required action:** - Define a message schema. - Use `unknown` at
untrusted boundaries. - Validate before narrowing to a known type.

### 5.4 Server shutdown does not wait for full closure --- High

The adapter's stop method appears not to await server closure.

**Risk:** Open sockets or server handles may remain after shutdown.

**Required action:** - Close clients. - Await server closure. - Add
shutdown timeout handling. - Test repeated start and stop cycles.

### 5.5 No clear reconnection protocol --- High

The adapter does not show a complete reconnect and resynchronisation
flow.

**Risk:** A temporary network failure may leave the server and UI with
different state.

**Required action:** - Add reconnect handling. - Resume from a known
event offset. - Send a fresh state snapshot when replay is not possible.

### 5.6 Incomplete adapter feature support --- Medium

The adapter capability list does not appear to cover all planned
features, such as usage, handoff, and takeover.

**Risk:** The product may expose features that the adapter cannot
perform.

**Required action:** - Define the supported feature set. - Return
capability data from the adapter. - Disable unsupported UI actions. -
Add adapter conformance tests.

------------------------------------------------------------------------

## 6. Web application

### 6.1 UI starts with hard-coded agent data --- High

The UI appears to initialise with mock agent records.

**Risk:** Users may see agents as available when the server is not
connected.

**Required action:** - Use an explicit loading state. - Show connection
status. - Load real state from the server. - Keep mock data behind a
development-only flag.

### 6.2 UI uses `any` in event handlers --- Medium

Some event handlers use `any`.

**Risk:** Invalid event data may enter UI state.

**Required action:** - Use shared event types. - Validate network
data. - Use `unknown` for untrusted input.

### 6.3 Command payload type is too broad --- High

The UI command function appears to accept a loose object such as
`{ type: string; text?: string }`.

**Risk:** The UI can send commands that do not match the server
contract.

**Required action:** - Import the shared command union. - Validate
command arguments. - Reject unsupported command types.

### 6.4 Agent state is cast without runtime validation --- Medium

The UI casts a received state value to an agent state type.

**Risk:** Unknown server values may enter the UI as valid states.

**Required action:** - Validate the state value. - Handle unknown states
safely. - Add tests for invalid values.

### 6.5 Socket lifecycle needs stronger cleanup --- Medium

The UI needs a clear connection lifecycle in React effects.

**Risk:** Re-renders or route changes may leave old socket listeners
active.

**Required action:** - Create the connection in a controlled effect or
service. - Remove listeners during cleanup. - Close the connection when
required. - Test mount and unmount behaviour.

### 6.6 Console logs may expose user or agent content --- Medium

The UI logs chat text and event data.

**Risk:** Sensitive content may remain in browser logs.

**Required action:** - Remove production logs that contain content or
secrets. - Use structured, redacted diagnostics. - Keep debug logging
behind a development flag.

### 6.7 Browser authentication transport needs verification --- Medium

The use of `extraHeaders` may not work for browser WebSocket transport.

**Risk:** The browser may not send the token in the way the server
expects.

**Required action:** - Use a browser-supported authentication method. -
Test both polling and WebSocket transport. - Never put long-lived
secrets in URL query strings.

### 6.8 Unused import may fail lint checks --- Low

The UI imports `uuidv4` but it appears unused.

**Required action:** - Remove unused imports. - Run the configured lint
and TypeScript checks.

------------------------------------------------------------------------

## 7. Database and persistence

### 7.1 PostgreSQL selection may still create or use SQLite --- High

The database configuration appears to allow a PostgreSQL option while
still creating or falling back to SQLite.

**Risk:** The application may write to a different database than the
operator expects.

**Required action:** - Implement explicit driver selection. - Fail on
unsupported drivers. - Never silently change the selected database. -
Test each supported driver.

### 7.2 Database fallback behaviour is unclear --- High

A database connection failure should not silently change the storage
engine.

**Risk:** Data may split across database files or disappear from the
expected location.

**Required action:** - Fail startup when the selected database is
unavailable. - Provide a clear error. - Require an explicit migration or
fallback action.

### 7.3 Approval records are not durable --- High

Approval state appears to exist only in memory.

**Risk:** Restart may lose approval state and audit history.

**Required action:** - Persist approvals. - Add migrations. - Test
restart recovery.

### 7.4 Concurrency rules need definition --- High

Budget and approval updates need atomic state changes.

**Risk:** Concurrent requests may overwrite each other or produce
inconsistent state.

**Required action:** - Use transactions or atomic updates. - Add
concurrency tests. - Define conflict handling.

------------------------------------------------------------------------

## 8. Tests and CI

### 8.1 Test script is configured to fail --- High

The package test script appears to print a failure message and exit with
an error.

**Risk:** A normal test command cannot provide a valid test result.

**Required action:** - Add a real test runner. - Configure unit,
integration, and end-to-end tests. - Make CI run the same commands.

### 8.2 End-to-end tests rely on fixed delays --- Medium

Some tests appear to wait for fixed time periods.

**Risk:** Tests may fail on slow systems or pass without proving that
the system is ready.

**Required action:** - Wait for specific events or state. - Add bounded
timeouts. - Report the failed condition.

### 8.3 Some test assertions are weak --- High

Some tests appear to accept timeouts or check only that an item exists.

**Risk:** A test may pass even when the required behaviour is wrong.

**Required action:** - Assert exact state transitions. - Assert command
and event relationships. - Assert failure cases. - Do not treat a
timeout as success.

### 8.4 Test state may not be isolated --- Medium

Tests need isolated database and session state.

**Risk:** One test may affect another test.

**Required action:** - Use a temporary database per test run. - Clean up
test data. - Avoid shared mutable test state.

### 8.5 Missing adapter conformance tests --- High

Each adapter should prove that it follows the same core contract.

**Risk:** Different adapters may behave in different ways.

**Required action:** - Create a shared adapter test suite. - Run it
against every adapter. - Test connection, command, event, error, and
shutdown behaviour.

### 8.6 No verified build or test result in this review --- Review limitation

This review did not run the build, tests, or security scans.

**Required action:** - Run the repository's actual build and test
commands. - Record the output in CI. - Fix failures before treating the
repository as verified.

------------------------------------------------------------------------

## 9. Repository hygiene

### 9.1 Runtime database files are tracked --- High

The repository contains SQLite database files and related WAL/SHM files.

**Risk:** Runtime state can be committed by mistake. It may also contain
private or test data.

**Required action:** - Remove runtime database files from source
control. - Add suitable ignore rules. - Keep intentional test fixtures
in a separate, clearly named directory.

### 9.2 Session and generated files are tracked --- Medium

The repository contains a session Markdown file and generated runtime or
test files.

**Risk:** Local paths, prompts, tool output, private content, or
temporary state may be exposed.

**Required action:** - Review the files before removal. - Remove
generated runtime files from Git. - Add specific ignore rules.

### 9.3 `.gitignore` is incomplete --- Medium

The ignore rules do not appear to cover all database, session, and test
output files.

**Suggested additions:**

``` gitignore
# Runtime databases
*.db-shm
*.db-wal
*.sqlite
*.sqlite3

# Add *.db only if the repository has no intentional database fixtures
# *.db

# Agent sessions and local state
.agentoffice/
sessions/
*.session.md

# Test output
test-results/
playwright-report/
coverage/

# Local environment
.env*
!.env.example
```

Check the repository before adding broad patterns. Do not ignore test
fixtures by accident.

### 9.4 Sensitive content in tracked session files needs review --- High

A session file is not automatically safe to publish.

**Risk:** It may contain tokens, prompts, user data, tool output, or
local paths.

**Required action:** - Inspect the complete file. - Remove secrets and
private data. - Rotate any secret that was committed. - Add a secret
scan to CI.

------------------------------------------------------------------------

## 10. Documentation and contract drift

### 10.1 `CONTEXT.md` has inconsistent capability names --- Medium

Capability names appear in more than one form.

**Risk:** Agents and developers may use different names for the same
capability.

**Required action:** - Define one naming convention. - Use it in code,
docs, and tests.

### 10.2 Documentation repeats contracts --- Medium

Event and command details appear in multiple documents.

**Risk:** Documentation may become stale when code changes.

**Required action:** - Keep the core type definitions as the source of
truth. - Generate API documentation where possible. - Add a
documentation review to contract changes.

### 10.3 AsyncAPI contract may drift from code --- Medium

The AsyncAPI document should be checked against the actual event and
command contracts.

**Risk:** External developers may build clients against an incorrect
contract.

**Required action:** - Validate the AsyncAPI document in CI. - Add
contract tests. - Update it with every protocol change.

### 10.4 No clear instruction hierarchy for coding agents --- Medium

The repository needs clear, scoped instructions for coding agents.

**Risk:** Agents may miss architecture rules, use incorrect commands, or
make broad changes.

**Required action:** - Add a concise root `AGENTS.md`. - Add nested
instructions only where a package needs different rules. - Keep
tool-specific files short and point them to the shared rules.

------------------------------------------------------------------------

## 11. Recommended engineering controls

These are controls to add. They are not all confirmed defects.

1.  **Default deny:** Reject commands unless the user and agent have
    permission.
2.  **Least privilege:** Give each adapter and agent only the
    permissions it needs.
3.  **Approval integrity:** Bind every approval to one immutable
    operation.
4.  **Runtime validation:** Validate every network payload.
5.  **Idempotency:** Give every command and event a stable ID.
6.  **Replay:** Support event recovery after a disconnect.
7.  **Audit trail:** Store approval decisions and important control
    actions.
8.  **Adapter conformance:** Run the same contract tests against every
    adapter.
9.  **Observability:** Add structured logs, metrics, trace IDs, and
    redaction.
10. **Resource limits:** Set payload size, connection, request, and
    execution limits.
11. **CI gates:** Run type checks, lint, tests, dependency checks, and
    secret scans.
12. **Safe shutdown:** Close sockets, adapters, and database connections
    in a defined order.
13. **Failure handling:** Do not hide errors or silently switch database
    drivers.
14. **Environment separation:** Keep mock data and demo adapters out of
    production builds.

## 12. Recommended fix order

  ------------------------------------------------------------------------
                         Order Work                  Reason
  ---------------------------- --------------------- ---------------------
                             1 Fix authentication    Prevent unauthorised
                               race and first-token  access
                               setup                 

                             2 Restrict CORS and     Reduce network
                               network binding       exposure

                             3 Fix approval IDs,     Protect command
                               expiry, state         approval
                               transitions, and      
                               action binding        

                             4 Fix command and event Prevent duplicate or
                               IDs, validation, and  lost work
                               replay                

                             5 Fix database          Protect data
                               selection and         correctness
                               persistence           

                             6 Remove tracked        Reduce data exposure
                               runtime data and      
                               review session files  

                             7 Replace the failing   Make changes
                               test script and       verifiable
                               strengthen tests      

                             8 Remove direct         Restore architecture
                               mock-adapter coupling boundaries

                             9 Add adapter           Keep adapters
                               conformance tests     consistent

                            10 Fix UI state, socket  Improve client
                               lifecycle, and loose  reliability
                               types                 

                            11 Align documentation   Reduce agent and
                               and contracts         developer errors

                            12 Add CI security and   Prevent regression
                               quality gates         
  ------------------------------------------------------------------------

## 13. Coding-agent rules for this repository

Add these rules to `AGENTS.md`:

-   Read the root and relevant nested `AGENTS.md` files before making
    changes.
-   Inspect existing code before creating a new module or dependency.
-   Give an implementation plan before a multi-file change.
-   Do not change architecture boundaries without explaining the reason.
-   Do not use `any`. Use a real type or `unknown` with validation.
-   Validate all data received from a network or external process.
-   Do not bypass authentication, authorisation, approval, or budget
    checks.
-   Do not add mock behaviour to production paths.
-   Do not silently change database drivers or storage locations.
-   Add tests for every behaviour change.
-   Do not weaken or delete tests to make a change pass.
-   Run the relevant type checks, lint, tests, and build.
-   Inspect the complete Git diff before finishing.
-   Report commands that were not run and tests that failed.
-   Never claim that a feature works unless a test or manual check
    proves it.

**Important:** An instruction file does not enforce security. Enforce
security rules in application code, database constraints, process
isolation, CI, and deployment settings.

------------------------------------------------------------------------

## 14. Final assessment

The main risk is not the number of features. It is the trust boundary
between the user, the server, the adapters, and the agents.

Fix authentication, approval integrity, event reliability, and
persistence before adding more agent features. Then make the test suite
and CI strong enough to prevent these issues from returning.

This is a static review. Re-check the current code and run the test
suite before treating any finding as confirmed at runtime.
