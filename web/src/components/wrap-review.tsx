"use client";

import {
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  FileWarning,
  Puzzle,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { trpc } from "@/lib/trpc";

/**
 * The promotion gate: what a human reads before an agent-authored adapter
 * reaches the catalogue.
 *
 * `workspace.py` draws the hard line — nothing lands unless conformance passes
 * AND verify() is clean AND a person approves. This screen is that last clause,
 * so if it reads badly the sandbox and the promotion allowlist were pointless.
 *
 * Ordering is deliberate and was settled with the agent's session: caveats
 * first, because they are the reason a human is in the loop at all; then
 * conformance; then exactly what would land; then the trust anchor; then the
 * manifest; then probes as the drill-down.
 *
 * The failure mode this is designed against is not a wrong adapter — conformance
 * catches those. It is a *plausible* one: passes every check, composes with
 * nothing because every port is Text, carries a license nobody established.
 * Those are invisible unless something insists on showing them.
 */
export function WrapReview({ runId }: { runId: string }) {
  const query = trpc.wraps.get.useQuery({ runId });

  if (query.isLoading) {
    return <p className="p-8 text-sm text-slate-500 dark:text-slate-400">Loading…</p>;
  }
  if (query.error) {
    return (
      <div className="p-8">
        <BackLink />
        <p className="mt-4 text-sm text-red-600">{query.error.message}</p>
      </div>
    );
  }

  const report = query.data!;
  const conformancePassed = report.conformance.passed ?? false;
  const guardrailsTripped = report.guardrails.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl p-8">
      <BackLink />

      <header className="mt-4 mb-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold">{report.adapterId}</h1>
          <Outcome outcome={report.outcome} />
          <span className="font-mono text-xs text-slate-400">
            {Math.round(report.seconds)}s · run {report.runId}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Requested as <span className="font-mono">{report.requested.name}</span>
          {report.requested.url ? (
            <>
              {" "}
              from{" "}
              <a
                href={report.requested.url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
              >
                {report.requested.url}
              </a>
            </>
          ) : (
            <> with no URL — the agent found it from the name alone</>
          )}
          .
        </p>
      </header>

      {/* A guardrail trip is our problem, not the tool's, and it says nothing
          about the quality of the work. The first real run proved the point:
          conformance passed every check and the run was still rejected, because
          a human edited the worktree while it was in flight. So when both are
          true, say so — otherwise `rejected` reads as "the adapter is bad". */}
      {guardrailsTripped && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/60 dark:bg-amber-950/30">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-500">
            <ShieldAlert size={14} /> Guardrail tripped
          </h2>
          {report.guardrails.map((line) => (
            <p
              key={line}
              className="mt-2 font-mono text-xs text-amber-900 dark:text-amber-200"
            >
              {line}
            </p>
          ))}
          {/* The guardrail string carries its own diagnosis — the changed paths,
              and on newer runs whether any agent tool call referenced them. All
              this adds is the conformance context, which the string cannot know. */}
          <p className="mt-2 text-xs text-amber-800 dark:text-amber-300/90">
            {conformancePassed ? (
              <>
                Conformance still passed {report.conformance.checks ?? 0} checks, so the adapter
                itself is not what is in question here — this outcome is about containment.
              </>
            ) : (
              <>Conformance did not pass either, so both are worth reading.</>
            )}
          </p>
        </div>
      )}

      <Section title={`Caveats (${report.caveats.length})`}>
        {report.caveats.length === 0 ? (
          // An empty list is a claim, and a useful one — it is the difference
          // between the cheap approve and the careful one. Never an empty box.
          <p className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
            <Check size={14} /> Nothing unresolved. Every fact the report covers was established
            rather than guessed.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {report.caveats.map((caveat, i) => (
              <div key={`${caveat.kind}-${i}`} className="flex gap-2.5">
                {/* A vocabulary gap is not a defect in the adapter — the fix is
                    in porttypes.json, by a different person. It should not wear
                    the same warning colour as "you took a shortcut". */}
                {caveat.kind === "vocabulary_gap" ? (
                  <Puzzle size={14} className="mt-0.5 shrink-0 text-sky-500" aria-hidden />
                ) : (
                  <TriangleAlert
                    size={14}
                    className="mt-0.5 shrink-0 text-amber-500"
                    aria-hidden
                  />
                )}
                <div className="min-w-0">
                  <p className="font-mono text-xs text-slate-700 dark:text-slate-200">
                    {caveat.kind}
                    {caveat.where && (
                      <span className="text-slate-400"> · {caveat.where}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {caveat.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* The constructive half of a vocabulary gap. Sits next to the caveats
          that raised it, because the two are one finding: "no type fits" and
          "here is the type that would". */}
      {report.proposals.length > 0 && (
        <Section title={`Proposed port types (${report.proposals.length})`}>
          <p className="mb-3 text-xs text-slate-600 dark:text-slate-300">
            The agent needed a type the vocabulary does not have. These are requests to extend{" "}
            <span className="font-mono">porttypes.json</span> — a change to shared vocabulary, which
            is reviewed separately and never auto-merged, because a bad type breaks every pipeline
            that touches it rather than one tool.
          </p>
          <div className="flex flex-col gap-3">
            {report.proposals.map((proposal) => (
              <div key={proposal.name}>
                <p className="font-mono text-xs font-medium text-sky-700 dark:text-sky-400">
                  {proposal.name}
                </p>
                {proposal.describes && (
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {proposal.describes}
                  </p>
                )}
                {proposal.howToRecognise && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    <span className="text-slate-400">Recognised by: </span>
                    {proposal.howToRecognise}
                  </p>
                )}
                {proposal.ports.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {proposal.ports.map((port) => (
                      <span
                        key={port}
                        className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-xs text-sky-800 dark:bg-sky-950/50 dark:text-sky-300"
                      >
                        {port}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Conformance">
        <p className="mb-2 flex items-center gap-2 text-xs">
          {conformancePassed ? (
            <>
              <Check size={14} className="text-emerald-600" />
              <span className="text-emerald-700 dark:text-emerald-400">
                Passed {report.conformance.checks ?? 0} checks
                {report.conformance.stage && ` at the ${report.conformance.stage} stage`}
              </span>
            </>
          ) : (
            <>
              <CircleAlert size={14} className="text-red-600" />
              <span className="text-red-700 dark:text-red-400">
                {report.conformance.error ??
                  `Failed — ${report.conformance.checks ?? 0} checks run`}
              </span>
            </>
          )}
        </p>

        {(report.conformance.failures ?? []).length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            {report.conformance.failures!.map((failure, i) => (
              <p key={i} className="text-xs">
                <span className="font-mono text-red-700 dark:text-red-400">
                  {[failure.case, failure.operation, failure.port].filter(Boolean).join(" · ")}
                </span>
                <span className="ml-2 text-slate-600 dark:text-slate-300">{failure.reason}</span>
              </p>
            ))}
          </div>
        )}

        {/* Passing checks are worth showing too. "4 checks passed" is a number;
            "align and add, over basic and protein fixtures" is evidence. */}
        {(report.conformance.results ?? []).length > 0 && (
          <div className="flex flex-col gap-0.5">
            {report.conformance.results!.map((result, i) => (
              <p key={i} className="flex gap-2 text-xs">
                <span className="w-40 shrink-0 font-mono text-slate-500 dark:text-slate-400">
                  {[result.case, result.operation].filter(Boolean).join(" · ")}
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  {result.detail ?? result.status}
                </span>
              </p>
            ))}
          </div>
        )}

        {(report.conformance.warnings ?? []).length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {report.conformance.warnings!.map((warning) => (
              <p key={warning} className="text-xs text-amber-700 dark:text-amber-500">
                {warning}
              </p>
            ))}
          </div>
        )}
      </Section>

      <Section title="Port types">
        {/* An adapter that types everything Text passes conformance and composes
            with nothing. That is the silent quality failure, so it is shown even
            when the outcome is clean. */}
        <div className="flex flex-wrap gap-1">
          {report.portTypesUsed.map((port, i) => (
            <span
              key={`${port.operation}.${port.port}.${port.direction ?? i}`}
              className={
                port.type === "Text"
                  ? "rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                  : "rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }
            >
              {port.operation}.{port.port}: {port.type}
              {/* An operation can name an input and an output identically, so
                  without this the two are indistinguishable. */}
              {port.direction && <span className="opacity-60"> ({port.direction})</span>}
            </span>
          ))}
        </div>
        {/* A Text output is the worse finding: nothing downstream can consume
            it. A Text input only means the operation accepts anything. */}
        {report.portTypesUsed.some((p) => p.type === "Text" && p.direction === "output") && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
            An output typed Text composes with nothing — no other tool in the catalogue can consume
            it. Check whether a real type fits, or whether the vocabulary needs extending.
          </p>
        )}
        {report.portTypesUsed.some((p) => p.type === "Text" && p.direction === "input") && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
            Text is the escape hatch. An input typed with it accepts anything, so wiring into this
            operation is unchecked.
          </p>
        )}
        {/* Reports written before ports carried a direction. Say the general
            thing rather than guess — calling an output an input would be worse
            than saying less. */}
        {report.portTypesUsed.some((p) => p.type === "Text" && !p.direction) && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
            Text is the escape hatch. Anything typed with it composes with nothing — check whether a
            real type fits, or whether the vocabulary needs extending.
          </p>
        )}
      </Section>

      <Section title={`Files that would land (${report.promotable.length})`}>
        {/* Promotion is a copytree. Show the exact list rather than make a
            reviewer infer it from the manifest. */}
        {report.promotable.length === 0 ? (
          <Missing>nothing — there is no adapter to promote</Missing>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {report.promotable.map((file) => (
              <li key={file} className="font-mono text-xs text-slate-600 dark:text-slate-300">
                <span className="text-slate-400">{report.adapterId}/</span>
                {file}
              </li>
            ))}
          </ul>
        )}

        {report.rejectedFiles.length > 0 && (
          <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <FileWarning size={13} /> Refused by the allowlist ({report.rejectedFiles.length})
            </p>
            {report.rejectedFiles.map((file) => (
              <p key={file.path} className="text-xs">
                <span className="font-mono text-slate-700 dark:text-slate-200">{file.path}</span>
                <span className="ml-2 text-slate-500 dark:text-slate-400">{file.why}</span>
              </p>
            ))}
          </div>
        )}
      </Section>

      <Section title="Image and source">
        <Field label="Image">
          {/* Never truncated: which bytes ran is the question this answers. */}
          <span className="break-all">{report.image.reference ?? <Missing>none</Missing>}</span>
        </Field>
        <Field label="Digest">
          {report.image.digest ? (
            <span className="break-all">{report.image.digest}</span>
          ) : (
            <Missing>unpinned — goldens below cannot be tied to a specific image</Missing>
          )}
        </Field>
        <Field label="Origin">
          {report.image.origin === "built_from_source"
            ? "built from source here"
            : report.image.origin === "registry"
              ? "pulled from a registry"
              : ((<Missing>unstated</Missing>) as React.ReactNode)}
        </Field>
        {report.image.candidates.length > 1 && (
          <Field label="Chosen from">
            {report.image.chosenCandidate ? (
              <>
                {report.image.chosenCandidate}
                <span className="ml-2 font-sans text-slate-500 dark:text-slate-400">
                  of {report.image.candidates.length} candidates
                  {report.image.chosenCandidate === report.image.candidates[0] && " — the newest"}
                </span>
              </>
            ) : (
              <span className="font-sans text-slate-500 dark:text-slate-400">
                {report.image.candidates.length} candidates were available
              </span>
            )}
          </Field>
        )}
        <Field label="Repository">
          {report.source.repository ? (
            <a
              href={report.source.repository}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
            >
              {report.source.repository}
            </a>
          ) : (
            <Missing>none declared</Missing>
          )}
        </Field>
        <Field label="Ref">{report.source.ref ?? <Missing>none</Missing>}</Field>
      </Section>

      <Section title="License and version">
        <Fact label="License" fact={report.license} />
        <Fact label="Version" fact={report.version} />
      </Section>

      <Section title="Manifest">
        {report.manifest ? (
          <pre className="max-h-96 overflow-auto rounded bg-slate-100 p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {JSON.stringify(report.manifest, null, 2)}
          </pre>
        ) : (
          <Missing>no manifest was drafted</Missing>
        )}
      </Section>

      <Section title={`Probes (${report.probes.length})`}>
        {report.probes.length === 0 ? (
          <Missing>none recorded</Missing>
        ) : (
          <div className="flex flex-col gap-2">
            {report.probes.map((probe, i) => (
              <Probe key={i} probe={probe} />
            ))}
          </div>
        )}
      </Section>

      <Decision report={report} />
    </div>
  );
}

/**
 * Approve, revise, reject.
 *
 * Revise is the one that matters and the one that is not wired: agent runs are
 * resumable, so a reviewer who spots a bad port type can say so and have the run
 * pick up with everything it already worked out, rather than choosing between
 * accepting a wrong adapter and throwing away an expensive run. It needs
 * `wrap.py --resume` behind it (BLU-6), so the box is here and disabled rather
 * than absent — the shape of the decision is the point.
 *
 * Nothing here says "done". Promotion is a human action and no outcome
 * anticipates it.
 */
function Decision({ report }: { report: { session: { resumable: boolean; resumeHint: string } } }) {
  const [note, setNote] = useState(report.session.resumeHint);

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Decision</h2>

      {report.session.resumeHint && (
        <p className="mb-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          The agent stopped on this:
        </p>
      )}
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        placeholder="What should change? The run resumes with everything it already worked out."
        className="w-full resize-y rounded border border-slate-200 bg-white p-2 text-xs text-slate-700 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled
          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          Approve and promote
        </button>
        <button
          type="button"
          disabled
          className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        >
          Revise
        </button>
        <button
          type="button"
          disabled
          className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        >
          Reject
        </button>
      </div>

      <p className="mt-2 text-xs italic text-slate-400">
        {report.session.resumable
          ? "Not wired yet: promotion and resume both need wrap.py behind them (BLU-6, BLU-18)."
          : "This run recorded no session, so it cannot be resumed — only approved or rejected."}
      </p>
    </section>
  );
}

function Probe({ probe }: { probe: { image?: string; command: string[]; exitCode: number | null } }) {
  const [copied, setCopied] = useState(false);

  // Copyable WITH the image reference: probe.py runs the command inside the
  // adapter's image, and the command alone reproduces nothing.
  const reproducer = probe.image
    ? `docker run --rm -i ${probe.image} ${probe.command.join(" ")}`
    : probe.command.join(" ");

  return (
    <div className="rounded border border-slate-200 p-2 dark:border-slate-700">
      <div className="mb-1 flex items-center gap-2">
        <ExitCode code={probe.exitCode} />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(reproducer).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <Copy size={11} /> {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
        {probe.command.join(" ")}
      </pre>
    </div>
  );
}

/** A null exit code means the probe never finished. That is not zero. */
function ExitCode({ code }: { code: number | null }) {
  if (code === null) {
    return <span className="font-mono text-xs italic text-slate-400">did not complete</span>;
  }
  return (
    <span
      className={
        code === 0
          ? "font-mono text-xs text-emerald-600 dark:text-emerald-400"
          : "font-mono text-xs text-red-600 dark:text-red-400"
      }
    >
      exit {code}
    </span>
  );
}

/**
 * A value and how it was arrived at. Only `found` may look settled — an
 * assumption that reads as established is worse than a visible gap, and the
 * note is routinely a paragraph rather than a phrase.
 */
function Fact({
  label,
  fact,
}: {
  label: string;
  fact: { value: string | null; basis: string; note?: string };
}) {
  const settled = fact.basis === "found";
  return (
    <div className="py-1">
      <p className="flex gap-3 text-xs">
        <span className="w-28 shrink-0 text-slate-400">{label}</span>
        <span className="min-w-0 font-mono text-slate-700 dark:text-slate-200">
          {fact.value ?? <Missing>none established</Missing>}
          <span
            className={
              settled
                ? "ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400"
                : "ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-400"
            }
          >
            {fact.basis}
          </span>
        </span>
      </p>
      {fact.note && (
        <p className="mt-1 pl-[7.75rem] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {fact.note}
        </p>
      )}
    </div>
  );
}

/**
 * Four states, none of which means the tool is ready. They differ only in how
 * much thought is needed, so the split shown is two-way: `conformant` is ready
 * for a person to approve, everything else needs one.
 */
function Outcome({ outcome }: { outcome: string }) {
  const style =
    outcome === "conformant"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400"
      : outcome === "rejected"
        ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
        : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400";

  const says =
    outcome === "conformant"
      ? "ready for review"
      : outcome === "needs_review"
        ? "needs you"
        : outcome === "gave_up"
          ? "needs you — incomplete"
          : "needs you — our problem";

  return (
    <span className="flex items-center gap-1.5">
      <span className={`rounded px-2 py-0.5 font-mono text-xs font-medium ${style}`}>{outcome}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">{says}</span>
    </span>
  );
}

function BackLink() {
  return (
    <Link
      href="/wraps"
      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
    >
      <ArrowLeft size={13} /> All wrap runs
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex gap-3 py-0.5 text-xs">
      <span className="w-28 shrink-0 text-slate-400">{label}</span>
      <span className="min-w-0 font-mono text-slate-700 dark:text-slate-200">{children}</span>
    </p>
  );
}

/** Absence has to look like absence, not like a blank waiting to be filled. */
function Missing({ children }: { children: React.ReactNode }) {
  return <span className="font-sans italic text-slate-400">{children}</span>;
}
