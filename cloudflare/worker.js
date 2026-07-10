// Cloudflare Worker: catches Esme's inbound WhatsApp replies and queues them.
//
// Why this exists: WhatsApp only delivers inbound messages to a live webhook,
// and GitHub Actions can't hold one open. This tiny always-on Worker receives
// them, stashes them in KV, and hands them to our processor when it polls /pull.
//
// Bindings needed (set in the Cloudflare dashboard):
//   KV namespace  -> MESSAGES
//   Secret        -> VERIFY_TOKEN   (any random string; also set in the Meta webhook config)
//   Secret        -> PULL_TOKEN     (any random string; the processor uses it to fetch + clear)

const QUEUE_KEY = "queue";

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

    // 3) Incoming WhatsApp messages (POST from Meta)
    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      const collected = [];
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
        }
      }
      if (collected.length) {
        const queue = (await env.MESSAGES.get(QUEUE_KEY, "json")) || [];
        await env.MESSAGES.put(QUEUE_KEY, JSON.stringify(queue.concat(collected)));
      }
      return new Response("ok", { status: 200 }); // always 200 so Meta doesn't retry
    }

    return new Response("life-planner webhook", { status: 200 });
  },
};
