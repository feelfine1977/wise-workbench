# Proposals and commitment checks

An improvement suggestion is a proposal until someone agrees to act on its evidence. Saving a proposal does not approve it or demonstrate a benefit.

| State | Evidence rule |
| --- | --- |
| proposed | May be unassessed. A scoped proposal records the selected run, norm, perspective, grouping, group key, filter, flow scope and comparator. |
| agreed, in_progress, done | Requires saved, unchanged evidence from an observed run, an owner role, and all current gates passed or explicitly waived. Creation and updates use the same check. |
| dropped | May be recorded without a new evidence assessment. |

The server records the evidence context; a client cannot replace it on an existing action. Changing a map filter, selecting another norm or reopening a page cannot silently retarget the proposal. Open the intended group and save a new proposal if the scope changes. Result files declared by the run manifest are checked against their recorded hashes at commitment time, including when the analytical cache is warm. These checks do not revalidate every auxiliary analytics cache or establish causal correctness.

Pending and failed gates both stop commitment. A waiver or manual pass needs a rationale and applies to its saved run evidence and perspective; a run-wide readiness decision remains run-wide. When group checks and log-wide checks both exist, the log-wide checks appear separately and cannot be hidden by a clean group result. Earlier decisions without this recorded identity remain historical and do not silently become permission for the new action workflow. Gate decisions use their own endpoint, not a generic review-item update.

Proposals without evidence, including legacy records, remain readable and can be annotated or dropped. They cannot be agreed or started by inheriting the currently selected screen. Save a new scoped proposal to proceed. Notes on already recorded actions can be retained without asserting a new commitment; a new commitment or a substantive change rechecks the evidence.

## Current limits

- Supported case filters are evaluated on the run's log and intersected with the selected group. The proposal records the exact item count and selection identity. Readiness uses the selected items' flags, including measured zeros, against the run's observation window. Missing measurements stay pending. Group decisions are tied to the filter, membership and measured checks; changing any of them cannot reuse an earlier decision. Checks that describe the whole log remain run-wide.
- The supported assessment subset is activity presence/absence/start/end, case-attribute membership/equality/numeric bounds, case-start/end dates, follows, first-after lag bounds, activity-count bounds and open/closed when closure is defined. Unknown fields are refused. Active-period/event-period, direct-lag, negative-follows, nested alternatives, constraint and slice filters are not yet assessed here. These filters can still be recorded as proposals, with an unavailable count, but cannot authorise commitment. A selection with no matching items also cannot authorise commitment.
- Older filtered proposals without a recorded selection identity stay historical. Open the selection and save a new proposal to have its membership assessed.
- Suggestions and their comparison/headroom, and Data trust’s diagnostic numbers, still describe the whole group. The checks section labels the exact selection separately. Filtered drivers used by the domain check retain the whole-run comparison baseline; this does not create a filtered comparison report or a causal recommendation.
- Drill-within-group and ad-hoc band scope are not supported by this action contract yet; an explicit request carrying them is refused rather than recorded as the whole group. Saved run slicings with bands retain their run-defined grouping identity.
- What-if scenarios can support proposals but do not stand in for observed evidence when committing to an intervention.
- Recorded context is not a current readiness verdict. `commitmentCheck` records what was checked at a particular write; it is not continuing approval.
- This boundary covers action writes. Extending the same complete evidence context through findings, hypotheses, comparison baselines and notebook exports remains separate work.
- Signing or completing an action does not establish realised benefit. Outcome measurement and project permissions are later workflow requirements.

If saving fails, the form shows the refusal at the save control and keeps the entered title, owner, note and remedy for correction or retry. The WISE Support presentation switch has no effect on this server policy.
