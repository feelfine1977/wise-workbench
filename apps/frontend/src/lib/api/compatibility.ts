/** Explicit missing-operation compatibility checks. */
import { ApiError } from "@/lib/api";

/** An operation this backend does not serve; the screen says so rather than showing a status code. */
export const notServed = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);
