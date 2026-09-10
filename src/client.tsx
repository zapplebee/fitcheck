/** @jsxImportSource hono/jsx */
import { CategoryScale, Chart, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js"
import { useEffect, useRef, useState } from "hono/jsx"
import { render } from "hono/jsx/dom"

type NutritionEntry = { date: string; nutrients: Record<string, number>; notes?: string; updatedAt: string }
type WorkoutSet = { reps?: number; weight?: number; durationMinutes?: number; distance?: number; notes?: string }
type WorkoutEntry = { id: string; date: string; category?: string; machine?: string; workout: string; sets: WorkoutSet[]; notes?: string; updatedAt: string }
type State = { nutrition: Record<string, NutritionEntry>; workouts: WorkoutEntry[] }

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip)

function FitcheckApp() {
  const [state, setState] = useState<State>({ nutrition: {}, workouts: [] })
  const [status, setStatus] = useState("Loading dashboard...")
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<Chart | null>(null)

  useEffect(() => {
    loadState().then((next) => {
      setState(next)
      setStatus("Ready. Data is written through MCP.")
    }).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))
  }, [])

  useEffect(() => {
    if (!chartRef.current) return
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
  }, [state])

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

async function loadState(): Promise<State> {
  const response = await fetch("/api/state")
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

const mount = document.getElementById("fitcheck-app")
if (mount) render(<FitcheckApp />, mount)
