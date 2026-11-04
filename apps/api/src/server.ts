import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadEnv } from "./config/env.js";
import jwtPlugin from "./plugins/jwt.js";
import { registerClaimsRoutes } from "./modules/claims/claims.routes.js";
import { registerChecklistRoutes } from "./modules/checklist/checklist.routes.js";
import { registerDocumentsRoutes } from "./modules/documents/documents.routes.js";
import {
  registerClaimQueriesRoutes,
  registerQueryInboxRoutes,
} from "./modules/queries/queries.routes.js";

const env = loadEnv();

const app = Fastify({
  logger:
    env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty" } }
      : true,
});

await app.register(cors, { origin: true });
await app.register(jwtPlugin);

app.get("/health", async () => ({ status: "ok", service: "claimflow-api" }));

await app.register(registerClaimsRoutes, { prefix: "/claims" });
await app.register(registerChecklistRoutes, { prefix: "/checklist-rules" });
await app.register(registerDocumentsRoutes, {
  prefix: "/claims/:claimId/documents",
});
await app.register(registerClaimQueriesRoutes, {
  prefix: "/claims/:claimId/queries",
});
await app.register(registerQueryInboxRoutes, { prefix: "/queries" });

// Remaining feature modules (audit) register their routes here as they
// land — see docs/ARCHITECTURE.md for the module map.

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`claimflow-api listening on :${env.PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
