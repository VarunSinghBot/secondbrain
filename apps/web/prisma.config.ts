// import "dotenv/config"
import * as dotenv from "dotenv"
import path from "node:path"
import { defineConfig } from "prisma/config"

dotenv.config({ path: '.env.local', override: true });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL!,
  },
})

