// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Images and video through Gente Cloud (/v1/proxy/media), reached through the desktop app's
// loopback relay so the person's sign-in never reaches this server. Every finished file is
// downloaded right away and handed back as bytes, which Gente saves on this computer: the cloud
// copy is only a handoff (its link lasts an hour, and it is deleted after 30 days).
import type {
  AdapterContext,
  GeneratedMedia,
  MediaGenerationInput,
  MediaGenerationProvider,
  MediaVideoJob,
} from "@rakazo/adapter-kit";
import { MediaGenerationError } from "@rakazo/adapter-kit";
import { abortableDelay } from "@rakazo/core";

type Fetch = typeof fetch;
interface CloudJob {
  jobId?: string;
  status?: string;
  stub?: boolean;
  files?: { url: string; contentType?: string }[];
}

export class GenteCloudMediaProvider implements MediaGenerationProvider {
  readonly id = "gente-cloud";
  readonly capabilities = { images: true, video: true, offline: false };

  constructor(
    private readonly base: string, // the relay's /media address
    private readonly fetchImpl: Fetch = fetch,
    private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void> = abortableDelay,
  ) {}

  private async call(path: string, body?: unknown, signal?: AbortSignal): Promise<CloudJob> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (res.status === 401 || res.status === 402) throw new MediaGenerationError("authentication");
    if (res.status === 429) throw new MediaGenerationError("rate_limit");
    if (!res.ok) throw new MediaGenerationError("provider_failure");
    return (await res.json()) as CloudJob;
  }

  private async download(job: CloudJob, signal?: AbortSignal): Promise<GeneratedMedia> {
    // A stub job means image generation isn't live yet: say so instead of showing a placeholder.
    if (job.stub) throw new MediaGenerationError("unsupported");
    const file = job.files?.[0];
    if (!file) throw new MediaGenerationError("provider_failure");
    const res = await this.fetchImpl(file.url, { signal });
    if (!res.ok) throw new MediaGenerationError("provider_failure");
    const video = (file.contentType ?? res.headers.get("content-type") ?? "").startsWith("video/");
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mimeType: video ? "video/mp4" : "image/png",
    };
  }

  async generateImage(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia> {
    const signal = context.signal;
    const job = await this.call(
      "",
      { model: "flux-schnell", prompt: input.prompt, imageSize: "square_hd" },
      signal,
    );
    if (!job.jobId) throw new MediaGenerationError("provider_failure");
    for (let i = 0; i < 150; i++) {
      const state = await this.call(`/${encodeURIComponent(job.jobId)}`, undefined, signal);
      if (state.status === "completed") return this.download(state, signal);
      if (state.status === "failed") throw new MediaGenerationError("provider_failure");
      await this.sleep(2_000, signal);
    }
    throw new MediaGenerationError("provider_failure");
  }

  async generateVideo(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<MediaVideoJob> {
    const job = await this.call("", { model: "video-fast", prompt: input.prompt }, context.signal);
    if (!job.jobId) throw new MediaGenerationError("provider_failure");
    return { id: job.jobId, status: "queued" };
  }

  async pollVideo(id: string, context: AdapterContext): Promise<MediaVideoJob> {
    const state = await this.call(`/${encodeURIComponent(id)}`, undefined, context.signal);
    if (state.status === "completed")
      return { id, status: "completed", output: await this.download(state, context.signal) };
    if (state.status === "failed") return { id, status: "failed" };
    return { id, status: state.status === "running" ? "running" : "queued" };
  }
}
