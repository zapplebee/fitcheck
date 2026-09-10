/** @jsxImportSource hono/jsx */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { Hono } from "hono"
import { JSONFilePreset } from "lowdb/node"
import { z } from "zod"

type NutritionEntry = { date: string; nutrients: Record<string, number>; notes?: string; updatedAt: string }
type WorkoutSet = { reps?: number; weight?: number; durationMinutes?: number; distance?: number; notes?: string }
type WorkoutEntry = { id: string; date: string; category?: string; machine?: string; workout: string; sets: WorkoutSet[]; notes?: string; updatedAt: string }
type DbSchema = { nutrition: Record<string, NutritionEntry>; workouts: WorkoutEntry[]; clients: Record<string, { clientId: string; clientName?: string; createdAt: string }> }

const app = new Hono()
const dataPath = process.env.DATA_PATH ?? "./data/state.json"
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "https://fitcheck.dev.prettybird.zapplebee.online"
const accessToken = process.env.FITCHECK_ACCESS_TOKEN ?? "fitcheck-dev-token"
const githubToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
const githubRepository = process.env.GITHUB_REPOSITORY ?? "zapplebee/fitcheck"
const port = Number(process.env.PORT ?? "3000")
await mkdir(dirname(dataPath), { recursive: true })
const db = await JSONFilePreset<DbSchema>(dataPath, { nutrition: {}, workouts: [], clients: {} })

app.use("*", async (c, next) => {
  const started = performance.now()
  await next()
  console.log(JSON.stringify({ event: "http_request", method: c.req.method, path: new URL(c.req.url).pathname, status: c.res.status, durationMs: Math.round(performance.now() - started) }))
})

app.get("/", (c) => c.html(<Page />))
app.get("/client.js", async (c) => c.body(await Bun.file("./public/client.js").text(), 200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" }))
app.get("/health", (c) => c.json({ ok: true, service: "fitcheck" }))

app.get("/.well-known/oauth-authorization-server", (c) => c.json(oauthMetadata()))
app.get("/.well-known/openid-configuration", (c) => c.json(oauthMetadata()))
app.get("/.well-known/oauth-protected-resource", (c) => c.json(protectedResourceMetadata()))
app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(protectedResourceMetadata()))
app.get("/mcp/.well-known/oauth-protected-resource", (c) => c.json(protectedResourceMetadata()))
app.post("/register", async (c) => {
  const body = await safeJson(c.req.raw)
  const clientId = `fitcheck-${crypto.randomUUID()}`
  await db.read()
  db.data.clients[clientId] = { clientId, clientName: typeof body.client_name === "string" ? body.client_name : undefined, createdAt: new Date().toISOString() }
  await db.write()
  return c.json({ client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" })
})
app.get("/authorize", (c) => {
  const redirectUri = c.req.query("redirect_uri")
  if (!redirectUri) return c.text("missing redirect_uri", 400)
  const state = c.req.query("state")
  const redirect = new URL(redirectUri)
  redirect.searchParams.set("code", "fitcheck-code")
  if (state) redirect.searchParams.set("state", state)
  return c.redirect(redirect.toString())
})
app.post("/token", (c) => c.json({ access_token: accessToken, token_type: "Bearer", expires_in: 31_536_000, refresh_token: "fitcheck-refresh" }))

app.get("/api/state", async (c) => c.json(await getState()))
app.get("/api/summary", async (c) => c.json(await summary()))

app.use("/mcp", async (c, next) => {
  const auth = c.req.header("authorization")
  if (auth !== `Bearer ${accessToken}`) {
    c.header("WWW-Authenticate", `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource/mcp"`)
    return c.json({ error: "unauthorized" }, 401)
  }
  await next()
})
app.all("/mcp", async (c) => {
  const server = createMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})

Bun.serve({ fetch: app.fetch, hostname: "0.0.0.0", port })
console.log(`fitcheck listening on 0.0.0.0:${port}`)

function Page() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Fitcheck</title>
        <style>{styles}</style>
      </head>
      <body>
        <main class="page">
          <section class="sheet" aria-label="Fitcheck dashboard">
            <p class="eyebrow">fitcheck / mcp body ledger</p>
            <h1>Fitcheck.</h1>
            <p class="lede">Today, rolling nutrition, and training pattern.</p>
            <div class="rule" />
            <div id="fitcheck-app" class="widget-shell"><p>Fitcheck loading...</p></div>
          </section>
        </main>
        <script type="module" src="/client.js" />
      </body>
    </html>
  )
}

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "fitcheck", version: "0.1.0" })
  registerJsonTool(server, "get_state", "Return all tracked nutrition and workouts.", {}, async () => getState())
  registerJsonTool(server, "get_summary", "Return rolling nutrition averages and recent workout summaries.", {}, async () => summary())
  registerJsonTool(server, "upsert_nutrition", "Upsert nutrition attributes for one day. Nutrients are expandable keys such as calories, protein, carbs, fat, fiber, sodium, etc.", { date: dateSchema, nutrients: z.record(z.string().min(1), z.number()), notes: z.string().optional() }, async (args) => upsertNutrition(args.date, args.nutrients, args.notes))
  registerJsonTool(server, "upsert_workout", "Upsert a workout entry for a day by optional id. Use category such as upper, lower, cardio, mobility, full-body. Sets may include reps, weight, durationMinutes, distance, and notes.", { id: z.string().optional(), date: dateSchema, category: z.string().optional(), machine: z.string().optional(), workout: z.string().min(1), sets: z.array(workoutSetSchema).default([]), notes: z.string().optional() }, async (args) => upsertWorkout(args))
  registerJsonTool(server, "delete_workout", "Delete one workout by id.", { id: z.string().min(1) }, async ({ id }) => deleteWorkout(id))
  registerJsonTool(server, "list_github_issues", "List open GitHub issues for Fitcheck so agents can avoid duplicate bug reports and feature requests.", { state: z.enum(["open", "closed", "all"]).default("open"), labels: z.string().optional(), per_page: z.number().int().min(1).max(100).default(30) }, async (args) => githubIssueRequest("GET", `/issues?state=${encodeURIComponent(args.state)}&per_page=${args.per_page}${args.labels ? `&labels=${encodeURIComponent(args.labels)}` : ""}`))
  registerJsonTool(server, "create_github_issue", "Create a GitHub issue for a Fitcheck bug report or feature request. Check list_github_issues first and prefer comment_github_issue for duplicates.", { title: z.string().min(1), body: z.string().min(1), labels: z.array(z.string().min(1)).default([]) }, async (args) => githubIssueRequest("POST", "/issues", args))
  registerJsonTool(server, "comment_github_issue", "Append context to an existing Fitcheck GitHub issue instead of creating a duplicate.", { issue_number: z.number().int().positive(), body: z.string().min(1) }, async (args) => githubIssueRequest("POST", `/issues/${args.issue_number}/comments`, { body: args.body }))
  return server
}

function registerJsonTool<T extends z.ZodRawShape>(server: McpServer, name: string, description: string, inputSchema: T, handler: (args: z.infer<z.ZodObject<T>>) => Promise<unknown> | unknown) {
  server.registerTool(name, { description, inputSchema }, (async (args: z.infer<z.ZodObject<T>>) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await handler(args), null, 2) }] }
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] }
    }
  }) as never)
}

async function getState() {
  await db.read()
  db.data.nutrition ??= {}
  db.data.workouts ??= []
  return { nutrition: db.data.nutrition, workouts: db.data.workouts }
}

async function upsertNutrition(date: string, nutrients: Record<string, number>, notes?: string) {
  await db.read()
  const existing = db.data.nutrition[date]
  db.data.nutrition[date] = { date, nutrients: { ...(existing?.nutrients ?? {}), ...nutrients }, notes: notes ?? existing?.notes, updatedAt: new Date().toISOString() }
  await db.write()
  return db.data.nutrition[date]
}

async function upsertWorkout(args: { id?: string; date: string; category?: string; machine?: string; workout: string; sets: WorkoutSet[]; notes?: string }) {
  await db.read()
  const id = args.id || crypto.randomUUID()
  const entry: WorkoutEntry = { id, date: args.date, category: args.category, machine: args.machine, workout: args.workout, sets: args.sets, notes: args.notes, updatedAt: new Date().toISOString() }
  const index = db.data.workouts.findIndex((item) => item.id === id)
  if (index >= 0) db.data.workouts[index] = entry
  else db.data.workouts.unshift(entry)
  db.data.workouts.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
  await db.write()
  return entry
}

async function deleteWorkout(id: string) {
  await db.read()
  const before = db.data.workouts.length
  db.data.workouts = db.data.workouts.filter((item) => item.id !== id)
  await db.write()
  return { deleted: before - db.data.workouts.length }
}

async function summary() {
  const state = await getState()
  const days = Object.values(state.nutrition).sort((a, b) => a.date.localeCompare(b.date))
  const recent = days.slice(-7)
  const keys = [...new Set(recent.flatMap((day) => Object.keys(day.nutrients)))]
  const averages = Object.fromEntries(keys.map((key) => [key, round(recent.reduce((sum, day) => sum + (day.nutrients[key] ?? 0), 0) / Math.max(1, recent.length))]))
  return { sevenDayAverages: averages, nutritionDays: days.length, workouts: state.workouts.slice(0, 20) }
}

function oauthMetadata() {
  return { issuer: publicBaseUrl, authorization_endpoint: `${publicBaseUrl}/authorize`, token_endpoint: `${publicBaseUrl}/token`, registration_endpoint: `${publicBaseUrl}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256", "plain"] }
}

function protectedResourceMetadata() {
  return { resource: `${publicBaseUrl}/mcp`, authorization_servers: [publicBaseUrl], bearer_methods_supported: ["header"] }
}

async function safeJson(request: Request) {
  try { return await request.json() } catch { return {} }
}

function round(value: number) {
  return Math.round(value * 10) / 10
}

async function githubIssueRequest(method: "GET" | "POST", path: string, body?: unknown) {
  if (!githubToken) throw new Error("GitHub issue tools are not configured. Set GH_TOKEN or GITHUB_TOKEN.")
  const response = await fetch(`https://api.github.com/repos/${githubRepository}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${githubToken}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${JSON.stringify(data)}`)
  return data
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const workoutSetSchema = z.object({ reps: z.number().optional(), weight: z.number().optional(), durationMinutes: z.number().optional(), distance: z.number().optional(), notes: z.string().optional() })

const styles = `
  :root { color-scheme: light; --paper: #fbf8ef; --paper-deep: #efe6d1; --ink: #071a33; --ink-soft: #263d5e; --line: #092345; --green: #1f6f43; --orange: #9a5014; --red: #8a1f16; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink); background: linear-gradient(90deg, rgba(7, 26, 51, 0.045) 1px, transparent 1px), linear-gradient(rgba(7, 26, 51, 0.045) 1px, transparent 1px), var(--paper); background-size: 32px 32px; font-family: Georgia, "Times New Roman", serif; }
  .page { min-height: 100vh; display: grid; place-items: center; padding: 32px; }
  .sheet { width: min(1180px, 100%); padding: clamp(18px, 3vw, 34px); background: var(--paper); border: 3px solid var(--line); box-shadow: 14px 14px 0 var(--line); }
  .eyebrow { margin: 0 0 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase; }
  h1 { max-width: 940px; margin: 0; font-size: clamp(2.4rem, 5vw, 4.6rem); line-height: 0.9; letter-spacing: -0.075em; }
  .lede { max-width: 760px; margin: 12px 0 0; color: var(--ink-soft); font-size: 1rem; line-height: 1.35; }
  .rule { height: 3px; margin: 20px 0 14px; background: var(--line); }
  .widget-shell { margin-top: 14px; padding: 12px; border: 2px solid var(--line); background: var(--paper-deep); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  button { color: var(--paper); background: var(--ink); border: 2px solid var(--ink); padding: 10px 14px; cursor: pointer; font: inherit; }
  button:hover, button:focus-visible { color: var(--ink); background: var(--paper); outline: none; }
  .dashboard { display: grid; gap: 12px; }
  .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .card, .panel { padding: 12px; border: 2px solid var(--line); background: var(--paper); }
  .label { margin: 0 0 6px; color: var(--ink-soft); font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; }
  .metric { margin: 0; font-size: clamp(1.7rem, 3vw, 2.6rem); line-height: 1; letter-spacing: -0.06em; }
  .grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 12px; }
  .calendar { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
  .day { min-height: 44px; padding: 5px; border: 1px solid rgba(9, 35, 69, 0.35); background: var(--paper-deep); font-size: 0.68rem; }
  .day.upper { background: #dbe7d1; }
  .day.lower { background: #ead6c2; }
  .day.cardio { background: #d5e0ea; }
  .day.full-body, .day.mobility { background: #eaddea; }
  .list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .list li { display: grid; gap: 1px; padding-top: 5px; border-top: 1px solid rgba(9, 35, 69, 0.25); font-size: 0.78rem; }
  .latest { margin: 0 0 8px; font-size: 0.85rem; }
  .muted { color: var(--ink-soft); }
  .status.error { color: var(--red); }
  @media (max-width: 880px) { .page { padding: 18px; } .sheet { box-shadow: 8px 8px 0 var(--line); } .cards, .grid { grid-template-columns: 1fr; } }
`
