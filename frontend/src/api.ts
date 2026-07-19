import type { Preset, Project, ProjectSummary, RenderJob, Scene, Style } from "./types";

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

  async listProjects(): Promise<ProjectSummary[]> {
    // no-store: these endpoints have no cache headers, and Firefox will otherwise
    // serve a stale list — showing an old name after a rename, or a stale status
    // that makes a ready project look like it "won't open" until a page refresh.
    return json(await fetch("/api/projects", { cache: "no-store" }));
  },

  async getProject(id: string): Promise<Project> {
    return json(await fetch(`/api/projects/${id}`, { cache: "no-store" }));
  },

  async renameProject(id: string, name: string): Promise<Project> {
    return json(
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
    );
  },

  async deleteProject(id: string): Promise<unknown> {
    return json(await fetch(`/api/projects/${id}`, { method: "DELETE" }));
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

  async splitSegment(id: string, segmentId: string, wordIndex: number): Promise<unknown> {
    return json(
      await fetch(`/api/projects/${id}/segments/${segmentId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word_index: wordIndex }),
      })
    );
  },

  async mergeSegment(id: string, segmentId: string): Promise<unknown> {
    return json(
      await fetch(`/api/projects/${id}/segments/${segmentId}/merge`, { method: "POST" })
    );
  },

  async deleteSegment(id: string, segmentId: string): Promise<unknown> {
    return json(
      await fetch(`/api/projects/${id}/segments/${segmentId}`, { method: "DELETE" })
    );
  },

  async uploadAsset(id: string, file: File): Promise<{ name: string; url: string }> {
    const form = new FormData();
    form.append("file", file);
    return json(await fetch(`/api/projects/${id}/assets`, { method: "POST", body: form }));
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

  // XHR (not fetch) so we can report upload progress — scene videos are large.
  uploadScene(id: string, file: File, onProgress?: (frac: number) => void): Promise<Scene> {
    const form = new FormData();
    form.append("file", file);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${id}/scenes`);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as Scene);
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error(`${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("network error"));
      xhr.send(form);
    });
  },

  async deleteScene(id: string, sceneId: string): Promise<Scene[]> {
    return json(await fetch(`/api/projects/${id}/scenes/${sceneId}`, { method: "DELETE" }));
  },

  async startRenders(id: string, clipIds?: string[]): Promise<RenderJob[]> {
    return json(
      await fetch(`/api/projects/${id}/renders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip_ids: clipIds ?? [] }),
      })
    );
  },

  async listRenders(id: string): Promise<RenderJob[]> {
    return json(await fetch(`/api/projects/${id}/renders`));
  },

  async cancelRender(id: string, jobId: string): Promise<RenderJob> {
    return json(await fetch(`/api/projects/${id}/renders/${jobId}`, { method: "DELETE" }));
  },

  async listPresets(): Promise<Preset[]> {
    return json(await fetch("/api/presets"));
  },

  async savePreset(name: string, style: Style): Promise<Preset> {
    return json(
      await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, style }),
      })
    );
  },

  async deletePreset(id: string): Promise<unknown> {
    return json(await fetch(`/api/presets/${id}`, { method: "DELETE" }));
  },

  videoUrl(id: string): string {
    return `/api/projects/${id}/video`;
  },

  sceneVideoUrl(id: string, sceneId: string): string {
    return `/api/projects/${id}/scenes/${sceneId}/video`;
  },
};
