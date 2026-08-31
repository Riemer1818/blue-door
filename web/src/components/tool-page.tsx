"use client";

import { ArrowLeft, Bot, CircleAlert, User } from "lucide-react";
import Link from "next/link";

import { trpc } from "@/lib/trpc";

type Port = { name: string; type: string; format?: string; description?: string };

const sig = (p: Port) => (p.format ? `${p.type}/${p.format}` : p.type);

/**
 * Everything the platform knows about one tool.
 *
 * Two halves. The manifest facts are here now. The integration run — how the
 * adapter came to exist — needs the event backbone (BLU-10) and is the part that
 * makes an agent-authored adapter trustworthy, so its absence is stated rather
 * than hidden.
 */
export function ToolPage({ toolId }: { toolId: string }) {
  const query = trpc.tools.get.useQuery({ id: toolId });

  if (query.isLoading) return <p className="p-8 text-sm text-slate-500 dark:text-slate-400">Loading…</p>;
  if (query.error) {
    return (
      <div className="p-8">
        <BackLink />
        <p className="mt-4 text-sm text-red-600">{query.error.message}</p>
      </div>
    );
  }

  const { tool, neighbours } = query.data!;

  return (
    <div className="mx-auto w-full max-w-4xl p-8">
      <BackLink />

      <header className="mt-4 mb-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold">{tool.id}</h1>
          <span className="font-mono text-sm text-slate-400">{tool.version}</span>
          <span className="flex items-center gap-2 text-xs">
            <Authorship by={tool.provenance.authoredBy} />
            <License value={tool.license} />
          </span>
        </div>
        {tool.description && (
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            {tool.description}
          </p>
        )}
      </header>

      <Section title="Operations">
        <div className="flex flex-col gap-4">
          {tool.operations.map((op) => (
            <div key={op.name}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="font-mono text-sm font-medium">{op.name}</h3>
                <span className="text-xs text-slate-400">
                  {op.timeoutSeconds ? `${op.timeoutSeconds}s budget` : "default budget"}
                  {op.stdin && ` · stdin: ${op.stdin}`}
                  {op.stdout && ` · stdout: ${op.stdout}`}
                </span>
              </div>
              {op.description && (
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{op.description}</p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <PortSet ports={op.inputs} />
                <span className="text-slate-300 dark:text-slate-600">&rarr;</span>
                <PortSet ports={op.outputs} />
              </div>

              {/* argv, not a shell string — no quoting bugs and no injection
                  surface. Worth showing: it is what actually runs. */}
              {op.command.length > 0 && (
                <pre className="mt-1.5 overflow-x-auto rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {op.command.join(" ")}
                </pre>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Provenance">
        <Field label="Authored by">
          {tool.provenance.authoredBy ?? <Missing>unstated</Missing>}
          {tool.provenance.authoredAt && ` · ${tool.provenance.authoredAt}`}
        </Field>
        <Field label="Reviewed by">
          {tool.provenance.reviewedBy ?? <Missing>nobody recorded</Missing>}
        </Field>
        <Field label="Conformance">
          {tool.provenance.conformance?.passedAt ? (
            <>
              passed {tool.provenance.conformance.passedAt}
              {tool.provenance.conformance.checks != null &&
                ` · ${tool.provenance.conformance.checks} checks`}
              {tool.provenance.conformance.suiteVersion &&
                ` · suite ${tool.provenance.conformance.suiteVersion}`}
            </>
          ) : (
            <Missing>no result recorded in the manifest</Missing>
          )}
        </Field>
      </Section>

      <Section title="Source">
        <Field label="Repository">
          {tool.source.repository ? (
            <a
              href={tool.source.repository}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
            >
              {tool.source.repository}
            </a>
          ) : (
            <Missing>none declared</Missing>
          )}
        </Field>
        <Field label="Ref">{tool.source.ref ?? <Missing>none</Missing>}</Field>
        {tool.source.commit && <Field label="Commit">{tool.source.commit}</Field>}
        <Field label="Image origin">
          {tool.source.imageOrigin ?? <Missing>unstated</Missing>}
          {tool.source.dockerfile && ` · ${tool.source.dockerfile}`}
        </Field>
        {/* Shown in full and never truncated: which bytes actually ran is the
            question provenance exists to answer. */}
        <Field label="Image">
          <span className="break-all">{tool.image}</span>
        </Field>
      </Section>

      <Section title="Resources">
        <Field label="Machine class">{tool.machineClass}</Field>
        <Field label="Measured">
          {tool.measured?.peakRssMb != null ? (
            <>
              {tool.measured.peakRssMb} MB peak
              {tool.measured.wallSeconds != null && ` · ${tool.measured.wallSeconds}s`}
              {tool.measured.fixture && ` · from ${tool.measured.fixture}`}
            </>
          ) : (
            // BLU-7 fills this in. Absent must read as absent, never as zero.
            <Missing>not profiled yet</Missing>
          )}
        </Field>
      </Section>

      <Section title="Connects to">
        {neighbours.every((n) => n.producedBy.length === 0 && n.consumedBy.length === 0) ? (
          <Missing>nothing else in the catalogue shares this tool&rsquo;s port types</Missing>
        ) : (
          <div className="flex flex-col gap-2">
            {neighbours.map((n) => (
              <div key={n.signature} className="text-xs">
                <span className="font-mono text-slate-700 dark:text-slate-200">{n.signature}</span>
                <div className="mt-0.5 flex flex-col gap-0.5 pl-3">
                  <Relation label="produced by" items={n.producedBy} />
                  <Relation label="consumed by" items={n.consumedBy} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Integration">
        {/* Stated rather than faked. This is the half that makes an
            agent-authored adapter trustworthy, and it needs BLU-10. */}
        <Missing>
          No integration run recorded. The agent&rsquo;s build — phases, probes and their exit
          codes, the drafted manifest, the conformance result — appears here once run events land.
        </Missing>
      </Section>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/tools"
      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
    >
      <ArrowLeft size={13} /> All tools
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

function PortSet({ ports }: { ports: Port[] }) {
  if (ports.length === 0) return <span className="text-slate-400">nothing</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {ports.map((port) => (
        <span
          key={port.name}
          title={port.description ?? port.name}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {port.name}: {sig(port)}
        </span>
      ))}
    </span>
  );
}

function Relation({ label, items }: { label: string; items: string[] }) {
  return (
    <span className="text-slate-500 dark:text-slate-400">
      {label}:{" "}
      {items.length === 0 ? (
        <span className="text-slate-400">nothing</span>
      ) : (
        items.map((item, i) => (
          <span key={item}>
            {i > 0 && ", "}
            <Link
              href={`/tools/${item.split(".")[0]}`}
              className="font-mono underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
            >
              {item}
            </Link>
          </span>
        ))
      )}
    </span>
  );
}

function Authorship({ by }: { by?: string }) {
  if (by === "agent") {
    return (
      <span className="flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
        <Bot size={12} /> agent
      </span>
    );
  }
  if (by === "human") {
    return (
      <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
        <User size={12} /> human
      </span>
    );
  }
  return <span className="italic text-slate-400">author unstated</span>;
}

function License({ value }: { value?: string }) {
  if (!value) {
    return (
      <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
        <CircleAlert size={12} /> no license
      </span>
    );
  }
  return <span className="font-mono text-slate-500 dark:text-slate-400">{value}</span>;
}
