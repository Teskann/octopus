"""MCP server exposing the local video editor's controls to an agent.

Run with ``python -m mcp_server`` (Claude Code launches it over stdio). It is a
thin HTTP client to the running FastAPI app (``TRANSCRIPT_API``, default
http://localhost:8000) — never touching project.json directly, so the app's
in-memory cache stays the single source of truth. See mcp-agent-control.html.
"""
