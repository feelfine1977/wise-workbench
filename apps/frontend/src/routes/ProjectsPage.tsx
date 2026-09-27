import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorBlock, QueryState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { api, unwrap } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { projectsQuery } from "@/lib/queries";

export default function ProjectsPage() {
  const projects = useQuery(projectsQuery);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [process, setProcess] = useState("p2p");
  const [question, setQuestion] = useState("");
  const create = useMutation({ mutationFn: async () => unwrap(await api.POST("/projects", { body: { name: name.trim(), process: process || undefined, question: question.trim() || undefined } })),
    onSuccess: async (project) => {
      await client.invalidateQueries({ queryKey: projectsQuery.queryKey });
      setOpen(false);
      await navigate({ to: "/p/$projectId/data", params: { projectId: project.id } });
    },
  });
  return <div className="mx-auto max-w-5xl p-6 md:p-10">
    <p className="text-sm font-semibold tracking-wide text-accent-text">WISE WORKBENCH</p>
    <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-3xl font-bold">Your process improvement projects</h1><p className="mt-2 max-w-2xl text-text-muted">Start with a question. Understand the data, define your Process norm, then investigate what to improve.</p></div>
      <Button onClick={() => { create.reset(); setOpen(true); }}>New project</Button>
    </header>
    <ol className="my-6 grid gap-3 sm:grid-cols-3" aria-label="How a project works">
      {[['Understand', 'Choose a dataset and explore what happens.'], ['Define', 'Build constraints, then organise layers and views.'], ['Improve', 'Run WISE, test explanations and record an action.']].map(([title, text], index) => <li key={title} className="rounded-lg border border-border bg-surface p-4"><span className="text-sm font-semibold text-accent-text">{index + 1}. {title}</span><p className="mt-1 text-sm text-text-muted">{text}</p></li>)}
    </ol>
    <h2 className="text-lg font-semibold">Continue a project</h2>
    <QueryState query={projects}>{(list) => list.length ? <ul className="mt-3 grid gap-3 sm:grid-cols-2">{list.map((p) => <li key={p.id} className="surface p-5">
      <Link to="/p/$projectId" params={{ projectId: p.id }} className="text-lg font-semibold text-accent-text hover:underline">{p.name}</Link>
      <p className="mt-1 text-sm text-text-muted">{p.question || "Define the improvement question with your stakeholders."}</p><p className="mt-3 text-xs text-text-subtle">{p.process?.toUpperCase() || "Custom process"} · created {fmtDate(p.createdAt)}</p>
    </li>)}</ul> : <p className="mt-4 text-text-muted">No projects yet. Create your first project to select a dataset.</p>}</QueryState>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Start a new project</DialogTitle><DialogDescription>A project keeps its data, Process norms, runs and findings together.</DialogDescription></DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate(); }}>
        <Field label="Project name" htmlFor="project-name"><Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="For example, reduce purchasing rework" /></Field>
        <Field label="Process" htmlFor="project-process"><select id="project-process" className="h-10 rounded-md border border-border bg-surface px-3 text-sm" value={process} onChange={(e) => setProcess(e.target.value)}><option value="p2p">Purchase to pay (P2P)</option><option value="o2c">Order to cash (O2C)</option><option value="">Another process</option></select></Field>
        <Field label="What do you want to improve?" htmlFor="project-question" hint="Optional. Start with a business outcome, such as fewer delays or less manual work."><Textarea id="project-question" value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
        {create.isError && <ErrorBlock error={create.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? "Creating…" : "Create project & choose data"}</Button></div>
      </form>
    </DialogContent></Dialog>
  </div>;
}
