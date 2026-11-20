import { parse as parseShellCommand } from "shell-quote";

const DELETE_COMMANDS = new Set(["rm", "rmdir", "unlink", "shred", "srm", "trash"]);
const PREFIX_COMMANDS = new Set(["sudo", "doas", "command", "nice", "nohup", "time", "env"]);

/** The command's words up to each control operator; a glob counts as a pattern word. */
function segments(command: string): Array<Array<{ text: string; glob: boolean }>> {
  const out: Array<Array<{ text: string; glob: boolean }>> = [[]];
  for (const token of parseShellCommand(command)) {
    if (typeof token === "string") out.at(-1)!.push({ text: token, glob: false });
    else if ("op" in token && token.op === "glob")
      out.at(-1)!.push({ text: token.pattern, glob: true });
    else if ("op" in token) out.push([]);
  }
  return out.filter((segment) => segment.length > 0);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Whether a shell command deletes in bulk: a recursive or pattern delete, more than one path at
 * once, `find … -delete` or `-exec rm`, or `git clean -f`. One named file the bot is cleaning up
 * stays free, so ordinary work does not ask; wiping a folder of the owner's files does.
 */
export function shellDeletesInBulk(command: string): boolean {
  let parsed: ReturnType<typeof segments>;
  try {
    parsed = segments(command);
  } catch {
    return false;
  }
  for (const segment of parsed) {
    let start = 0;
    while (
      start < segment.length &&
      (PREFIX_COMMANDS.has(basename(segment[start]!.text)) || /^\w+=/.test(segment[start]!.text))
    )
      start += 1;
    const words = segment.slice(start);
    const base = words[0] ? basename(words[0].text) : "";
    const rest = words.slice(1);
    if (DELETE_COMMANDS.has(base)) {
      const flags = rest.filter((item) => !item.glob && item.text.startsWith("-"));
      const paths = rest.filter((item) => item.glob || !item.text.startsWith("-"));
      const recursive = flags.some(
        (flag) => flag.text === "--recursive" || /^-[a-zA-Z]*[rR]/.test(flag.text),
      );
      if (recursive || paths.some((path) => path.glob) || paths.length > 1) return true;
    }
    if (base === "find") {
      if (rest.some((item) => item.text === "-delete")) return true;
      const exec = rest.findIndex((item) => item.text === "-exec" || item.text === "-execdir");
      if (exec >= 0 && DELETE_COMMANDS.has(basename(rest[exec + 1]?.text ?? ""))) return true;
    }
    if (
      base === "git" &&
      rest[0]?.text === "clean" &&
      rest.some((item) => /^-[a-zA-Z]*f/.test(item.text))
    )
      return true;
    if (
      base === "xargs" &&
      DELETE_COMMANDS.has(basename(rest.find((item) => !item.text.startsWith("-"))?.text ?? ""))
    )
      return true;
  }
  return false;
}
