// Modified by DeskHead Inc. in 2026 for Gente (fork of Rakazo, Apache-2.0).
/**
 * `unsupported` covers an unpackaged build and a repository with no published releases, which is
 * the normal state for a fork. It is not an error the user needs to act on. Automatic checks stay
 * frozen after an empty feed; a manual check may retry when the install itself supports updates.
 */
export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "unsupported"
  | "error";

export interface DesktopUpdateState {
  phase: DesktopUpdatePhase;
  /** The installed desktop release, which can drift from the server this app points at. */
  currentVersion: string;
  availableVersion: string | null;
  /** Download progress 0-100, only while `downloading`. */
  percent: number | null;
  message: string | null;
  checkedAt: string | null;
  /** Gente: a one-click fix the UI offers next to `message` (Mac app run from a DMG or Downloads). */
  fix?: "move-to-applications";
}

/** Gente Link v1: one message inside the sealed envelope, by `type`. */
export type GenteLinkMessage = { type: string; [field: string]: unknown };

/** Gente: the phone pairing state shown in Settings → Devices. */
export interface GenteLinkState {
  status: "off" | "waiting" | "paired" | "signed_out";
  /** The QR code to scan, as an image data URL, while waiting. */
  qrImage?: string;
  /** The 4-digit safety code both screens show once the phone said hello. */
  code?: string;
  phoneName?: string;
}

/** Gente: the "Make my AI private" offer, a waitlist for now. */
export interface GentePrivateOffer {
  monthlyCents: number;
  onWaitlist: boolean;
  waiting: number;
}

/** Gente: where the AI runs now, and whether the person picked it (otherwise it follows the plan). */
export interface GenteAiMode {
  mode: "fast" | "private";
  picked: boolean;
  /** Fast needs a paid plan; Private always works. */
  fastAvailable: boolean;
}

/** Gente: what the app shows about the person's account. Unknown values stay null. */
export interface GenteAccountState {
  signedIn: boolean;
  /** Plan name from Gente Cloud, for example "Free" or "Pro"; null when signed out or offline. */
  plan: string | null;
  messagesUsed: number | null;
  messagesLimit: number | null;
  /** Hours of online work left this month; null when unknown. */
  hoursLeft: number | null;
  monthlyHours: number | null;
}

export interface RakazoDesktopUpdate {
  state: () => Promise<DesktopUpdateState>;
  check: () => Promise<DesktopUpdateState>;
  download: () => Promise<DesktopUpdateState>;
  /** Quits and relaunches into the downloaded release; only useful once `phase` is `ready`. */
  install: () => Promise<DesktopUpdateState>;
  /** Gente: one click; checks, downloads, verifies, installs and relaunches as needed. */
  updateNow?: () => Promise<DesktopUpdateState>;
  /** Gente (Mac): moves the app to Applications and relaunches it from there. */
  moveToApplications?: () => Promise<DesktopUpdateState>;
}

export interface RakazoDesktopOAuthCallback {
  code: string;
  state?: string;
}

/**
 * A per-server MCP sign-in window is named this prefix plus its server id, so
 * the desktop shell can give it that server's own browser session.
 */
export const MCP_SIGNIN_WINDOW_PREFIX = "rakazo-mcp-signin:";

/** A code the app's own MCP callback page carried, captured before that page loads. */
export interface RakazoDesktopMcpOAuthCallback {
  serverId: string;
  /** Null when the provider refused or the user declined. */
  code: string | null;
  state: string;
}

export interface RakazoDesktopDevice {
  /** Null until paired. */
  deviceId: string | null;
  name: string;
  allowed: boolean;
}

/**
 * What the system recognizer reports for one listening session, shaped after Web Speech:
 * `result` carries the session's whole text so far, `error` a Web Speech error code,
 * and `end` always comes last.
 */
export type RakazoDesktopSpeechEvent =
  | { session: number; type: "result"; text: string }
  | { session: number; type: "error"; error: string }
  | { session: number; type: "end" };

/** App menu items the page carries out; each matches a shortcut the page also handles itself. */
export const DESKTOP_MENU_COMMANDS = [
  "new",
  "command-menu",
  "search",
  "toggle-sidebar",
  "back",
  "forward",
  "next-bot",
  "previous-bot",
  "new-group",
  "integrations",
  "chat-panel",
  "shortcuts",
  "find",
] as const;

export type DesktopMenuCommand = (typeof DESKTOP_MENU_COMMANDS)[number];

export function isDesktopMenuCommand(value: unknown): value is DesktopMenuCommand {
  return (DESKTOP_MENU_COMMANDS as readonly unknown[]).includes(value);
}

export interface RakazoDesktop {
  /** Optional for older desktop releases. Returns false when the native write is refused. */
  clipboard?: {
    writeText: (text: string) => Promise<boolean>;
  };
  /** Optional for compatibility with older desktop releases. */
  badge?: {
    set: (count: number) => Promise<boolean>;
  };
  computer?: {
    /** Native main persists host choice through its local capability, never a user session. */
    managesHostChoice?: boolean;
    requestAccess: () => Promise<boolean>;
    revokeAccess: () => Promise<void>;
    onConfigure: (listener: () => void) => () => void;
  };
  /** Optional for compatibility with older desktop releases. */
  device?: {
    /** Null when the app shows its own local server. */
    state: () => Promise<RakazoDesktopDevice | null>;
    /** Turning it on asks with a native prompt the page cannot answer. */
    setAllowed: (allowed: boolean) => Promise<RakazoDesktopDevice | null>;
  };
  /** Absent on older desktop releases, whose menus carry no app commands. */
  menu?: {
    onCommand: (listener: (command: DesktopMenuCommand) => void) => () => void;
  };
  /** False for local builds, whose errors must not reach production reporting. Absent on older releases. */
  monitoring?: {
    enabled: () => Promise<boolean>;
  };
  /** Optional for compatibility with older desktop releases. */
  locale?: {
    /** The language the page shows, so the app's own menus, dialogs and setup window follow it. */
    set: (locale: string) => Promise<void>;
  };
  /** Optional for compatibility with older desktop releases. */
  passkeys?: {
    /** Relying parties this build is associated with for system passkeys (macOS); others fail. */
    rpIds: () => Promise<string[]>;
  };
  /** Absent on older desktop releases. */
  server?: {
    /** Opens the desktop setup window to pick another Rakazo server. */
    change: () => Promise<void>;
  };
  /** Gente: the person's Gente account (Clerk sign-in) and plan from Gente Cloud. */
  gente?: {
    account: () => Promise<GenteAccountState>;
    /** Opens Clerk's sign-in in the system browser and resolves when it finishes. */
    signIn: () => Promise<GenteAccountState>;
    signOut: () => Promise<GenteAccountState>;
    /** Counts one message against the free plan; false means the free messages are used up. */
    consumeMessage: (messageId: string) => Promise<boolean>;
    /** Where the AI runs: Fast (Gente Cloud) or Private (this computer). */
    aiMode: () => Promise<GenteAiMode>;
    setAiMode: (mode: "fast" | "private") => Promise<GenteAiMode>;
    /** "Make my AI private" waitlist; null when signed out or offline. */
    privateOffer: () => Promise<GentePrivateOffer | null>;
    setPrivateWaitlist: (join: boolean) => Promise<GentePrivateOffer | null>;
    /** Settings → Devices: pairing a phone (Gente Link v1). */
    linkState: () => Promise<GenteLinkState>;
    linkStart: () => Promise<GenteLinkState>;
    linkUnpair: () => Promise<GenteLinkState>;
    /** Messages from the paired phone for the app window (taken once). */
    linkTake?: () => Promise<GenteLinkMessage[]>;
    /** Sends a message to the paired phone; false when none is paired or it isn't allowed. */
    linkSend?: (message: GenteLinkMessage) => Promise<boolean>;
  };
  /** Absent on older desktop releases, which have no Settings… menu item. */
  settings?: {
    /** The app menu's Settings… item; the OS claims Cmd+, before any page keydown can. */
    onOpen: (listener: () => void) => () => void;
  };
  /** Calls the desktop app recorded and transcribed on this computer, as transcript text. */
  meetings?: {
    onTranscript: (listener: (text: string) => void) => () => void;
  };
  /**
   * The operating system's own speech recognition, so dictation needs no provider key.
   * Absent on platforms without one and on older desktop releases.
   */
  speech?: {
    /** Listens in `language` until stopped. False when refused; no events follow then. */
    start: (language: string, session: number) => Promise<boolean>;
    /** Ends the utterance: its final text and `end` still arrive. */
    stop: (session: number) => Promise<void>;
    abort: (session: number) => Promise<void>;
    onEvent: (listener: (event: RakazoDesktopSpeechEvent) => void) => () => void;
  };
  /**
   * The browser each MCP server signs in through. Every server gets its own
   * cookie jar, so one provider account never leaks into another server's
   * sign-in. Absent on older desktop releases, which share the app's session.
   */
  mcpBrowser?: {
    /** Empties that jar, cache included, so the next sign-in looks like a first visit. */
    clear: (serverId: string) => Promise<void>;
    /**
     * Codes captured from that browser's redirect to the app callback, which has
     * no app session of its own. Returns an unsubscribe function.
     */
    onOAuthCallback: (listener: (callback: RakazoDesktopMcpOAuthCallback) => void) => () => void;
  };
  platform: string;
  /** Absent on older frameless releases, which still need in-app controls. */
  nativeWindowFrame?: boolean;
  window: {
    close: () => Promise<void>;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    state: () => Promise<{ minimized: boolean; maximized: boolean; fullScreen: boolean }>;
  };
  update: RakazoDesktopUpdate;
  oauth: {
    /**
     * Open system-browser auth. A redirect_uri must be HTTP loopback with state;
     * URLs without a redirect use backend polling. Optional for older desktops.
     */
    open?: (authorizationUrl: string) => Promise<void>;
    cancel?: (authorizationUrl: string) => Promise<void>;
    /**
     * Authorization codes captured from the system browser or a legacy popup.
     * Returns an unsubscribe function.
     */
    onCallback: (listener: (callback: RakazoDesktopOAuthCallback) => void) => () => void;
  };
}

/**
 * How the desktop app was pointed at a Rakazo server during first-run setup.
 * `new` is the Docker Compose stack this app installs and runs on the same computer.
 */
export type DesktopInstanceMode = "new" | "existing";

export interface DesktopSetup {
  mode: DesktopInstanceMode;
  serverUrl: string;
  /** Sent with every request to an existing server, such as an access proxy's credentials. */
  headers?: Record<string, string>;
}

export interface DesktopSetupState {
  defaultLocalUrl: string;
  /** Hosted Rakazo origin, saved as an `existing` server when chosen. */
  cloudUrl: string;
  saved: DesktopSetup | null;
  /** Present when a saved or newly selected server could not be reopened. */
  error?: string;
}

export interface DesktopReachability {
  ok: boolean;
  /** HTTP status when the server answered, absent when it could not be reached. */
  status?: number;
  /** Normalized URL that was probed, absent when the input was not a usable URL. */
  url?: string;
  error?: string;
}

export interface DesktopStackProbeResponse {
  ok: true;
  imageTag: string;
}

/**
 * Lifecycle of the Docker Compose stack the desktop app manages for mode `new`.
 * `docker-missing` and `docker-not-running` wait for the person to act; `ready` and
 * `failed` are terminal until the next start.
 */
export type DesktopLocalStackPhase =
  | "idle"
  | "checking-docker"
  | "docker-missing"
  | "docker-not-running"
  | "preparing"
  | "pulling"
  | "starting"
  | "waiting-healthy"
  | "ready"
  | "failed";

export interface DesktopLocalStackState {
  phase: DesktopLocalStackPhase;
  /** One actionable sentence; null while the stack is progressing normally. */
  message: string | null;
  /** Bounded tail of docker output for the current attempt. */
  output: string[];
  /** Bytes pulled per image layer in the current attempt; the sum is the only progress Docker reports. */
  layerBytes: Record<string, number>;
  /** Image tag this app launches (`v<app version>` for installed builds, `edge` otherwise). */
  imageTag: string;
}

/** The official Docker download for this platform (an installer, or Linux install docs). */
export type DesktopSetupLink = "docker-download";

/** Gente: where the local Swift model is in its first-run setup. */
export interface GenteBrainState {
  phase:
    | "checking"
    | "ollama-missing"
    | "installing-ollama"
    | "starting-ollama"
    | "pulling"
    | "loading"
    | "ready"
    | "failed";
  model: { tag: string; alias: string; name: string; sizeGB: number; note: string };
  completedBytes: number;
  totalBytes: number;
  message: string;
  switchedFrom?: string;
  models: readonly { tag: string; alias: string; name: string; sizeGB: number; note: string }[];
}

/**
 * Bridge exposed only to the first-run setup window. The app window keeps the
 * narrower `rakazoDesktop` bridge so a connected server can never re-point the app.
 */
export interface RakazoSetup {
  /** Used only to reserve space for native window controls in the local setup UI. */
  platform: string;
  /** The page's language and its translations, keyed by the English text; empty for English. */
  locale: { lang: string; dir: "ltr" | "rtl"; messages: Readonly<Record<string, string>> };
  state: () => Promise<DesktopSetupState>;
  test: (url: string, headers?: Record<string, string>) => Promise<DesktopReachability>;
  save: (setup: DesktopSetup) => Promise<{ ok: boolean; error?: string }>;
  quit: () => Promise<void>;
  /** Opens the Docker download in the system browser; the person runs the installer. */
  openLink: (link: DesktopSetupLink) => Promise<void>;
  /** Gente: the local Swift model through Ollama (find or install, pull, load). */
  brain: {
    state: () => Promise<GenteBrainState>;
    start: (options?: { installOllama?: boolean; model?: string }) => Promise<GenteBrainState>;
    onChange: (listener: (state: GenteBrainState) => void) => void;
  };
  /** The Docker Compose stack this app installs and runs for mode `new`. */
  stack: {
    state: () => Promise<DesktopLocalStackState>;
    /** Starts (or retries) the stack; a no-op while a start is already in flight. */
    start: () => Promise<DesktopLocalStackState>;
    /** Fires on every state change so progress never depends on a renderer timer. */
    onChange: (listener: (state: DesktopLocalStackState) => void) => void;
  };
}
