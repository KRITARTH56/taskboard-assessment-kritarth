# Code Review — TaskBoard API

Reviewed: `src/app/api/**`, `src/lib/auth.ts`, `src/lib/jwt.ts`, `prisma/schema.prisma`  
Date: 2026-05-21

---

## Issue 1 — `passwordHash` Leaked in Project Detail Response

**File:** `src/app/api/projects/[id]/route.ts`, lines 28–44  
**Category:** Security  
**Severity:** Critical

`GET /api/projects/:id` uses `include: { owner: true, memberships: { include: { user: true } } }` with no field selection. Prisma returns every column on `User`, including `passwordHash`. The full object — hash and all — is serialised into the JSON response and sent to every project member. Any authenticated user can read the bcrypt hash of every other member in their project and use it for offline cracking.

**Recommended fix:** Replace the bare `include: { user: true }` and `include: { owner: true }` with explicit `select` blocks that omit `passwordHash`, matching the pattern already used in every other endpoint:

```ts
owner: { select: { id: true, name: true, email: true } },
memberships: {
  include: {
    user: { select: { id: true, name: true, email: true } },
  },
},
```

**Proof — curl showing the bug:**

```bash
# 1. Login and capture token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"arjun@taskboard.dev","password":"password123"}' \
  | jq -r '.token')

# 2. Fetch a project — passwordHash is visible in owner and every member
curl -s http://localhost:3000/api/projects/<PROJECT_ID> \
  -H "Authorization: Bearer $TOKEN" | jq '.project.owner'
```

**Response (bug present):**
```json
{
  "id": "cm...",
  "email": "meera@taskboard.dev",
  "name": "Meera Iyer",
  "passwordHash": "$2a$10$...",   // ← bcrypt hash exposed
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

**Response (after fix):**
```json
{
  "id": "cm...",
  "email": "meera@taskboard.dev",
  "name": "Meera Iyer"
}
```

---

## Issue 2 — Unvalidated `assigneeId` Allows Cross-Project Assignment

**File:** `src/app/api/projects/[id]/tasks/route.ts` lines 68–88 (POST);  
`src/app/api/tasks/[id]/route.ts` lines 30–44 (PATCH)  
**Category:** Data Integrity  
**Severity:** High

Both the task-creation and task-update endpoints accept an arbitrary `assigneeId` from the request body and write it directly to the database without checking whether that user is a member of the project. A member of Project A can assign any task to a user who has never heard of the project — including users from completely unrelated projects. This pollutes the assignee's task view and can be used to enumerate user IDs across the system.

**Recommended fix:** After parsing the body, look up a `Membership` row for `(assigneeId, projectId)` before writing. Return `400 Bad Request` if none exists:

```ts
if (parsed.data.assigneeId) {
  const assigneeMembership = await getProjectMembership(
    parsed.data.assigneeId,
    projectId,
  );
  if (!assigneeMembership) {
    return badRequest("assignee is not a member of this project");
  }
}
```

---

## Issue 3 — JWT Expiry Is 30 Days With No Revocation Mechanism

**File:** `src/lib/jwt.ts`, line 5  
**Category:** Security  
**Severity:** Medium

Tokens are signed with a 30-day expiry (`EXPIRES_IN = "30d"`) and are stateless — there is no token blocklist, no refresh-token flow, and no server-side session table. Once a token is issued it is valid for the full 30 days regardless of whether the user logs out, changes their password, or is removed from a project. `clearSession()` in `api-client.ts` only removes the token from `localStorage`; it does not invalidate it server-side. An attacker who captures a token (e.g. via XSS or a compromised device) retains full API access for up to 30 days.

**Recommended fix (in order of increasing effort):**

1. **Short-term:** Reduce `EXPIRES_IN` to `"1h"` or `"8h"` to limit the blast radius of a stolen token.
2. **Medium-term:** Add a `refresh_tokens` table and implement a short-lived access token + long-lived refresh token pattern.
3. **Long-term:** Store a `tokenVersion` integer on the `User` model and embed it in the JWT payload. Increment it on logout or password change; reject tokens whose version doesn't match.

---

## Issue 4 — `GET /api/projects` Fetches All Task Rows to Compute a Count

**File:** `src/app/api/projects/route.ts`, lines 10–22  
**Category:** Performance  
**Severity:** Medium

The dashboard query includes `tasks: true` on every project solely to compute `m.project.tasks.length`. For a project with thousands of tasks this loads every task row — including all columns — into memory on every dashboard page load, then discards all the data except the count. This will cause noticeable latency and excess memory pressure as projects grow.

**Recommended fix:** Replace the full `tasks` include with a `_count` aggregate, which Prisma translates into a single `COUNT(*)` subquery:

```ts
const memberships = await prisma.membership.findMany({
  where: { userId: user.id },
  include: {
    project: {
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { tasks: true } },
      },
    },
  },
  orderBy: { createdAt: "desc" },
});

const projects = memberships.map((m) => ({
  // ...
  taskCount: m.project._count.tasks,   // ← single COUNT(*), no row hydration
}));
```
