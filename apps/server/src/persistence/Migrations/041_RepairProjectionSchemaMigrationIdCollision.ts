import ensureProjectionSchema from "./EnsureProjectionSchema.ts";

// Migration IDs 033-040 were previously used by a different schema history,
// so some existing databases recorded those IDs without the current columns.
export default ensureProjectionSchema;
