# `alertzero.reportWorkerOutcome`

A workflow step that reports an allowlisted AlertZero Worker outcome as an EBT event (see the [telemetry README](../../telemetry/README.md)). It is the only way Worker YAML can emit an outcome. The server registers it only when `xpack.alertzero.enabled` is on and Agent Builder, Proposals and Agentic Investigations are all present, the same condition under which the Worker YAML that calls it is installed. The browser registers its YAML-editor definition whenever `xpack.alertzero.enabled` is on.

## Input

`with` is a closed union keyed by `event`. Each branch accepts only enums, bounded integer counts and booleans; the one id is the Worker's own `investigation_id`, which must be a UUID. Unknown keys fail the parse.

`worker_run_completed` and `worker_investigation_closed` are for any catalogued Worker: the step takes the Worker from the run's root (the envelope's `worker_id`), never from the input. Every other event belongs to one Worker, and the step reports it only when the run's root is that Worker (`event_worker_ids.ts`): the four `ad_worker_*` events to Attack Discovery, the two `alert_triage_*` events to Alert Triage, `rule_tuning_review_completed` to Rule Tuning, `rule_coverage_review_completed` to Rule Coverage, `hunt_report_completed` to Continuous Threat Hunt and `endpoint_analysis_completed` to Endpoint Analysis.

| `event` | Reports | Fields |
|---|---|---|
| `ad_worker_run_completed` | `alertzero_ad_worker_run_completed` | `alerts_analyzed`, `batches_total`, `batches_failed`, `attacks_generated`, `attacks_persisted` (counts, default `0`), `run_outcome` (required) |
| `ad_worker_review_started` | `alertzero_ad_worker_review_started` | `investigation_id` (UUID, optional), `is_rereview` (optional) |
| `ad_worker_analysis_completed` | `alertzero_ad_worker_analysis_completed` | `verdict` (required), `analysis_error` (default `false`) |
| `ad_worker_handoff_resolved` | `alertzero_ad_worker_handoff_resolved` | `outcome` (required), `verdict` (optional), `auto_approve_requested` (optional) |
| `worker_investigation_closed` | `alertzero_worker_investigation_closed` | `investigation_id` (UUID, required), `close_reason` (required, the Investigation template's close reason, or the class the Worker's close maps to) |
| `worker_run_completed` | `alertzero_worker_run_completed` | `run_outcome` (required), `degraded` (default `false`), `degraded_reason` (default `none`), `candidates_found`, `items_dispatched`, `items_failed`, `items_in_flight` (counts, default `0`), `source_read_failed`, `lookup_failed` (default `false`) |
| `alert_triage_batch_classified` | `alertzero_alert_triage_batch_classified` | `alerts_total`, `verdicts_true_positive`, `verdicts_false_positive`, `verdicts_inconclusive`, `alerts_without_verdict`, `fp_candidates`, `fp_below_floor` (counts), `investigation_id` (UUID, optional) |
| `alert_triage_closure_resolved` | `alertzero_alert_triage_closure_resolved` | `outcome` (required), `alerts_proposed`, `alerts_retag_failed` (counts), `auto_approve_requested`, `proposal_read_failed` (flags), `investigation_id` (UUID, optional) |
| `rule_tuning_review_completed` | `alertzero_rule_tuning_review_completed` | `entry_gate`, `change_type`, `decision` (required), `confidence` (default `none`), `applied`, `backtest_ran`, `backtest_reduced_alerts`, `rule_unavailable` (flags), `investigation_id` (UUID, optional) |
| `rule_coverage_review_completed` | `alertzero_rule_coverage_review_completed` | `verdict`, `proposal_kind`, `decision` (required), `applied`, `approved_not_applied`, `rule_created`, `creation_skipped`, `creation_failed`, `check_failed`, `ki_processed` (flags), `investigation_id` (UUID, optional) |
| `hunt_report_completed` | `alertzero_hunt_report_completed` | `hunt_status`, `package_status` (required), `mint_suppression` (default `none`), `has_confirmed_hit`, `closed_clean` (flags), `tier2_invoked` (optional), `proposals_prepared`, `proposals_dispatch_failed`, `coverage_kis_written`, `coverage_kis_skipped` (counts), `investigation_id` (UUID, optional) |
| `endpoint_analysis_completed` | `alertzero_endpoint_analysis_completed` | `analysis_outcome` (required), `reused_prior_assessment`, `host_resolved`, `agent_failed`, `timeline_found`, `iocs_found`, `findings_attached`, `auto_approve_requested` (flags), `actions_recommended`, `proposals_dispatched`, `proposals_dispatch_failed` (counts) |

Liquid renders a missing value as `''`, so every count and flag treats `''` and `null` as absent, and a count or flag also accepts the text a `{{ }}` template renders (`'12'`, `'true'`). Prefer `${{ }}` typed values with a `default`. The engine does not apply the input schema at runtime, so the handler parses it itself.

## Shipped callers

Worker YAML in `@kbn/workflows/managed` (`definitions/alertzero/`) calls the step. Each report step has `on-failure: continue` and `timeout: 30s`. A Worker that closes its own Investigation reports each close right after the `ai.conversation.metadata.patch` step that writes `status: closed`, in the same step list, and only when that close left no error and its `changed_fields` contains `status`. Each Worker's report steps and their placement are listed in its own "How the … Worker reports" section of the [telemetry README](../../telemetry/README.md).

Each Worker wires its YAML in its own change, and declares what it wired in its own files, so no shared list changes:

- `shipped_yaml_contract.<worker>.fixture.ts` here declares the Worker's workflows with report steps, and runs that exercise each report. Its `shipped_yaml_contract.<worker>.test.ts` renders each `with` block the way the engine does and validates it against the input schema, so a YAML edit that the schema would reject fails in CI instead of logging `invalid_input` at runtime. `shipped_yaml_contract.test.ts` finds the fixtures by file name and fails unless the declared workflows are exactly the AlertZero managed workflows with a report step.
- In `definitions/alertzero/`, `worker_close_reports.test.ts` fails when a close in a workflow with a report step has no close report right after it. A workflow no Worker reports from yet is not checked. Each `worker_reports.<worker>.test.ts` lists every close in the Worker's workflows and pins what its reports render.

Both shared guards are opt-in: they check only the workflows that already have a report step. On `main`, before any Worker PR adds one, no workflow has a report step, so both pass without checking anything. They start to check a Worker's workflows in the change that adds that Worker's first report step.

## Output

`{ reported: boolean }` and nothing else. The step never throws, so a telemetry problem never fails a Worker run. Still run it with `on-failure: continue` and a short `timeout`, and never inside a `parallel` branch or a `waitForApproval` branch.

The step gives itself 20s in all (`STEP_DEADLINE_MS`), well under the `timeout: 30s` the shipped report steps set: the managed check and up to 11 ancestor reads, at 5s each, could otherwise outlast the step timeout, and the engine would fail the step. Past the deadline it returns `{ reported: false }` and logs `deadline_exceeded`, and the checks still in flight see the run as aborted, so they make no further ancestor read and never report.

## What it verifies

In order, stopping at the first failure:

1. The input parses, and does not contradict itself: a `worker_run_completed` whose `run_outcome` is `degraded_partial` must have `degraded: true`, and `degraded_reason` must be `none` exactly when `degraded` is false (`find_outcome_contradictions.ts`). Otherwise `invalid_input`.
2. The run is not aborted. It is checked again after the opt-in read (so before the managed check), before each ancestor read, and immediately before reporting, but not between the two managed-state reads of step 5. Otherwise `aborted`. Past the deadline the checks see the run as aborted too, but the step has already returned as `deadline_exceeded`.
3. The step's own execution is not a test run. Otherwise `test_run`.
4. Telemetry is opted in (a 1s read of the telemetry plugin's opt-in; no plugin or no decision counts as opted out). Otherwise `opted_out`. Every check before this one is local, so an opted-out cluster makes no Elasticsearch read.
5. AlertZero's owner-bound managed workflows client knows the reporting workflow, in the execution space or else the global space (5s per read). Otherwise `not_managed`. With Kibana service accounts off, AlertZero starts no such client, so the step skips as `service_accounts_disabled`; with them on, a missing client is `lineage_unavailable`. A workflow that passes is remembered for 10 minutes (500 entries) per workflow id and execution space, and answered without a read; a workflow that fails, or cannot be checked, is checked again on its next report.
6. The persisted ancestors, read through the Workflows management setup API with `omitStepExecutions`, starting at the reporting execution: at most 10 parent hops, 5s per read, every hop in the same space (compared explicitly), not a test run, and managed by `alertzero`. Parents are read from both context shapes (`parentWorkflowExecutionId`, and the `parent.executionId` a terminal save rewrites it to).
7. The root (the hop with no parent) is a catalog Worker (`originManagedWorkflowId` in `SYSTEM_SECURITY_WORKER_IDS`). Otherwise `not_catalog_root`.
8. A Worker-specific event comes from its own Worker: the root's `originManagedWorkflowId` is the event's owner in `event_worker_ids.ts`. Otherwise `wrong_worker`.

A missing or unreadable ancestor, a timeout, a cycle, a chain that is too deep, or a hop in another space is `lineage_unavailable`. The envelope is then built from the verified root, as for every Worker run event.

The caller check is best-effort.

Verified chains are cached for 10 minutes (500 entries). Each execution of a chain maps to the chain's root and answers only in its own space, so the several reports of one review, and sibling reviews of one runner, skip the reads already made.

## Skip reasons

A skip is written to the AlertZero server logger (`plugins.alertzero.telemetry`), never to the workflow event log or the step output, so the step cannot be used to probe other executions.

| Reason | Level |
|---|---|
| `opted_out`, `test_run`, `not_managed`, `lineage_unavailable`, `service_accounts_disabled`, `not_catalog_root`, `aborted`, `deadline_exceeded` (the step ran past its 20s deadline) | debug |
| `invalid_input` (issue paths and codes only, never the rendered values), `wrong_worker` (the event name), `report_error` | warn |
