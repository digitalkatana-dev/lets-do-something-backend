'use strict';

/**
 * Mongoose models for the DB mirror of the policy file and the change audit log.
 * Uses the mongoose instance you pass in, so it shares your existing connection.
 */
module.exports = function createModels(mongoose, { policyCollection = 'abac_policies', auditCollection = 'abac_audit' } = {}) {
  const { Schema } = mongoose;

  const policySchema = new Schema(
    {
      policyId: { type: String, required: true, unique: true },
      description: { type: String, default: '' },
      effect: { type: String, enum: ['allow', 'deny'], required: true },
      enabled: { type: Boolean, default: true },
      actions: { type: [String], default: [] },
      resources: { type: [String], default: [] },
      conditions: { type: [Schema.Types.Mixed], default: [] },
      hash: String,
      syncedAt: Date,
    },
    { collection: policyCollection, versionKey: false, minimize: false }
  );

  const auditSchema = new Schema(
    {
      at: { type: Date, default: Date.now, index: true },
      policyId: { type: String, index: true },
      change: { type: String, enum: ['created', 'updated', 'deleted', 'rejected'], required: true },
      before: Schema.Types.Mixed,
      after: Schema.Types.Mixed,
      actor: String,
      source: String, // startup | file-watch | admin-api | reconcile | sighup | manual
      fileHash: String,
      note: String,
    },
    { collection: auditCollection, versionKey: false, minimize: false }
  );

  const Policy = mongoose.models.AbacPolicy || mongoose.model('AbacPolicy', policySchema);
  const Audit = mongoose.models.AbacAudit || mongoose.model('AbacAudit', auditSchema);
  return { Policy, Audit };
};
