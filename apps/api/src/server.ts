import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { loadEnv } from "./config/env.js";
import { registerClaimsRoutes } from "./modules/claims/claims.routes.js";
import { registerChecklistRoutes } from "./modules/checklist/checklist.routes.js";
import { registerDocumentsRoutes } from "./modules/documents/documents.routes.js";
import {
  registerClaimQueriesRoutes,
  registerQueryInboxRoutes,
} from "./modules/queries/queries.routes.js";
import {
  registerInvitesRoutes,
  registerOnboardingRoutes,
} from "./modules/onboarding/onboarding.routes.js";
import { registerOrganizationsRoutes } from "./modules/organizations/organizations.routes.js";
import { registerReferenceRoutes } from "./modules/reference/reference.routes.js";
import { registerAuditRoutes } from "./modules/audit/audit.routes.js";
import { registerPacketRoutes } from "./modules/packet/packet.routes.js";
import { registerPreauthRoutes } from "./modules/preauth/preauth.routes.js";
import {
  registerClaimDeductionRoutes,
  registerDeductionSummaryRoutes,
} from "./modules/deductions/deductions.routes.js";
import {
  registerClaimDoctorApprovalRoutes,
  registerPublicDoctorApprovalRoutes,
} from "./modules/doctor-approval/doctor-approval.routes.js";

const env = loadEnv();

const app = Fastify({
  logger:
    env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty" } }
      : true,
});

await app.register(cors, { origin: true });

// Every route validates its body/query/params with `Schema.parse(...)`
// (see any *.routes.ts) rather than Fastify's own schema hooks, so a bad
// request throws a raw ZodError — without this, Fastify's default handler
// turns that into a 500, which is wrong: the client sent bad input, the
// server didn't fail.
app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply
      .code(400)
      .send({ error: "validation failed", details: error.issues });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "internal server error" });
});

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
await app.register(registerOnboardingRoutes, { prefix: "/onboarding" });
await app.register(registerInvitesRoutes, { prefix: "/invites" });
await app.register(registerOrganizationsRoutes, { prefix: "/organizations" });
await app.register(registerReferenceRoutes);
await app.register(registerAuditRoutes, { prefix: "/audit-log" });
await app.register(registerPacketRoutes, {
  prefix: "/claims/:claimId/packet",
});
await app.register(registerPreauthRoutes, {
  prefix: "/claims/:claimId/preauth-fields",
});
await app.register(registerClaimDoctorApprovalRoutes, {
  prefix: "/claims/:claimId/doctor-approvals",
});
await app.register(registerPublicDoctorApprovalRoutes, {
  prefix: "/doctor-approval",
});
await app.register(registerClaimDeductionRoutes, {
  prefix: "/claims/:claimId/deductions",
});
await app.register(registerDeductionSummaryRoutes, { prefix: "/deductions" });

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`claimflow-api listening on :${env.PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
