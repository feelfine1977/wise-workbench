import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/components/states";
import { fmtDate } from "@/lib/format";
import { projectsQuery } from "@/lib/queries";

export default function ProjectsPage() {
  const projects = useQuery(projectsQuery);
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-text-muted">A project is one process with a steering question, its logs, norm versions and runs.</p>
      <QueryState query={projects}>
        {(list) => (
          <ul className="mt-6 grid gap-3">
            {list.map((p) => (
              <li key={p.id} className="surface p-4">
                <Link to="/p/$projectId" params={{ projectId: p.id }} className="text-lg font-semibold text-accent-text hover:underline">
                  {p.name}
                </Link>
                <p className="text-sm text-text-muted">{p.question}</p>
                <p className="mt-1 text-xs text-text-subtle">
                  {p.process} · created {fmtDate(p.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
