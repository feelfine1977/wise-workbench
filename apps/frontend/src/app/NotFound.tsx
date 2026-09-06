export function NotFound() {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">Nothing here</h1>
      <p className="mt-2 text-sm text-text-muted">
        The address does not match a screen.{" "}
        <a className="text-accent-text underline" href="/">
          Go to the dashboard
        </a>
        .
      </p>
    </div>
  );
}
