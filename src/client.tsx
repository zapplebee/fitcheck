/** @jsxImportSource hono/jsx */
import { CategoryScale, Chart, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js"
import { useEffect, useRef, useState } from "hono/jsx"
import { render } from "hono/jsx/dom"

type NutritionEntry = { date: string; nutrients: Record<string, number>; notes?: string; updatedAt: string }
type WorkoutSet = { reps?: number; weight?: number; durationMinutes?: number; distance?: number; notes?: string }
type WorkoutEntry = { id: string; date: string; category?: string; machine?: string; workout: string; sets: WorkoutSet[]; notes?: string; updatedAt: string }
type RecipeItem = { id: string; name: string; serving: string; nutrients: Record<string, number>; notes?: string; createdAt: string; updatedAt: string }
type State = { nutrition: Record<string, NutritionEntry>; workouts: WorkoutEntry[] }

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip)

function FitcheckApp() {
  const isRecipes = location.pathname === "/recipes"
  const [state, setState] = useState<State>({ nutrition: {}, workouts: [] })
  const [recipes, setRecipes] = useState<RecipeItem[]>([])
  const [filter, setFilter] = useState("")
  const [status, setStatus] = useState("Loading dashboard...")
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<Chart | null>(null)

  useEffect(() => {
    if (isRecipes) {
      loadRecipes().then((next) => {
        setRecipes(next)
        setStatus(`Loaded ${next.length} reusable item${next.length === 1 ? "" : "s"}.`)
      }).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))
      return
    }
    loadState().then((next) => {
      setState(next)
      setStatus("Ready. Data is written through MCP.")
    }).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))
  }, [isRecipes])

  useEffect(() => {
    if (isRecipes || !chartRef.current) return
    chartInstance.current?.destroy()
    const days = nutritionDays(state)
    chartInstance.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels: days.map((day) => day.date.slice(5)),
        datasets: [
          { label: "Calories", data: days.map((day) => day.nutrients.calories ?? null), borderColor: "#9a5014", backgroundColor: "#9a5014", tension: 0.25 },
          { label: "Protein", data: days.map((day) => day.nutrients.protein ?? null), borderColor: "#1f6f43", backgroundColor: "#1f6f43", tension: 0.25 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { mode: "index" } }, scales: { y: { beginAtZero: true } } },
    })
  }, [isRecipes, state])

  if (isRecipes) {
    const filteredRecipes = recipes.filter((item) => recipeText(item).includes(filter.trim().toLowerCase()))
    return (
      <div class="recipe-page">
        <input class="recipe-filter" value={filter} onInput={(event) => setFilter((event.target as HTMLInputElement).value)} placeholder="Filter recipes, ingredients, GUIDs, nutrients..." />
        <div class="recipe-grid">
          {filteredRecipes.map((item) => <NutritionLabel item={item} />)}
        </div>
        {filteredRecipes.length === 0 ? <p class="muted">No reusable items match.</p> : null}
        <p class={status.toLowerCase().includes("error") ? "status error" : "status"}>{status}</p>
      </div>
    )
  }

  const days = nutritionDays(state)
  const today = todayKey()
  const completeDays = days.filter((day) => day.date < today)
  const recent = completeDays.slice(-7)
  const todayNutrition = state.nutrition[today]
  const avgCalories = average(recent, "calories")
  const avgProtein = average(recent, "protein")
  const latestWorkout = state.workouts[0]

  return (
    <div class="dashboard">
      <div class="cards">
        <Metric label="today calories" value={formatValue(todayNutrition?.nutrients.calories)} />
        <Metric label="today protein" value={formatValue(todayNutrition?.nutrients.protein, "g")} />
        <Metric label="7 day calories" value={avgCalories ? String(Math.round(avgCalories)) : "--"} />
        <Metric label="7 day protein" value={avgProtein ? `${Math.round(avgProtein)}g` : "--"} />
      </div>

      <div class="grid">
        <section class="panel">
          <p class="label">nutrition trend</p>
          <div style={{ height: "260px" }}><canvas ref={chartRef} /></div>
        </section>
        <section class="panel">
          <p class="label">workout calendar</p>
          <div class="calendar">
            {calendarDays().map((date) => {
              const workout = state.workouts.find((item) => item.date === date)
              const category = slug(workout?.category ?? "")
              return <div class={`day ${category}`}><strong>{date.slice(8)}</strong><br />{workout?.category ?? ""}</div>
            })}
          </div>
        </section>
      </div>

      <div class="grid">
        <section class="panel">
          <p class="label">recent nutrition</p>
          <ol class="list">
            {days.slice(-10).reverse().map((day) => <li><strong>{day.date}</strong><span class="muted">{formatNutrients(day.nutrients)}</span></li>)}
          </ol>
        </section>
        <section class="panel">
          <p class="label">recent workouts</p>
          {latestWorkout ? <p class="latest"><strong>{latestWorkout.workout}</strong><br /><span class="muted">{latestWorkout.date} · {latestWorkout.category ?? "uncategorized"}</span></p> : <p class="muted">No workouts yet.</p>}
          <ol class="list">
            {state.workouts.slice(0, 8).map((workout) => <li><strong>{workout.workout}</strong><span class="muted">{workout.date} · {workout.machine ?? workout.category ?? "workout"} · {workout.sets.length} sets</span></li>)}
          </ol>
        </section>
      </div>
      <p class={status.toLowerCase().includes("error") ? "status error" : "status"}>{status}</p>
    </div>
  )
}

function Metric(props: { label: string; value: string }) {
  return <section class="card"><p class="label">{props.label}</p><p class="metric">{props.value}</p></section>
}

function NutritionLabel(props: { item: RecipeItem }) {
  const entries = Object.entries(props.item.nutrients).sort(([a], [b]) => nutrientRank(a) - nutrientRank(b) || a.localeCompare(b))
  return (
    <article class="nutrition-label">
      <h2>Nutrition Facts</h2>
      <div class="label-id">{props.item.id}</div>
      <div class="serving"><strong>{props.item.name}</strong><br />Serving size {props.item.serving}</div>
      {entries.map(([key, value]) => <div class={key.toLowerCase() === "calories" ? "nutrient-row calorie-row" : "nutrient-row"}><strong>{formatNutrientName(key)}</strong><span>{formatNutrientValue(key, value)}</span></div>)}
      {props.item.notes ? <p class="recipe-notes">{props.item.notes}</p> : null}
    </article>
  )
}

async function loadState(): Promise<State> {
  const response = await fetch("/api/state")
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? `Request failed: ${response.status}`)
  return data
}

async function loadRecipes(): Promise<RecipeItem[]> {
  const response = await fetch("/api/recipes")
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? `Request failed: ${response.status}`)
  return data
}

function nutritionDays(state: State) {
  return Object.values(state.nutrition).sort((a, b) => a.date.localeCompare(b.date)).slice(-30)
}

function average(days: NutritionEntry[], key: string) {
  const values = days.map((day) => day.nutrients[key]).filter((value) => typeof value === "number")
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function calendarDays() {
  const today = todayKey()
  return Array.from({ length: 28 }, (_, index) => {
    return addDays(today, index - 27)
  })
}

function slug(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

function todayKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function formatValue(value: number | undefined, suffix = "") {
  return typeof value === "number" ? `${Math.round(value)}${suffix}` : "--"
}

function formatNutrients(nutrients: Record<string, number>) {
  return Object.entries(nutrients).map(([key, value]) => `${key}: ${value}`).join(" · ")
}

function recipeText(item: RecipeItem) {
  return [item.id, item.name, item.serving, item.notes, Object.keys(item.nutrients).join(" ")].join(" ").toLowerCase()
}

function nutrientRank(key: string) {
  return ["calories", "fat", "saturated_fat", "trans_fat", "cholesterol", "sodium", "carbs", "fiber", "sugar", "protein"].indexOf(key) === -1 ? 99 : ["calories", "fat", "saturated_fat", "trans_fat", "cholesterol", "sodium", "carbs", "fiber", "sugar", "protein"].indexOf(key)
}

function formatNutrientName(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatNutrientValue(key: string, value: number) {
  if (key.toLowerCase() === "calories") return String(Math.round(value))
  if (/protein|carb|fat|fiber|sugar/.test(key.toLowerCase())) return `${value}g`
  if (/sodium|cholesterol/.test(key.toLowerCase())) return `${value}mg`
  return String(value)
}

const mount = document.getElementById("fitcheck-app")
if (mount) render(<FitcheckApp />, mount)
