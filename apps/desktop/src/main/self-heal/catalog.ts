// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Every way Gente is known to break, with its detector, its repair ladder (cheapest first) and
// what the person reads. Each entry has a chaos test in scripts/self-heal/chaos-catalog.ts that
// injects the fault for real and times the recovery; CI fails when a repair stops working or gets
// slower than its budget. docs/gente/self-heal-catalog.md is generated from this file.
import type { FailureSpec } from "./engine.js";

/** What the catalog reads and does. The desktop app and the chaos suite each provide one. */
export interface HealEnv {
  // Reads: fast and local, no model work.
  ollamaUp(): Promise<boolean>;
  modelState(): Promise<"ready" | "missing" | "corrupt" | "unknown">;
  /** Recent time to first answer byte from this computer's model, in ms; null with no recent reply. */
  localLatencyMs(): number | null;
  postgresUp(): Promise<boolean>;
  apiUp(): Promise<boolean>;
  /** "stalled": alive but not taking jobs (it lost its database); "down": no process. */
  worker(): Promise<"ok" | "stalled" | "down" | "unknown">;
  portHeldByOther(): Promise<boolean>;
  missingAppFiles(): Promise<string[]>;
  freeDiskBytes(): Promise<number | null>;
  /** Known failure lines seen in the service logs since the last read. */
  logSignals(): Promise<ReadonlySet<LogSignal>>;
  /** Gente Cloud's model as this computer sees it; "unused" in private mode. */
  cloudModel(): Promise<"warm" | "cold" | "stub" | "down" | "unused">;
  /** The person's Gente sign-in. */
  signIn(): Promise<"ok" | "expired" | "signed-out">;
  /** The loopback relay to Gente Cloud (connected apps); null when it is not used. */
  relayUp(): Promise<boolean | null>;
  route(): "cloud" | "local";
  /** Bots' computers run on this computer (not the online one). */
  computerIsLocal(): Promise<boolean>;
  // Repairs.
  retryOllama(): Promise<void>;
  startOllama(): Promise<void>;
  restartService(name: "postgres" | "api" | "worker" | "web" | "relay"): Promise<void>;
  resetStack(): Promise<void>;
  redownloadModel(): Promise<void>;
  clearCaches(): Promise<void>;
  refreshSignIn(): Promise<void>;
  /** Sends replies to Gente Cloud or this computer until the other side is healthy again. */
  preferRoute(where: "cloud" | "local" | "auto"): void;
  useLocalComputer(): Promise<void>;
  /** Lets Gente Cloud's operators know (balance, template); the person needs to do nothing. */
  notifyCloud(failureId: string): Promise<void>;
}

export type LogSignal =
  | "computer-template-missing"
  | "apps-not-configured"
  | "media-balance-empty"
  | "sign-in-rejected";

export const SLOW_REPLY_MS = 20_000;
export const LOW_DISK_BYTES = 3e9;

const c = (en: string, es: string, pt: string) => ({ en, es, pt });

export const CATALOG: readonly FailureSpec<HealEnv>[] = [
  {
    id: "worker-stalled",
    component: "worker",
    critical: true,
    everyMs: 1_000,
    confirm: 2,
    budgetMs: 8_000,
    detect: async (env) => {
      const w = await env.worker();
      return { broken: w === "stalled" || w === "down", detail: w };
    },
    ladder: [
      {
        kind: "restart",
        id: "restart-worker",
        did: c(
          "restarted the part that runs tasks",
          "reinicié la parte que hace las tareas",
          "reiniciei a parte que faz as tarefas",
        ),
        run: (env) => env.restartService("worker"),
        verifyWithinMs: 6_000,
      },
      {
        kind: "reset",
        id: "reset-stack",
        did: c(
          "restarted the whole workspace",
          "reinicié todo el espacio de trabajo",
          "reiniciei todo o espaço de trabalho",
        ),
        run: (env) => env.resetStack(),
        verifyWithinMs: 60_000,
        heavy: true,
      },
    ],
    what: c("tasks stopped running", "las tareas dejaron de correr", "as tarefas pararam de rodar"),
    calm: c(
      "Gente couldn't restart its tasks. Your chats are safe. Restart your computer if it keeps happening.",
      "Gente no pudo reiniciar sus tareas. Tus chats están a salvo. Reinicia tu computadora si sigue pasando.",
      "O Gente não conseguiu reiniciar as tarefas. Suas conversas estão seguras. Reinicie o computador se continuar.",
    ),
  },
  {
    id: "database-stopped",
    component: "database",
    critical: true,
    everyMs: 1_000,
    confirm: 1,
    budgetMs: 8_000,
    detect: async (env) => ({ broken: !(await env.postgresUp()) }),
    ladder: [
      {
        kind: "restart",
        id: "restart-database",
        did: c(
          "started the database again",
          "volví a encender la base de datos",
          "liguei o banco de dados de novo",
        ),
        run: (env) => env.restartService("postgres"),
        verifyWithinMs: 6_000,
      },
      {
        kind: "reset",
        id: "reset-stack",
        did: c(
          "restarted the whole workspace",
          "reinicié todo el espacio de trabajo",
          "reiniciei todo o espaço de trabalho",
        ),
        run: (env) => env.resetStack(),
        verifyWithinMs: 60_000,
        heavy: true,
      },
    ],
    what: c(
      "your saved chats stopped opening",
      "tus chats guardados dejaron de abrir",
      "suas conversas salvas pararam de abrir",
    ),
    calm: c(
      "Gente can't open your saved chats right now. They're safe on this computer. Restart your computer if it keeps happening.",
      "Gente no puede abrir tus chats guardados ahora. Están a salvo en esta computadora. Reinicia tu computadora si sigue pasando.",
      "O Gente não consegue abrir suas conversas agora. Elas estão seguras neste computador. Reinicie o computador se continuar.",
    ),
  },
  {
    id: "api-down",
    component: "workspace",
    critical: true,
    everyMs: 1_000,
    confirm: 2,
    budgetMs: 8_000,
    detect: async (env) => ({ broken: !(await env.apiUp()) }),
    ladder: [
      {
        kind: "restart",
        id: "restart-api",
        did: c("restarted the assistant", "reinicié el asistente", "reiniciei o assistente"),
        run: (env) => env.restartService("api"),
        verifyWithinMs: 6_000,
      },
      {
        kind: "reset",
        id: "reset-stack",
        did: c(
          "restarted the whole workspace",
          "reinicié todo el espacio de trabajo",
          "reiniciei todo o espaço de trabalho",
        ),
        run: (env) => env.resetStack(),
        verifyWithinMs: 60_000,
        heavy: true,
      },
    ],
    what: c(
      "the assistant stopped responding",
      "el asistente dejó de responder",
      "o assistente parou de responder",
    ),
    calm: c(
      "Gente is having trouble starting. Your chats are safe. Restart your computer if it keeps happening.",
      "Gente tiene problemas para arrancar. Tus chats están a salvo. Reinicia tu computadora si sigue pasando.",
      "O Gente está com problemas para iniciar. Suas conversas estão seguras. Reinicie o computador se continuar.",
    ),
  },
  {
    id: "model-server-down",
    component: "model",
    critical: true,
    everyMs: 1_000,
    confirm: 2,
    budgetMs: 8_000,
    detect: async (env) => ({ broken: !(await env.ollamaUp()) }),
    ladder: [
      {
        kind: "fallback",
        id: "answer-from-cloud",
        did: c(
          "answered from Gente Cloud while it came back",
          "respondí desde Gente Cloud mientras volvía",
          "respondi pelo Gente Cloud enquanto ele voltava",
        ),
        // Only in fast mode: private mode never sends a reply to the cloud.
        run: async (env) => {
          if ((await env.cloudModel()) === "warm") env.preferRoute("cloud");
          await env.startOllama();
        },
        verifyWithinMs: 6_000,
      },
      {
        kind: "restart",
        id: "start-model-server",
        did: c("started the model again", "volví a iniciar el modelo", "iniciei o modelo de novo"),
        run: (env) => env.startOllama(),
        verifyWithinMs: 20_000,
      },
    ],
    what: c("the model stopped", "el modelo se detuvo", "o modelo parou"),
    calm: c(
      "Gente's model isn't running. Restart your computer if it keeps happening.",
      "El modelo de Gente no está funcionando. Reinicia tu computadora si sigue pasando.",
      "O modelo do Gente não está rodando. Reinicie o computador se continuar.",
    ),
  },
  {
    id: "slow-replies",
    component: "model",
    critical: false,
    everyMs: 2_000,
    confirm: 2,
    budgetMs: 6_000,
    detect: async (env) => {
      const ms = env.localLatencyMs();
      // Only while replies are coming from this computer; a cloud route is the repair.
      return {
        broken: env.route() === "local" && ms !== null && ms > SLOW_REPLY_MS,
        detail: `${ms} ms`,
      };
    },
    ladder: [
      {
        kind: "fallback",
        id: "answer-from-cloud",
        did: c(
          "answered from Gente Cloud",
          "respondí desde Gente Cloud",
          "respondi pelo Gente Cloud",
        ),
        run: async (env) => {
          if ((await env.cloudModel()) === "warm") env.preferRoute("cloud");
        },
        verifyWithinMs: 1_000,
      },
    ],
    what: c(
      "replies were slow because the model was busy",
      "las respuestas iban lentas porque el modelo estaba ocupado",
      "as respostas estavam lentas porque o modelo estava ocupado",
    ),
    // Private mode has no faster option; Gente stays quiet and the reply just takes longer.
    calm: null,
  },
  {
    id: "cloud-model-unavailable",
    component: "cloud",
    critical: true,
    everyMs: 1_000,
    confirm: 1,
    budgetMs: 3_000,
    detect: async (env) => {
      const cloud = await env.cloudModel();
      return {
        broken:
          env.route() === "cloud" && (cloud === "cold" || cloud === "stub" || cloud === "down"),
        detail: cloud,
      };
    },
    ladder: [
      {
        kind: "fallback",
        id: "answer-on-this-computer",
        did: c(
          "answered on this computer instead",
          "respondí en esta computadora",
          "respondi neste computador",
        ),
        run: async (env) => env.preferRoute("local"),
        verifyWithinMs: 1_000,
      },
    ],
    what: c(
      "Gente Cloud was warming up",
      "Gente Cloud se estaba encendiendo",
      "o Gente Cloud estava ligando",
    ),
    calm: null,
  },
  {
    id: "bundle-module-missing",
    component: "app",
    critical: false,
    everyMs: 30_000,
    confirm: 1,
    budgetMs: 35_000,
    detect: async (env) => {
      const missing = await env.missingAppFiles();
      return { broken: missing.length > 0, detail: missing.slice(0, 3).join(", ") };
    },
    ladder: [
      {
        kind: "report",
        id: "report-for-update",
        did: c(
          "asked for an update to repair it",
          "pedí una actualización para arreglarlo",
          "pedi uma atualização para consertar",
        ),
        // Nothing on this computer can restore a file the build left out; the fleet report does.
        run: (env) => env.notifyCloud("bundle-module-missing"),
        verifyWithinMs: 0,
      },
    ],
    what: c(
      "part of the app was missing",
      "faltaba una parte de la app",
      "faltava uma parte do app",
    ),
    calm: c(
      "Part of Gente is missing. An update will fix it; reinstalling works too.",
      "Falta una parte de Gente. Una actualización lo arregla; reinstalar también funciona.",
      "Falta uma parte do Gente. Uma atualização conserta; reinstalar também funciona.",
    ),
  },
  {
    id: "computer-template-missing",
    component: "cloud",
    critical: false,
    everyMs: 2_000,
    confirm: 1,
    budgetMs: 5_000,
    detect: async (env) => ({ broken: (await env.logSignals()).has("computer-template-missing") }),
    healthy: (env) => env.computerIsLocal(),
    ladder: [
      {
        kind: "fallback",
        id: "use-this-computer",
        did: c(
          "ran the task on this computer instead of the cloud",
          "hice la tarea en esta computadora en vez de la nube",
          "fiz a tarefa neste computador em vez da nuvem",
        ),
        run: async (env) => {
          await env.useLocalComputer();
          await env.notifyCloud("computer-template-missing");
        },
        verifyWithinMs: 3_000,
      },
    ],
    what: c(
      "the online computer wasn't available",
      "la computadora en línea no estaba disponible",
      "o computador online não estava disponível",
    ),
    calm: null,
  },
  {
    id: "sign-in-expired",
    component: "account",
    critical: false,
    everyMs: 2_000,
    confirm: 1,
    budgetMs: 5_000,
    detect: async (env) => ({ broken: (await env.signIn()) === "expired" }),
    ladder: [
      {
        kind: "reconnect",
        id: "refresh-sign-in",
        did: c("renewed your sign-in", "renové tu inicio de sesión", "renovei seu login"),
        run: (env) => env.refreshSignIn(),
        verifyWithinMs: 3_000,
      },
    ],
    what: c("your sign-in ran out", "tu sesión venció", "seu login expirou"),
    calm: c(
      "Please sign in to Gente again. Your chats are safe.",
      "Vuelve a iniciar sesión en Gente. Tus chats están a salvo.",
      "Entre no Gente de novo. Suas conversas estão seguras.",
    ),
  },
  {
    id: "relay-down",
    component: "connections",
    critical: false,
    everyMs: 2_000,
    confirm: 2,
    budgetMs: 8_000,
    detect: async (env) => ({ broken: (await env.relayUp()) === false }),
    ladder: [
      {
        kind: "restart",
        id: "restart-relay",
        did: c("reconnected your apps", "volví a conectar tus apps", "reconectei seus apps"),
        run: (env) => env.restartService("relay"),
        verifyWithinMs: 4_000,
      },
    ],
    what: c(
      "your connected apps lost their link",
      "tus apps conectadas perdieron el enlace",
      "seus apps conectados perderam o link",
    ),
    calm: c(
      "Your connected apps can't be reached right now. Gente keeps trying.",
      "No se puede llegar a tus apps conectadas ahora. Gente sigue intentando.",
      "Não dá para acessar seus apps conectados agora. O Gente continua tentando.",
    ),
  },
  {
    id: "disk-full",
    component: "disk",
    critical: false,
    everyMs: 5_000,
    confirm: 1,
    budgetMs: 8_000,
    detect: async (env) => {
      const free = await env.freeDiskBytes();
      return {
        broken: free !== null && free < LOW_DISK_BYTES,
        detail: free === null ? undefined : `${(free / 1e9).toFixed(1)} GB`,
      };
    },
    ladder: [
      {
        kind: "retry",
        id: "clear-cache",
        did: c(
          "cleared Gente's temporary files",
          "borré los archivos temporales de Gente",
          "apaguei os arquivos temporários do Gente",
        ),
        run: (env) => env.clearCaches(),
        verifyWithinMs: 2_000,
      },
    ],
    what: c("the disk was almost full", "el disco estaba casi lleno", "o disco estava quase cheio"),
    calm: c(
      "Your disk is almost full. Free up a few GB so Gente can keep working.",
      "Tu disco está casi lleno. Libera unos GB para que Gente siga funcionando.",
      "Seu disco está quase cheio. Libere alguns GB para o Gente continuar.",
    ),
  },
  {
    id: "port-in-use",
    component: "network",
    critical: true,
    everyMs: 1_000,
    confirm: 2,
    budgetMs: 8_000,
    detect: async (env) => ({ broken: await env.portHeldByOther() }),
    ladder: [
      {
        kind: "restart",
        id: "restart-on-free-port",
        did: c(
          "moved Gente to a free address",
          "moví Gente a una dirección libre",
          "mudei o Gente para um endereço livre",
        ),
        // Starting the API again picks a free port when the saved one is taken.
        run: (env) => env.restartService("api"),
        verifyWithinMs: 6_000,
      },
      {
        kind: "reset",
        id: "reset-stack",
        did: c(
          "restarted the whole workspace",
          "reinicié todo el espacio de trabajo",
          "reiniciei todo o espaço de trabalho",
        ),
        run: (env) => env.resetStack(),
        verifyWithinMs: 60_000,
        heavy: true,
      },
    ],
    what: c(
      "another app took Gente's address",
      "otra app tomó la dirección de Gente",
      "outro app pegou o endereço do Gente",
    ),
    calm: c(
      "Another app is using what Gente needs. Restart your computer if it keeps happening.",
      "Otra app usa lo que Gente necesita. Reinicia tu computadora si sigue pasando.",
      "Outro app está usando o que o Gente precisa. Reinicie o computador se continuar.",
    ),
  },
  {
    id: "model-corrupt",
    component: "model",
    critical: false,
    everyMs: 15_000,
    confirm: 1,
    budgetMs: 30_000,
    detect: async (env) => {
      const state = await env.modelState();
      return { broken: state === "corrupt" || state === "missing", detail: state };
    },
    ladder: [
      {
        kind: "fallback",
        id: "answer-from-cloud",
        did: c(
          "answered from Gente Cloud",
          "respondí desde Gente Cloud",
          "respondi pelo Gente Cloud",
        ),
        run: async (env) => {
          if ((await env.cloudModel()) === "warm") env.preferRoute("cloud");
        },
        verifyWithinMs: 0,
      },
      {
        kind: "redownload",
        id: "redownload-model",
        did: c(
          "downloaded the model again",
          "descargué el modelo otra vez",
          "baixei o modelo de novo",
        ),
        run: (env) => env.redownloadModel(),
        verifyWithinMs: 8_000,
        heavy: true,
      },
    ],
    what: c(
      "the model download was damaged",
      "la descarga del modelo estaba dañada",
      "o download do modelo estava danificado",
    ),
    calm: c(
      "Gente is downloading its model again. It picks up where it stopped.",
      "Gente está descargando su modelo otra vez. Sigue donde se quedó.",
      "O Gente está baixando o modelo de novo. Ele continua de onde parou.",
    ),
  },
  {
    id: "apps-not-configured",
    component: "connections",
    critical: false,
    everyMs: 2_000,
    confirm: 1,
    budgetMs: 5_000,
    detect: async (env) => ({ broken: (await env.logSignals()).has("apps-not-configured") }),
    healthy: async (env) => (await env.relayUp()) !== false && (await env.signIn()) === "ok",
    ladder: [
      {
        kind: "reconnect",
        id: "reconnect-apps",
        did: c(
          "reconnected your apps through Gente Cloud",
          "reconecté tus apps a través de Gente Cloud",
          "reconectei seus apps pelo Gente Cloud",
        ),
        run: async (env) => {
          await env.refreshSignIn();
          await env.restartService("relay");
          await env.notifyCloud("apps-not-configured");
        },
        verifyWithinMs: 3_000,
      },
    ],
    what: c(
      "your connected apps weren't set up",
      "tus apps conectadas no estaban listas",
      "seus apps conectados não estavam prontos",
    ),
    calm: c(
      "Connected apps need you to sign in to Gente.",
      "Las apps conectadas necesitan que inicies sesión en Gente.",
      "Os apps conectados precisam que você entre no Gente.",
    ),
  },
  {
    id: "media-balance-empty",
    component: "media",
    critical: false,
    everyMs: 2_000,
    confirm: 1,
    budgetMs: 5_000,
    detect: async (env) => ({ broken: (await env.logSignals()).has("media-balance-empty") }),
    ladder: [
      {
        kind: "report",
        id: "tell-gente-cloud",
        did: c(
          "told our team, so it gets fixed",
          "le avisé a nuestro equipo para arreglarlo",
          "avisei nossa equipe para consertar",
        ),
        run: (env) => env.notifyCloud("media-balance-empty"),
        verifyWithinMs: 0,
      },
    ],
    what: c("making images was paused", "hacer imágenes se pausó", "criar imagens foi pausado"),
    calm: c(
      "Making images and videos is paused for a moment. Our team is on it, and you weren't charged.",
      "Hacer imágenes y videos está en pausa un momento. Nuestro equipo ya lo atiende y no se te cobró.",
      "Criar imagens e vídeos está pausado por um momento. Nossa equipe já está cuidando e você não foi cobrado.",
    ),
  },
];
