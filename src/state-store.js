import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = Object.freeze({ version: 1, generatedPosts: {}, processedNotifications: {} });

export class StateStore {
  constructor(filePath, log) {
    this.filePath = path.resolve(filePath);
    this.log = log;
    this.state = structuredClone(EMPTY_STATE);
    this.writePromise = Promise.resolve();
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      this.state = {
        version: 1,
        generatedPosts: parsed?.generatedPosts || {},
        processedNotifications: parsed?.processedNotifications || {},
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.log.warn("state_load_failed", { error: error.message });
      }
      this.state = structuredClone(EMPTY_STATE);
    }
  }

  getGeneratedSource(postId) {
    return this.state.generatedPosts[String(postId)] || null;
  }

  hasProcessedNotification(notificationId) {
    return Boolean(this.state.processedNotifications[String(notificationId)]);
  }

  async rememberProcessedNotification(notificationId) {
    if (notificationId == null) return;
    this.state.processedNotifications[String(notificationId)] = new Date().toISOString();
    const entries = Object.entries(this.state.processedNotifications);
    if (entries.length > 5_000) {
      entries
        .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
        .slice(5_000)
        .forEach(([key]) => delete this.state.processedNotifications[key]);
    }
    await this.save();
  }

  async rememberGeneratedPost(postId, source) {
    if (postId == null) return;
    this.state.generatedPosts[String(postId)] = {
      ...source,
      savedAt: new Date().toISOString(),
    };
    const entries = Object.entries(this.state.generatedPosts);
    if (entries.length > 2_000) {
      entries
        .sort((a, b) => String(b[1]?.savedAt || "").localeCompare(String(a[1]?.savedAt || "")))
        .slice(2_000)
        .forEach(([key]) => delete this.state.generatedPosts[key]);
    }
    await this.save();
  }

  async save() {
    this.writePromise = this.writePromise.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.filePath);
    });
    return this.writePromise;
  }
}
