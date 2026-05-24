import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

export interface CreateAuditLogData {
  action: string;
  module: string;
  entityId: string;
  userId: string;
  /** Data snapshot before the change. Will be JSON-serialised. */
  before?: unknown;
  /** Data snapshot after the change. Will be JSON-serialised. */
  after?: unknown;
  requestId?: string | null;
}

type TransactionClient = Prisma.TransactionClient;

export class AuditLogRepository {
  async create(data: CreateAuditLogData, trx?: TransactionClient): Promise<void> {
    const client = trx ?? prisma;
    await client.crudAuditLog.create({
      data: {
        action: data.action,
        module: data.module,
        entityId: data.entityId,
        userId: data.userId,
        before: data.before !== undefined ? JSON.stringify(data.before) : null,
        after: data.after !== undefined ? JSON.stringify(data.after) : null,
        requestId: data.requestId ?? null,
      },
    });
  }
}

export const auditLogRepository = new AuditLogRepository();
