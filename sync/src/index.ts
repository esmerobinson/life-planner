export default {
  async fetch(): Promise<Response> {
    return new Response("stub", { status: 500 });
  },
};
