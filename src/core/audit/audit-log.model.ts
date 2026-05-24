/**
 * Shape of a CRUD audit log record.
 * Maps to the CrudAuditLog Prisma model.
 */
export interface CrudAuditLogRecord {
  id: string;
  action: string;
  module: string;
  entityId: string;
  userId: string | null;
  before: string | null;
  after: string | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
