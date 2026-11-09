import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { assertDataResidency } from "./lib/data-residency.js";
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
import { registerHospitalRoutes } from "./modules/hospital/hospital.routes.js";
import { registerMeRoutes } from "./modules/members/members.routes.js";
import { registerInsurersAdminRoutes } from "./modules/insurers/insurers.routes.js";
import { registerPreauthLayoutRoutes } from "./modules/preauth-layouts/preauth-layouts.routes.js";
import { registerCustomModulesRoutes } from "./modules/custom-modules/custom-modules.routes.js";
import { registerProceduresRoutes } from "./modules/procedures/procedures.routes.js";
import { registerReferenceRoutes } from "./modules/reference/reference.routes.js";
import { registerAuditRoutes } from "./modules/audit/audit.routes.js";
import { registerPacketRoutes } from "./modules/packet/packet.routes.js";
import { registerPreauthRoutes } from "./modules/preauth/preauth.routes.js";
import {
  registerClaimDeductionRoutes,
  registerDeductionSummaryRoutes,
} from "./modules/deductions/deductions.routes.js";
import { registerEnhancementRoutes } from "./modules/enhancements/enhancements.routes.js";
import { registerSlaRoutes } from "./modules/sla/sla.routes.js";
import { registerAssistantRoutes } from "./modules/assistant/assistant.routes.js";
import { registerReceivablesRoutes } from "./modules/receivables/receivables.routes.js";
import { registerReportsRoutes } from "./modules/reports/reports.routes.js";
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
await app.register(registerHospitalRoutes, { prefix: "/hospital" });
await app.register(registerMeRoutes, { prefix: "/me" });
await app.register(registerInsurersAdminRoutes, { prefix: "/insurers" });
await app.register(registerPreauthLayoutRoutes, { prefix: "/preauth-layout" });
await app.register(registerCustomModulesRoutes, {
  prefix: "/custom-modules",
});
await app.register(registerProceduresRoutes, { prefix: "/procedures" });
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
await app.register(registerEnhancementRoutes, {
  prefix: "/claims/:claimId/enhancements",
});
await app.register(registerSlaRoutes, { prefix: "/sla" });
await app.register(registerAssistantRoutes, { prefix: "/assistant" });
await app.register(registerReceivablesRoutes, { prefix: "/receivables" });
await app.register(registerReportsRoutes, { prefix: "/reports" });

// Before the port opens, not after. A server that accepts a patient
// record and then discovers it is storing it in Ohio has already done
// the thing the DPDP Act forbids.
assertDataResidency(process.env, (message) => app.log.warn(message));

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`claimflow-api listening on :${env.PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
