# Changelog

## [0.1.1] - 2026-10-19

Changes since v0.1.0; replaces the previous, unpublished v0.1.1 tag.

### Fixed

- Honor the requested Firecrawl crawl page limit, counting only usable documents and continuing through paginated results when needed.
- Perform a final crawl status poll after the polling deadline so completed results are not missed.
- Reject non-HTTP(S) scrape and crawl URLs before calling a provider.
- Trim whitespace around `RRCRAWL_AUTH_MODE` values.
- Return a rejected promise when no crawl-capable provider is configured.
- Report the package version in the MCP server handshake.

### Maintenance

- Update the MCP SDK, dotenv, undici, Zod, TypeScript, Vitest, and supporting development dependencies.
- Expand regression coverage for provider limits, polling, HTTP errors, configuration, routing, and MCP tool calls.
- Publish to npm from version-tag pushes, verifying that the tag matches the package version, and run branch CI on `master`.

[0.1.1]: https://github.com/romanbsd/rrcrawl/compare/v0.1.0...v0.1.1
