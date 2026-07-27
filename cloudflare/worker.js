// Cloudflare Worker: catches Esme's inbound WhatsApp replies AND delivery-status
// updates (sent/delivered/read/failed), queueing both.
//
// Why this exists: WhatsApp only delivers inbound messages (and status updates) to
// a live webhook, and GitHub Actions can't hold one open. This tiny always-on Worker
// receives them, stashes them in KV, and hands them to our processor when it polls.
//
// The status queue is the fix for the silent-failure bug from 24 July: Meta's send
// API returns 200 OK even when a free-form message never reaches the phone because
// the 24h window was closed. The only place that failure is ever visible is this
// webhook's 'statuses' payload (status: "failed"), which we now capture and surface
// instead of it being invisible until someone notices days of silence.
//
// Also fires GitHub Actions on a schedule (see `scheduled` below), because GitHub's
// own `schedule:` trigger proved unreliable (observed: a 5-min cron actually firing
// ~once per 3 hours, and scheduled runs delayed by hours). Cloudflare Cron Triggers
// are reliable to the minute, so they now own the "when" and just tell the GitHub
// workflow which slot to run, instead of the workflow guessing from wall-clock time
// at whatever moment GitHub eventually got around to starting it.
//
// Bindings needed (set in the Cloudflare dashboard):
//   KV namespace  -> MESSAGES
//   Secret        -> VERIFY_TOKEN   (any random string; also set in the Meta webhook config)
//   Secret        -> PULL_TOKEN     (any random string; the processor uses it to fetch + clear)
//   Secret        -> GH_TOKEN       (a GitHub token with 'workflow' scope, to dispatch runs)

const QUEUE_KEY = "queue";
const STATUS_KEY = "statuses";
const STATUS_CAP = 200; // rolling cap so this never grows unbounded

const REPO = "esmerobinson/life-planner";
const SLOT_BY_CRON = { "30 7 * * *": "morning", "0 12 * * *": "midday", "0 16 * * *": "evening" };
const REPLIES_CRON = "*/10 * * * *";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1) Meta webhook verification handshake (GET with hub.* params)
    if (request.method === "GET" && url.searchParams.has("hub.mode")) {
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (token === env.VERIFY_TOKEN) return new Response(challenge, { status: 200 });
      return new Response("forbidden", { status: 403 });
    }

    // 2) Our processor pulling queued messages (GET /pull?token=...)
    if (request.method === "GET" && url.pathname === "/pull") {
      if (url.searchParams.get("token") !== env.PULL_TOKEN)
        return new Response("forbidden", { status: 403 });
      const queue = (await env.MESSAGES.get(QUEUE_KEY, "json")) || [];
      await env.MESSAGES.put(QUEUE_KEY, JSON.stringify([])); // clear after handing over
      return Response.json(queue);
    }

    // 2b) Our processor pulling queued delivery-status updates (GET /statuses?token=...)
    if (request.method === "GET" && url.pathname === "/statuses") {
      if (url.searchParams.get("token") !== env.PULL_TOKEN)
        return new Response("forbidden", { status: 403 });
      const statuses = (await env.MESSAGES.get(STATUS_KEY, "json")) || [];
      await env.MESSAGES.put(STATUS_KEY, JSON.stringify([]));
      return Response.json(statuses);
    }

    // 3) Incoming WhatsApp messages + status updates (POST from Meta)
    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      const collected = [];
      const statuses = [];
      for (const entry of body?.entry || []) {
        for (const change of entry.changes || []) {
          for (const m of change.value?.messages || []) {
            collected.push({
              from: m.from,
              ts: m.timestamp,
              type: m.type,
              text: m.text?.body || "",
              // media messages carry an id we can fetch later (Phase 2c)
              media_id: m.image?.id || m.audio?.id || m.document?.id || null,
            });
          }
          for (const s of change.value?.statuses || []) {
            statuses.push({
              message_id: s.id,
              status: s.status, // "sent" | "delivered" | "read" | "failed"
              ts: s.timestamp,
              errors: s.errors || null,
            });
          }
        }
      }
      if (collected.length) {
        const queue = (await env.MESSAGES.get(QUEUE_KEY, "json")) || [];
        await env.MESSAGES.put(QUEUE_KEY, JSON.stringify(queue.concat(collected)));
      }
      if (statuses.length) {
        const prev = (await env.MESSAGES.get(STATUS_KEY, "json")) || [];
        const merged = prev.concat(statuses).slice(-STATUS_CAP);
        await env.MESSAGES.put(STATUS_KEY, JSON.stringify(merged));
      }
      return new Response("ok", { status: 200 }); // always 200 so Meta doesn't retry
    }

    return new Response("life-planner webhook", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    const dispatch = (workflow, inputs = {}) =>
      fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "life-planner-worker",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main", inputs }),
      });

    if (SLOT_BY_CRON[event.cron]) {
      ctx.waitUntil(dispatch("send.yml", { slot: SLOT_BY_CRON[event.cron] }));
    } else if (event.cron === REPLIES_CRON) {
      ctx.waitUntil(dispatch("replies.yml"));
    }
  },
};
