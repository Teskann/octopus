import type { Project } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  async createProject(file: File, language: string): Promise<{ id: string }> {
    const form = new FormData();
    form.append("file", file);
    form.append("language", language);
    return json(await fetch("/api/projects", { method: "POST", body: form }));
  },

  async getProject(id: string): Promise<Project> {
    return json(await fetch(`/api/projects/${id}`));
  },

  async patchProject(id: string, patch: Partial<Project>): Promise<Project> {
    return json(
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
    );
  },

  async patchSegment(
    id: string,
    segmentId: string,
    patch: Partial<{ text: string; translation: string; start: number; end: number }>
  ): Promise<unknown> {
    return json(
      await fetch(`/api/projects/${id}/segments/${segmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
    );
  },

  async startTranslate(id: string, target: string): Promise<unknown> {
    return json(
      await fetch(`/api/projects/${id}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      })
    );
  },

  videoUrl(id: string): string {
    return `/api/projects/${id}/video`;
  },
};
