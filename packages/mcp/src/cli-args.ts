// Side-effect-free CLI argument parsing for `boardstate-mcp`, split out of `cli.ts`
// so it can be imported (and re-exported) without running the stdio server.

export type CliOptions = {
  stateDir?: string;
  servePort?: number;
  help?: boolean;
};

export const USAGE = `boardstate-mcp — MCP stdio server for a local Boardstate dashboard.

Usage: boardstate-mcp [--state-dir <dir>] [--serve <port>]

Options:
  --state-dir <dir>   State directory root (default: $BOARDSTATE_STATE_DIR or ~/.boardstate).
  --serve <port>      Also start the demo host page on <port> so a human can watch live.
  -h, --help          Show this help.`;

/** Parse argv (excluding node + script) into {@link CliOptions}. Throws on bad input. */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--state-dir" || arg.startsWith("--state-dir=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[(index += 1)];
      if (!value) {
        throw new Error("--state-dir requires a directory path");
      }
      options.stateDir = value;
    } else if (arg === "--serve" || arg.startsWith("--serve=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[(index += 1)];
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("--serve requires a port between 1 and 65535");
      }
      options.servePort = port;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}
