import { z } from "zod";
import { Role } from "../auth/roles.js";

/**
 * A member of the desk.
 *
 * There is no organization id here because there is no second hospital
 * to belong to — one install, one hospital (docs/adr/0002). What a
 * member carries is a role, and that is the whole of authorization now.
 */
export const Member = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  role: Role,
});
export type Member = z.infer<typeof Member>;
