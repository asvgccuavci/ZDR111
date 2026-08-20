# AGENTS.md

## Project Overview
This repository contains the Grade Query and Security Administration System for Northeast Electric Power University (School of Automation Engineering). It is built with a Vite TypeScript frontend and Netlify Functions backend backed by Netlify Database (managed Postgres) with Drizzle ORM.

## Key Directories & Architecture
- `db/schema.ts`: Drizzle ORM database schema defining `students`, `system_settings`, `audit_logs`, and `ip_rate_limits`.
- `db/index.ts`: Database client initialization using `drizzle-orm/netlify-db`.
- `netlify/database/migrations/`: Auto-generated SQL migrations applied automatically during deployment.
- `netlify/functions/`: Serverless backend API handlers:
  - `system-status.mts`: Public endpoint for system operational status, announcement, class list.
  - `query.mts`: Secure student grade query endpoint with rate-limiting, timing-safe auth, switch checks, and watermark generation.
  - `admin-auth.mts`: Admin login and HMAC token verification (`张东然` / `FhsigJgajgsigy453483`).
  - `admin-settings.mts`: Global switch (`allow_query`), announcements, allowed classes, rate limit rules.
  - `admin-students.mts`: CRUD operations for 581 student records and course scores.
  - `admin-logs.mts`: Security audit log retrieval and statistical analysis.
  - `utils/db-service.ts`: Database operations, auto-seeding logic, rate limiting, and audit logging.
  - `utils/security.ts`: Crypto utilities (HMAC signature, timing-safe string comparison, IP extraction).
  - `data/students-seed.ts`: Seed dataset of all 581 students with their course records and passwords.
- `src/`: Client application (Vite + TypeScript + Vanilla CSS).
  - `api.ts`: API client for frontend-to-backend communication.
  - `types.ts`: Type definitions for students, courses, settings, logs, and API payloads.
  - `style.css`: Modern college portal styling with glassmorphism, responsive grid, print styles.
  - `main.ts`: Event orchestration, transcript rendering, GPA calculations, admin modal flows.

## Security Conventions & Non-Obvious Decisions
1. **Zero Client Secrets**: Student data, scores, and passwords are never shipped in the client bundle. All authentication happens server-side.
2. **Timing-safe comparison**: String comparisons on sensitive credentials use `crypto.timingSafeEqual` with buffer length normalization to prevent side-channel timing attacks.
3. **Admin Token**: Custom signed tokens (`payload.signature`) using HMAC-SHA256 with 2-hour expiration.
4. **Data Seeding**: On first invocation or deployment, `ensureInitialized` checks the database and automatically populates the 581 student records in chunks without manual migration scripts.
5. **Drizzle ORM beta**: `drizzle-orm@beta` and `drizzle-kit@beta` are used as required by `@netlify/database`.
