// Modified by DeskHead Inc. in 2026 for Gente (fork of Rakazo, Apache-2.0).
import { DEFAULT_COMPUTER_SCREEN } from "@rakazo/core";
import type { ComputerProviderDefinition } from "../../../computers/computer-provider-descriptor.js";
import { raw } from "../../../computers/computer-provider-descriptor.js";

export const e2bComputer: ComputerProviderDefinition = {
  capabilities: {
    terminal: true,
    inPlaceUpdate: true,
    nativeShell: false,
    runsOnUserMachine: false,
    screen: DEFAULT_COMPUTER_SCREEN,
    serverHomeMount: "never",
    serverOwnsStoredTeamHome: true,
    storedHomeIsBackup: false,
  },
  env: { e2bApiKey: { name: "E2B_API_KEY", read: raw, required: true } },
  settings: {
    displayName: "E2B",
    fields: [{ key: "apiKey", option: "e2bApiKey", label: "API key", kind: "secret" }],
  },
  async create(opts) {
    const { E2BSandboxProvider } = await import("./e2b-sandbox.js");
    // Gente: in the desktop app, cloud computers come from Gente Cloud through the app's broker;
    // no E2B key is on the computer then.
    const { genteCloudBrokerUrl, genteCloudSdk } = await import("./gente-cloud-sdk.js");
    const broker = genteCloudBrokerUrl();
    if (broker) return new E2BSandboxProvider("gente-cloud", genteCloudSdk(broker));
    return new E2BSandboxProvider(opts.e2bApiKey!);
  },
};
