import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma"

import { config, requireConfig } from "./config"

const globalForPrisma = globalThis as unknown as { ragPrisma?: PrismaClient }

function createPrisma(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: requireConfig(config.databaseUrl, "DATABASE_URL") })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.ragPrisma ?? createPrisma()

if (process.env.NODE_ENV !== "production") globalForPrisma.ragPrisma = prisma
