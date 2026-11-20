// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// "This computer" on Windows with nothing else to install: no Docker, no WSL, no VMs.
// One download (the Windows server bundle, which carries its own Postgres 16) is unpacked once.
// Postgres runs as a plain process on 127.0.0.1 with its data under the app's own folder; the
// API, worker and web run on Electron's binary as Node, exactly as on the Mac native stack.
// Bots have no computer of their own here (SANDBOX_PROVIDER=none); a person can still let bots
// use this PC through Settings, as with any server.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DesktopLocalStackPhase } from "@rakazo/contracts";
import { brainFile, type SavedBrain, swiftServerEnv } from "../burrow/brain.js";
import { CONTENT_ENCRYPTED_MARKER, encryptExistingContent } from "../burrow/content-encryption.js";
import { type Sealer, sealStackSecrets, unsealStackEnv } from "../burrow/keyring.js";
import { computerEnv, readComputerChoice } from "../burrow/composio.js";
import { telegramSecret } from "../burrow/telegram.js";
import { readPrivateFile, writePrivateFile } from "../setup/setup-store.js";
import type { RunDocker } from "./docker-cli.js";
import {
  allocateLoopbackPort,
  defaultSleep,
  ensureStackEnv,
  ensureStackToken,
  initialStackState,
  parseStackEnv,
  portFreeOnLoopback,
  readStackToken,
  STACK_ENV_FILE,
  STACK_ENV_TEMPLATE,
  STACK_HEALTH_TIMEOUT_MS,
  STACK_OUTPUT_LINES,
  STACK_WEB_URL_FILE,
  StackLifecycle,
  startInterrupted,
} from "./local-stack.js";
import type { Fetch, RuntimeDeps, ServerBundle, ServerManifest } from "./mac-runtime.js";
import {
  DownloadError,
  installVersion,
  pruneRuntimes,
  readServerManifest,
  serverDirName,
  verifyFileSha256,
} from "./mac-runtime.js";
import {
  COMPOSE_ONLY,
  choosePort,
  downloadFailed,
  postgresAnswers,
  Service,
  type ServiceSpec,
  type SpawnProcess,
  StartFailure,
  servicesFailed,
  WEB_ENV,
} from "./native-stack.js";

export const WINDOWS_PORTS_FILE = ".windows-ports";
const OWNER = "rakazo";
const DATABASE = "rakazo";
const APP_LOGIN = "rakazo_app";
const ACTIVE_PHASES = new Set<DesktopLocalStackPhase>(["starting", "waiting-healthy", "ready"]);
const HEALTH_POLL_INTERVAL_MS = 1_000;
const MIGRATE_TIMEOUT_MS = 10 * 60_000;
const DATABASE_ANSWER_ATTEMPTS = 60;
const CLI_TIMEOUT_MS = 120_000;

/** Process environment Windows programs need; the rest comes from the stack's `.env`. */
const INHERITED_ENV = [
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "ProgramData",
  "PROGRAMDATA",
  "COMSPEC",
  "PATHEXT",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
];

/** Windows is supported on x64 (and arm64 through x64 emulation) with a bundle for it. */
export function windowsStackEligible(input: { platform: string }): boolean {
  return input.platform === "win32";
}

interface WindowsPorts {
  postgres?: number;
  api?: number;
}

export interface WindowsStackDeps {
  /** The Telegram bot token the person pasted (OS keychain); replies go out with it. */
  telegramToken?: () => Promise<string | undefined>;
  /** Gente: where the server searches through Gente Cloud (the desktop app's loopback broker). */
  searchBroker?: () => { url: string; token: string } | null;
  /** The E2B key from the OS keychain: bots get a cloud computer unless the person picks local. */
  cloudComputerKey?: () => Promise<string | undefined>;
  /** The Composio Connect consumer key from the OS keychain, if the person set one. */
  composioKey?: () => Promise<string | undefined>;
  /** Seals the workspace's master secrets with Windows DPAPI (Electron safeStorage). */
  sealer?: Sealer;
  stackDir: string;
  resourceDir: string;
  localWebUrl: string;
  imageTag: string;
  serverBundle: ServerBundle;
  nodeBinary: string;
  env: NodeJS.ProcessEnv;
  hostComputer?: { url: string; token: string };
  run: RunDocker;
  fetch: Fetch;
  exists: (file: string) => boolean;
  probe: (url: string, signal: AbortSignal, token: string) => Promise<string | null>;
  randomHex: (bytes: number) => string;
  onState?: ConstructorParameters<typeof StackLifecycle>[2];
  spawn?: SpawnProcess;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  databaseAnswers?: (port: number, signal: AbortSignal) => Promise<void>;
  portFree?: (port: number) => Promise<boolean>;
  allocatePort?: () => Promise<number>;
  healthTimeoutMs?: number;
  /** The archive tool; Windows 10 and 11 ship bsdtar as tar.exe, which reads zip files. */
  tar?: string;
  installServer?: (
    deps: RuntimeDeps,
    bundle: ServerBundle,
  ) => Promise<{ dir: string; manifest: ServerManifest }>;
}

/** Unpacks the Windows bundle (a zip) and checks it names its entrypoints and its Postgres. */
export async function installWindowsServerBundle(
  deps: RuntimeDeps,
  bundle: ServerBundle,
  tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
): Promise<{ dir: string; manifest: ServerManifest }> {
  if (bundle.inPlace) return readServerManifest(bundle.inPlace);
  const source = bundle.download ?? (bundle.file ? { file: bundle.file } : null);
  if (source === null) throw new Error("No server bundle is configured");
  if (bundle.file && bundle.sha256) await verifyFileSha256(bundle.file, bundle.sha256);
  const root = await installVersion(deps, serverDirName(bundle), source, async (archive, into) => {
    const result = await deps.run(tar, ["-xf", archive, "-C", into], {
      cwd: deps.dir,
      env: deps.env,
      timeoutMs: 10 * 60_000,
      signal: deps.signal,
    });
    if (result.code !== 0) throw new DownloadError(`Unpacking the server bundle failed: ${result.stderr}`);
  });
  const dir = path.join(root, "rakazo-server");
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as ServerManifest;
  for (const entry of ["api", "worker", "web", "migrate"] as const) {
    const file = manifest.entrypoints?.[entry];
    const resolved = typeof file === "string" ? path.resolve(dir, file) : "";
    if (!resolved.startsWith(`${dir}${path.sep}`))
      throw new DownloadError(`The server bundle names no ${entry} entrypoint inside itself`);
  }
  return { dir, manifest };
}

/** Postgres's own programs inside the bundle. */
export function postgresBin(serverDir: string, program: string) {
  return path.join(serverDir, "postgres", "bin", `${program}.exe`);
}

/**
 * Run by the server's Node: finds the bundled `pg` package and creates the database once.
 * `pg` sits under node_modules/.pnpm in the bundle, so it is located by name.
 */
export const ENSURE_DATABASE_SCRIPT = `
const fs = require("node:fs"), path = require("node:path");
const store = path.join(process.env.GENTE_SERVER_DIR, "node_modules", ".pnpm");
const dir = fs.readdirSync(store).find((d) => /^pg@\\d/.test(d));
const { Client } = require(path.join(store, dir, "node_modules", "pg"));
(async () => {
  const c = new Client({ connectionString: process.env.GENTE_PG_URL });
  await c.connect();
  const name = process.env.GENTE_DATABASE;
  const r = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (r.rowCount === 0) await c.query('CREATE DATABASE "' + name.replace(/"/g, "") + '"');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
`;

export class WindowsStackController extends StackLifecycle {
  private services: Service[] = [];
  /** Set once the bundle is unpacked, so a stop can ask Postgres to shut down cleanly. */
  private serverDir: string | null = null;
  private postgresUp = false;

  constructor(private readonly deps: WindowsStackDeps) {
    super(deps.imageTag, deps.localWebUrl, deps.onState);
  }

  managedStackRunning(): boolean {
    return this.services.some((s) => s.alive) || ACTIVE_PHASES.has(this.current.phase);
  }

  async matchesDesiredStack(): Promise<boolean> {
    const live = () =>
      !this.stopInFlight() &&
      this.current.phase === "ready" &&
      this.services.every((service) => service.alive);
    if (!live()) return false;
    const token = await readStackToken(this.deps.stackDir);
    if (token === null) return false;
    try {
      const probed = await this.deps.probe(this.currentWebUrl, AbortSignal.timeout(2_000), token);
      return probed === this.deps.imageTag && live();
    } catch {
      return false;
    }
  }

  protected async shutdown() {
    await this.stopServices();
    this.setState(initialStackState(this.deps.imageTag));
  }

  protected async attemptFailed(error: unknown, signal: AbortSignal) {
    await this.stopServices();
    if (signal.aborted) this.push({ type: "failed", message: startInterrupted() });
    else if (error instanceof StartFailure)
      this.push({ type: "failed", message: error.userMessage, output: error.output });
    else
      this.push({
        type: "failed",
        message: servicesFailed(),
        output: [error instanceof Error ? error.message : String(error)],
      });
  }

  private dir(...parts: string[]) {
    return path.join(this.deps.stackDir, ...parts);
  }

  private baseEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const pathValue = this.deps.env.PATH ?? this.deps.env.Path;
    if (pathValue) env.PATH = pathValue;
    for (const name of INHERITED_ENV) {
      const value = this.deps.env[name];
      if (value) env[name] = value;
    }
    return env;
  }

  private nodeEnv(): Record<string, string> {
    return {
      ...this.baseEnv(),
      ELECTRON_RUN_AS_NODE: "1",
      RAKAZO_ENV_FILE: "none",
      NODE_ENV: "production",
    };
  }

  private async runTool(command: string, args: string[], env: Record<string, string>, signal: AbortSignal) {
    return this.deps.run(command, args, {
      cwd: this.deps.stackDir,
      env,
      timeoutMs: CLI_TIMEOUT_MS,
      signal,
      onLine: (line) => this.push({ type: "output", line }),
    });
  }

  protected async attempt(signal: AbortSignal) {
    this.push({ type: "check-start" });
    await this.stopServices();
    for (const sub of ["runtime", "logs", "run", "data"])
      await mkdir(this.dir(sub), { recursive: true, mode: 0o700 });
    this.push({ type: "prepare" });
    const template = await readFile(path.join(this.deps.resourceDir, STACK_ENV_TEMPLATE), "utf8");
    await ensureStackEnv(this.deps.stackDir, template, this.deps.randomHex);
    const stackToken = await ensureStackToken(this.deps.stackDir, this.deps.randomHex);
    // Gente: the vault key and sign-in secret live in the OS keychain, not in the plain .env.
    if (this.deps.sealer) await sealStackSecrets(this.deps.stackDir, this.deps.sealer);
    const stackEnv = this.deps.sealer
      ? await unsealStackEnv(
          this.deps.stackDir,
          parseStackEnv(await readFile(this.dir(STACK_ENV_FILE), "utf8")),
          this.deps.sealer,
        )
      : parseStackEnv(await readFile(this.dir(STACK_ENV_FILE), "utf8"));

    this.push({ type: "pull-start" });
    let server: { dir: string; manifest: ServerManifest };
    try {
      server = await (this.deps.installServer ??
        ((d, b) => installWindowsServerBundle(d, b, this.deps.tar)))(
        {
          dir: this.dir("runtime"),
          run: this.deps.run,
          fetch: this.deps.fetch,
          env: this.baseEnv(),
          signal,
          onBytes: (name, bytes) => this.push({ type: "download", name, bytes }),
          onLine: (line) => this.push({ type: "output", line }),
        },
        this.deps.serverBundle,
      );
    } catch (error) {
      if (signal.aborted) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new StartFailure(error instanceof DownloadError ? downloadFailed() : servicesFailed(), [detail]);
    }

    this.serverDir = server.dir;
    this.push({ type: "up-start" });
    const password = stackEnv.get("POSTGRES_PASSWORD") ?? "";
    const appPassword = stackEnv.get("POSTGRES_APP_PASSWORD") ?? "";
    const portFree = this.deps.portFree ?? portFreeOnLoopback;
    const allocate = this.deps.allocatePort ?? allocateLoopbackPort;
    const ports = await this.ports();
    ports.postgres = await choosePort(ports.postgres, portFree, allocate);
    await writePrivateFile(this.dir(WINDOWS_PORTS_FILE), JSON.stringify(ports));

    // First start: a new cluster owned by `rakazo`, password-only, listening on loopback only.
    const pgdata = this.dir("pgdata");
    if (!this.deps.exists(path.join(pgdata, "PG_VERSION"))) {
      await rm(pgdata, { recursive: true, force: true });
      const pwfile = this.dir("run", "initdb.pw");
      await writeFile(pwfile, password, { mode: 0o600 });
      try {
        const init = await this.runTool(
          postgresBin(server.dir, "initdb"),
          ["-D", pgdata, "-U", OWNER, "-E", "UTF8", "--locale=C", "-A", "scram-sha-256", `--pwfile=${pwfile}`],
          this.baseEnv(),
          signal,
        );
        if (init.code !== 0)
          throw new StartFailure(servicesFailed(), [...init.stderr.trim().split("\n").slice(-5), "initdb failed"]);
      } finally {
        await rm(pwfile, { force: true });
      }
    }
    // pg_ctl drops administrator rights before starting Postgres, which refuses to run as an
    // administrator; a server a crashed launch left running is stopped first.
    await this.stopPostgres(server.dir);
    const started = await this.deps.run(
      postgresBin(server.dir, "pg_ctl"),
      [
        "start",
        "-D",
        pgdata,
        "-l",
        this.dir("logs", "postgres.log"),
        "-w",
        "-t",
        "120",
        "-o",
        `-p ${ports.postgres} -c listen_addresses=127.0.0.1`,
      ],
      { cwd: this.deps.stackDir, env: this.baseEnv(), timeoutMs: 150_000, signal },
    );
    if (started.code !== 0)
      throw new StartFailure(servicesFailed(), [started.stdout, started.stderr, "pg_ctl start failed"]);
    this.postgresUp = true;
    await this.waitForDatabase(ports.postgres, signal);
    // The embedded binaries have no psql: create the database with the server's own pg client.
    const ensured = await this.deps.run(
      this.deps.nodeBinary,
      ["-e", ENSURE_DATABASE_SCRIPT],
      {
        cwd: server.dir,
        env: {
          ...this.nodeEnv(),
          GENTE_PG_URL: `postgres://${OWNER}:${encodeURIComponent(password)}@127.0.0.1:${ports.postgres}/postgres`,
          GENTE_DATABASE: DATABASE,
          GENTE_SERVER_DIR: server.dir,
        },
        timeoutMs: CLI_TIMEOUT_MS,
        signal,
        onLine: (line) => this.push({ type: "output", line }),
      },
    );
    if (ensured.code !== 0)
      throw new StartFailure(servicesFailed(), [ensured.stderr, "creating the database failed"]);

    const at = (user: string, secret: string) =>
      `postgres://${encodeURIComponent(user)}:${encodeURIComponent(secret)}@127.0.0.1:${ports.postgres}/${DATABASE}`;
    const databaseUrl = at(APP_LOGIN, appPassword);
    const migrated = await this.deps.run(
      this.deps.nodeBinary,
      [path.join(server.dir, server.manifest.entrypoints.migrate)],
      {
        cwd: server.dir,
        env: {
          ...this.nodeEnv(),
          DATABASE_URL: databaseUrl,
          DATABASE_MIGRATION_URL: at(OWNER, password),
          RAKAZO_DB_PACKAGE_DIR: path.join(server.dir, "packages", "db"),
        },
        timeoutMs: MIGRATE_TIMEOUT_MS,
        signal,
        onLine: (line) => this.push({ type: "output", line }),
      },
    );
    if (migrated.code !== 0) throw new StartFailure(servicesFailed(), ["migrations failed"]);

    ports.api = await choosePort(ports.api, portFree, allocate, [ports.postgres]);
    await writePrivateFile(this.dir(WINDOWS_PORTS_FILE), JSON.stringify(ports));
    const webPort = Number(new URL(this.currentWebUrl).port);
    const chosenWeb = await choosePort(webPort, portFree, allocate, [ports.postgres, ports.api]);
    if (chosenWeb !== webPort) this.currentWebUrl = `http://127.0.0.1:${chosenWeb}`;
    await writePrivateFile(this.dir(STACK_WEB_URL_FILE), this.currentWebUrl);

    const composioKey = (await this.deps.composioKey?.().catch(() => undefined)) ??
      (stackEnv.get("GENTE_COMPOSIO_KEY") || undefined);
    const e2bKey =
      (await this.deps.cloudComputerKey?.().catch(() => undefined)) ??
      (stackEnv.get("E2B_API_KEY") || undefined);
    const computer = computerEnv(e2bKey, await readComputerChoice(this.deps.stackDir), "none");
    const telegramToken = await this.deps.telegramToken?.().catch(() => undefined);
    const appEnv = this.appEnv(stackEnv, {
      DATABASE_URL: databaseUrl,
      RAKAZO_DESKTOP_STACK_TOKEN: stackToken,
      ...(composioKey ? { GENTE_COMPOSIO_KEY: composioKey } : {}),
      ...computer,
      // Updates arrive through Gente's long-poll hand-off, signed with this computer's secret.
      ...(telegramToken
        ? { TELEGRAM_BOT_TOKEN: telegramToken, TELEGRAM_WEBHOOK_SECRET_TOKEN: telegramSecret(stackToken) }
        : {}),
      ...searchBrokerEnv(this.deps.searchBroker?.() ?? null),
    });
    await encryptExistingContent({
      run: this.deps.run,
      nodeBinary: this.deps.nodeBinary,
      server,
      env: appEnv,
      marker: this.dir("data", CONTENT_ENCRYPTED_MARKER),
      signal,
      onLine: (line) => this.push({ type: "output", line }),
    });
    const entry = (name: "api" | "worker" | "web" | "migrate") =>
      path.join(server.dir, server.manifest.entrypoints[name]);
    const node = (name: string, args: string[], env: Record<string, string>) =>
      this.service({ name, command: this.deps.nodeBinary, args, cwd: server.dir, env, stopSignal: "SIGTERM" });
    const api = node("api", [entry("api")], {
      ...appEnv,
      API_HOST: "127.0.0.1",
      API_PORT: String(ports.api),
      AUTH_PASSWORD_ENABLED: stackEnv.get("AUTH_PASSWORD_ENABLED") || "true",
      AUTH_BREACHED_PASSWORD_CHECK_ENABLED: stackEnv.get("AUTH_BREACHED_PASSWORD_CHECK_ENABLED") || "false",
    });
    const worker = node("worker", ["--max-semi-space-size=64", entry("worker")], appEnv);
    const web = node("web", [entry("web")], {
      ...this.nodeEnv(),
      ...Object.fromEntries(
        WEB_ENV.flatMap((name) => {
          const value = stackEnv.get(name);
          return value ? [[name, value]] : [];
        }),
      ),
      API_PROXY_TARGET: `http://127.0.0.1:${ports.api}`,
      SCREEN_PROXY_SECRET: stackEnv.get("SCREEN_PROXY_SECRET") ?? "",
      WEB_HOST: "127.0.0.1",
      WEB_PORT: String(chosenWeb),
      RAKAZO_DESKTOP_STACK_TOKEN: stackToken,
      RAKAZO_IMAGE_TAG: this.deps.imageTag,
    });
    for (const service of [api, worker, web]) service.start();

    this.push({ type: "wait-start" });
    const sleep = this.deps.sleep ?? defaultSleep;
    const deadline = Date.now() + (this.deps.healthTimeoutMs ?? STACK_HEALTH_TIMEOUT_MS);
    const crashed = () => this.services.find((service) => !service.alive);
    let apiHealthy = false;
    while (!signal.aborted) {
      const down = crashed();
      if (down) throw new StartFailure(servicesFailed(), [...down.tail, `${down.spec.name} exited`]);
      apiHealthy ||= await this.deps
        .fetch(`http://127.0.0.1:${ports.api}/health`, { signal })
        .then((response) => response.ok)
        .catch(() => false);
      if (apiHealthy && (await this.deps.probe(this.currentWebUrl, signal, stackToken)) === this.deps.imageTag) {
        this.push({ type: "ready" });
        await pruneRuntimes(this.dir("runtime"), [path.basename(path.dirname(server.dir))]).catch(() => undefined);
        return;
      }
      if (Date.now() >= deadline) break;
      await sleep(HEALTH_POLL_INTERVAL_MS, signal);
    }
    if (signal.aborted) throw new Error("aborted");
    throw new StartFailure(servicesFailed(), [...api.tail, ...web.tail].slice(-STACK_OUTPUT_LINES));
  }

  private async waitForDatabase(port: number, signal: AbortSignal) {
    const answers = this.deps.databaseAnswers ?? ((p: number, s: AbortSignal) => postgresAnswers(p, s));
    const sleep = this.deps.sleep ?? defaultSleep;
    for (let attempt = 1; ; attempt++) {
      try {
        return await answers(port, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        if (attempt >= DATABASE_ANSWER_ATTEMPTS)
          throw new StartFailure(servicesFailed(), [`Postgres did not answer on 127.0.0.1:${port}`]);
        await sleep(HEALTH_POLL_INTERVAL_MS, signal);
      }
    }
  }

  private appEnv(stackEnv: Map<string, string>, fixed: Record<string, string>): Record<string, string> {
    const fromFile = Object.fromEntries(
      [...stackEnv].filter(([name, value]) => value !== "" && !COMPOSE_ONLY.test(name)),
    );
    let brain: SavedBrain | null = null;
    try {
      brain = JSON.parse(readFileSync(brainFile(this.deps.stackDir), "utf8")) as SavedBrain;
    } catch {
      brain = null;
    }
    return {
      ...swiftServerEnv(brain),
      ...fromFile,
      ...this.nodeEnv(),
      DATA_DIR: this.dir("data"),
      WAKEUP_DRIVER: "graphile",
      AGENT_RUNTIME: "pi",
      // No VMs on Windows: bots work in chat, and on this PC when the person allows it.
      SANDBOX_PROVIDER: "none",
      SANDBOX_HOST_URL: this.deps.hostComputer
        ? this.deps.hostComputer.url.replace("//host.docker.internal:", "//127.0.0.1:")
        : "",
      SANDBOX_HOST_TOKEN: this.deps.hostComputer?.token ?? "",
      // Gente: chats, memory and files are encrypted at rest; ENCRYPTION_KEY is sealed by DPAPI.
      CONTENT_ENCRYPTION: "on",
      MCP_ALLOW_PRIVATE_ENDPOINT: "true",
      BETTER_AUTH_URL: this.currentWebUrl,
      WEB_ORIGIN: this.currentWebUrl,
      API_URL: this.currentWebUrl,
      ...fixed,
    };
  }

  private async ports(): Promise<WindowsPorts> {
    const raw = await readPrivateFile(this.dir(WINDOWS_PORTS_FILE), 1024);
    try {
      return raw ? (JSON.parse(raw) as WindowsPorts) : {};
    } catch {
      return {};
    }
  }

  private service(spec: ServiceSpec): Service {
    const service = new Service(spec, {
      spawn: this.deps.spawn ?? defaultSpawn,
      logDir: this.dir("logs"),
      runDir: this.dir("run"),
      onCrash: () => this.current.phase === "ready",
    });
    this.services.push(service);
    return service;
  }

  private async stopServices() {
    const services = this.services;
    this.services = [];
    await Promise.all(services.map((s) => s.stop()));
    if (this.serverDir && this.postgresUp) await this.stopPostgres(this.serverDir);
  }

  /** A fast, clean shutdown; nothing to do when no server runs in this data folder. */
  private async stopPostgres(serverDir: string) {
    this.postgresUp = false;
    if (!this.deps.exists(path.join(this.dir("pgdata"), "postmaster.pid"))) return;
    await this.deps
      .run(postgresBin(serverDir, "pg_ctl"), ["stop", "-D", this.dir("pgdata"), "-m", "fast", "-w"], {
        cwd: this.deps.stackDir,
        env: this.baseEnv(),
        timeoutMs: 30_000,
        signal: AbortSignal.timeout(35_000),
      })
      .catch(() => undefined);
  }
}

const defaultSpawn: SpawnProcess = (command, args, options) =>
  spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });

function searchBrokerEnv(broker: { url: string; token: string } | null): Record<string, string> {
  return broker ? { GENTE_SEARCH_URL: broker.url, GENTE_SEARCH_TOKEN: broker.token } : {};
}
