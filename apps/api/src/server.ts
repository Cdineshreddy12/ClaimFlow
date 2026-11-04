import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadEnv } from "./config/env.js";

const env = loadEnv();

const app = Fastify({
  logger:
    env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty" } }
      : true,
});

await app.register(cors, { origin: true });

app.get("/health", async () => ({ status: "ok", service: "claimflow-api" }));

// Feature modules (claims, checklist, documents, queries, auth, audit) register
// their routes here as they land — see docs/ARCHITECTURE.md for the module map.

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`claimflow-api listening on :${env.PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
