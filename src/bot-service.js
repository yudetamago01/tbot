import { parseCommand } from "./commands.js";
import { KarotterApiError } from "./karotter-client.js";
import { snapshotPost } from "./post-data.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sortOldestFirst(notifications) {
  return [...notifications].sort((a, b) => {
    return Date.parse(a?.createdAt || 0) - Date.parse(b?.createdAt || 0);
  });
}

function arrivedAfterStartup(notification, startedAt) {
  const cutoff = Date.parse(startedAt || "");
  const createdAt = Date.parse(notification?.createdAt || "");
  return Number.isFinite(cutoff) && Number.isFinite(createdAt) && createdAt >= cutoff;
}

export class BotService {
  constructor({ client, renderer, stateStore, config, log }) {
    this.client = client;
    this.renderer = renderer;
    this.stateStore = stateStore;
    this.config = config;
    this.log = log;
    this.timer = null;
    this.running = false;
    this.stopped = false;
    this.status = {
      startedAt: null,
      lastPollAt: null,
      lastSuccessAt: null,
      lastError: null,
      processed: 0,
      ignored: 0,
      botUser: null,
    };
  }

  async start() {
    if (this.status.startedAt) return;
    this.status.startedAt = new Date().toISOString();
    await this.stateStore.load();
    if (!this.client.hasAuthConfiguration()) {
      this.status.lastError = "Karotter authentication is not configured";
      this.log.warn("polling_disabled_missing_authentication");
      return;
    }
    await this.resumeAfterAuthentication();
  }

  async resumeAfterAuthentication() {
    try {
      const me = await this.client.getMe();
      this.status.botUser = me?.user || me;
      this.status.lastError = null;
      const username = this.status.botUser?.username;
      if (username && username.toLowerCase() !== this.config.username.toLowerCase()) {
        this.log.warn("configured_username_differs_from_api_user", {
          configured: this.config.username,
          apiUser: username,
        });
      }
    } catch (error) {
      this.status.lastError = error.message;
      const expectedAuthorization = error?.code === "OAUTH_AUTHORIZATION_REQUIRED";
      this.log[expectedAuthorization ? "warn" : "error"]("karotter_auth_check_failed", {
        error: error.message,
        status: error.status,
      });
      return false;
    }
    if (!this.config.enablePolling) {
      this.log.info("polling_disabled_by_config");
      return true;
    }
    this.schedule(0);
    return true;
  }

  schedule(delayMs) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.tick().catch((error) => {
        this.log.error("poll_tick_unhandled", { error: error.message });
      });
    }, delayMs);
    this.timer.unref?.();
  }

  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    this.status.lastPollAt = new Date().toISOString();
    let nextDelay = this.config.pollIntervalMs;
    try {
      const result = await this.client.getNotifications({
        limit: this.config.pollPageLimit,
        type: "MENTION,REPLY",
      });
      const unread = (result?.notifications || [])
        .filter((notification) => !notification?.isRead)
        .filter((notification) => !this.stateStore.hasProcessedNotification(notification?.id));
      const stale = unread
        .filter((notification) => !arrivedAfterStartup(notification, this.status.startedAt))
        .filter((notification) => notification?.id != null)
        .slice(0, this.config.maxNotificationsPerTick);
      if (stale.length) {
        this.log.info("discarding_prestartup_notifications", {
          count: stale.length,
          startedAt: this.status.startedAt,
        });
        for (const notification of stale) {
          await this.finishNotification(notification.id, { ignored: true });
        }
      }
      const notifications = sortOldestFirst(
        unread.filter((notification) => arrivedAfterStartup(notification, this.status.startedAt)),
      ).slice(0, this.config.maxNotificationsPerTick);
      for (const notification of notifications) {
        await this.processNotification(notification);
      }
      this.status.lastSuccessAt = new Date().toISOString();
      this.status.lastError = null;
    } catch (error) {
      this.status.lastError = error.message;
      if (error instanceof KarotterApiError && error.status === 429) {
        nextDelay = Math.max(error.retryAfterMs || 60_000, this.config.pollIntervalMs);
      }
      this.log.error("poll_failed", { error: error.message, status: error.status, nextDelay });
    } finally {
      this.running = false;
      this.schedule(nextDelay);
    }
  }

  async resolveSource(commandPost, parsed) {
    if (commandPost.parentId != null) {
      const generated = this.stateStore.getGeneratedSource(commandPost.parentId);
      if (generated) {
        return {
          content: parsed.commandOnly ? generated.content : parsed.content,
          profile: generated.profile,
          post: generated.post,
        };
      }
      const parent = await this.client.getPost(commandPost.parentId);
      const snapshot = snapshotPost(parent);
      return {
        content: parsed.commandOnly ? snapshot.content : parsed.content,
        profile: snapshot.author,
        post: snapshot,
      };
    }
    const snapshot = snapshotPost(commandPost, { direct: true });
    return {
      content: parsed.content,
      profile: snapshot.author,
      post: snapshot,
    };
  }

  async processNotification(notification) {
    const notificationId = notification?.id;
    const postId = notification?.post?.id ?? notification?.postId;
    if (notificationId == null || postId == null) {
      this.log.warn("notification_missing_identifiers", { notificationId, postId });
      return;
    }
    try {
      const commandPost = await this.client.getPost(postId);
      const authorUsername = String(commandPost?.author?.username || "").replace(/^@/, "");
      if (authorUsername.toLowerCase() === this.config.username.toLowerCase()) {
        await this.finishNotification(notificationId, { ignored: true });
        return;
      }
      const parsed = parseCommand(commandPost?.content, this.config.username);
      if (!parsed) {
        await this.finishNotification(notificationId, { ignored: true });
        return;
      }
      this.log.info("mention_detected", {
        notificationId,
        postId: commandPost.id,
        author: authorUsername || null,
        command: parsed.command.id,
        commandOnly: parsed.commandOnly,
        notificationType: notification?.type || null,
        notificationCreatedAt: notification?.createdAt || null,
      });
      const source = await this.resolveSource(commandPost, parsed);
      const allowsEmpty = parsed.command.id === "help" || parsed.command.unknown;
      if (!source.content && !allowsEmpty) {
        await this.client.createTextReply({
          parentId: commandPost.id,
          content: `通常投稿では文章を添えてください。返信では「@${this.config.username} ${parsed.command.id}」だけでも親投稿を加工できます。`,
        });
        await this.finishNotification(notificationId);
        return;
      }
      const imageBuffer = await this.renderer({
        commandId: parsed.command.id,
        text: source.content || "コマンド一覧",
        profile: source.profile,
        post: source.post,
        avatarAllowedHosts: this.config.avatarAllowedHosts,
        timeZone: this.config.timeZone,
      });
      const responsePost = await this.client.createPost({
        parentId: commandPost.id,
        image: {
          buffer: imageBuffer,
          mimeType: "image/png",
          filename: `tbot-${parsed.command.id}-${commandPost.id}.png`,
        },
      });
      if (responsePost?.id != null) {
        await this.stateStore.rememberGeneratedPost(responsePost.id, source);
      }
      await this.finishNotification(notificationId);
      this.log.info("image_reply_created", {
        notificationId,
        commandPostId: commandPost.id,
        responsePostId: responsePost?.id,
        command: parsed.command.id,
      });
    } catch (error) {
      this.log.error("notification_processing_failed", {
        notificationId,
        postId,
        error: error.message,
        status: error.status,
      });
      if (error instanceof KarotterApiError && error.status === 429) {
        await sleep(error.retryAfterMs || 10_000);
      }
      throw error;
    }
  }

  async finishNotification(notificationId, { ignored = false } = {}) {
    await this.stateStore.rememberProcessedNotification(notificationId);
    try {
      await this.client.markNotificationRead(notificationId);
    } catch (error) {
      this.log.warn("notification_mark_read_failed", {
        notificationId,
        error: error.message,
        status: error.status,
      });
    }
    if (ignored) this.status.ignored += 1;
    else this.status.processed += 1;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  health() {
    const botUser = this.status.botUser
      ? {
          id: this.status.botUser.id,
          username: this.status.botUser.username,
          displayName: this.status.botUser.displayName,
          avatarUrl: this.status.botUser.avatarUrl,
          isBotAccount: this.status.botUser.isBotAccount,
        }
      : null;
    return {
      ok: Boolean(this.status.botUser) && !this.status.lastError,
      polling: this.config.enablePolling && Boolean(this.status.botUser) && !this.stopped,
      running: this.running,
      username: this.config.username,
      ...this.status,
      botUser,
    };
  }
}
