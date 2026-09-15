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
  const dayDate = location.pathname.match(/^\/days\/(\d{4}-\d{2}-\d{2})$/)?.[1]
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
      setStatus(dayDate ? `Loaded ${dayDate}.` : "Ready. Data is written through MCP.")
    }).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))
  }, [dayDate, isRecipes])

  useEffect(() => {
    if (isRecipes || dayDate || !chartRef.current) return
    chartInstance.current?.destroy()
    const days = nutritionDays(state)
    chartInstance.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels: days.map((day) => day.date.slice(5)),
        datasets: [
          { label: "Calories", data: days.map((day) => day.nutrients.calories ?? null), borderColor: "#9a5014", backgroundColor: "#9a5014", tension: 0.25 },
          { label: "Protein x10", data: days.map((day) => typeof day.nutrients.protein === "number" ? day.nutrients.protein * 10 : null), borderColor: "#1f6f43", backgroundColor: "#1f6f43", tension: 0.25 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { mode: "index" } }, scales: { y: { beginAtZero: true } } },
    })
  }, [dayDate, isRecipes, state])

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

  if (dayDate) {
    return <DayDetail date={dayDate} state={state} status={status} />
  }

  const days = nutritionDays(state)
  const today = todayKey()
  const completeDays = days.filter((day) => day.date < today)
  const recent = completeDays.slice(-7)
  const todayNutrition = state.nutrition[today]
  const avgCalories = average(recent, "calories")
  const avgProtein = average(recent, "protein")
  const todayRatio = ratio(todayNutrition?.nutrients.calories, todayNutrition?.nutrients.protein)
  const rollingRatio = nutrientRatio(recent, "calories", "protein")
  const latestWorkout = state.workouts[0]

  return (
    <div class="dashboard">
      <div class="cards">
        <Metric label="today calories" value={formatValue(todayNutrition?.nutrients.calories)} />
        <Metric label="today protein" value={formatValue(todayNutrition?.nutrients.protein, "g")} />
        <Metric label="today cal/protein" value={formatRatio(todayRatio)} />
        <Metric label="7 day calories" value={avgCalories ? String(Math.round(avgCalories)) : "--"} />
        <Metric label="7 day protein" value={avgProtein ? `${Math.round(avgProtein)}g` : "--"} />
        <Metric label="7 day cal/protein" value={formatRatio(rollingRatio)} />
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
              return <a class={`day ${category}`} href={`/days/${date}`}><strong>{date.slice(8)}</strong><br />{workout?.category ?? ""}</a>
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

function DayDetail(props: { date: string; state: State; status: string }) {
  const nutrition = props.state.nutrition[props.date]
  const workouts = props.state.workouts.filter((workout) => workout.date === props.date)
  return (
    <div class="day-detail">
      <a class="back-link" href="/">back to dashboard</a>
      <div class="day-title">
        <p class="label">daily detail</p>
        <h2>{props.date}</h2>
      </div>
      <div class="cards">
        <Metric label="calories" value={formatValue(nutrition?.nutrients.calories)} />
        <Metric label="protein" value={formatValue(nutrition?.nutrients.protein, "g")} />
        <Metric label="carbs" value={formatValue(nutrition?.nutrients.carbs, "g")} />
        <Metric label="fat" value={formatValue(nutrition?.nutrients.fat, "g")} />
      </div>
      <div class="grid">
        <section class="panel">
          <p class="label">dietary macros</p>
          {nutrition ? <div class="macro-table">{Object.entries(nutrition.nutrients).sort(([a], [b]) => nutrientRank(a) - nutrientRank(b) || a.localeCompare(b)).map(([key, value]) => <div><strong>{formatNutrientName(key)}</strong><span>{formatNutrientValue(key, value)}</span></div>)}</div> : <p class="muted">No nutrition logged for this day.</p>}
          {nutrition?.notes ? <p class="notes">{nutrition.notes}</p> : null}
        </section>
        <section class="panel">
          <p class="label">workout details</p>
          {workouts.length ? <div class="workout-detail-list">{workouts.map((workout) => <WorkoutDetail workout={workout} />)}</div> : <p class="muted">No workouts logged for this day.</p>}
        </section>
      </div>
      <p class={props.status.toLowerCase().includes("error") ? "status error" : "status"}>{props.status}</p>
    </div>
  )
}

function WorkoutDetail(props: { workout: WorkoutEntry }) {
  return (
    <article class="workout-detail">
      <h3>{props.workout.workout}</h3>
      <p class="muted">{props.workout.category ?? "uncategorized"} · {props.workout.machine ?? "no machine"}</p>
      {props.workout.sets.length ? <ol class="set-list">{props.workout.sets.map((set, index) => <li><strong>set {index + 1}</strong><span>{formatSet(set)}</span></li>)}</ol> : <p class="muted">No set details.</p>}
      {props.workout.notes ? <p class="notes">{props.workout.notes}</p> : null}
    </article>
  )
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

function nutrientRatio(days: NutritionEntry[], numeratorKey: string, denominatorKey: string) {
  const totals = days.reduce((sum, day) => {
    const numerator = day.nutrients[numeratorKey]
    const denominator = day.nutrients[denominatorKey]
    if (typeof numerator === "number" && typeof denominator === "number") return { numerator: sum.numerator + numerator, denominator: sum.denominator + denominator }
    return sum
  }, { numerator: 0, denominator: 0 })
  return ratio(totals.numerator, totals.denominator)
}

function ratio(numerator: number | undefined, denominator: number | undefined) {
  if (typeof numerator !== "number" || typeof denominator !== "number" || denominator === 0) return undefined
  return numerator / denominator
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

function formatRatio(value: number | undefined) {
  return typeof value === "number" ? value.toFixed(1) : "--"
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

function formatSet(set: WorkoutSet) {
  const parts = []
  if (typeof set.reps === "number") parts.push(`${set.reps} reps`)
  if (typeof set.weight === "number") parts.push(`${set.weight} lb`)
  if (typeof set.durationMinutes === "number") parts.push(`${set.durationMinutes} min`)
  if (typeof set.distance === "number") parts.push(`${set.distance} mi`)
  if (set.notes) parts.push(set.notes)
  return parts.join(" · ") || "logged"
}

const mount = document.getElementById("fitcheck-app")
if (mount) render(<FitcheckApp />, mount)
