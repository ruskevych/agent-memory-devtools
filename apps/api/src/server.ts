import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST ?? "127.0.0.1";

const app = createApp();

try {
  await app.listen({ port, host });
  app.log.info(`agent-memory API listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
