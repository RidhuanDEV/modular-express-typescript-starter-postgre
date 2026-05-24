import { PrismaClient } from "@prisma/client";
import { logger } from "../core/logger/logger.js";

export const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "query" },
    { emit: "event", level: "error" },
  ],
});

prisma.$on("query", (e) => {
  logger.debug({ duration: e.duration, query: e.query }, "Prisma query");
});

prisma.$on("error", (e) => {
  logger.error({ message: e.message }, "Prisma error");
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  logger.info("Prisma disconnected");
}
