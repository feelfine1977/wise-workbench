# adapters/mcp

Model Context Protocol transports for the assistant's tool registry.
Server (v1): read-only tools and the staging tool over stdio (desktop hosts)
or streamable HTTP with the per-launch token (server mode); same validation,
cache and audit as in-process calls. Client (v2): allow-listed external MCP
servers as read-only knowledge connectors; their content is indexed like
uploaded documents and treated as untrusted.
