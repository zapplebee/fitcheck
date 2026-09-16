/** @jsxImportSource hono/jsx */
import { CategoryScale, Chart, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js"
import { DayPicker } from "@daypicker/react"
import { useEffect, useRef, useState } from "hono/jsx"
import { render } from "hono/jsx/dom"

type NutritionEntry = { date: string; nutrients: Record<string, number>; notes?: string; updatedAt: string }
type WorkoutSet = { reps?: number; weight?: number; durationMinutes?: number; distance?: number; notes?: string }
type WorkoutTag = "plyometric" | "upper" | "lower" | "core" | "rehab" | "cardio"
type WorkoutTrackingMode = "sets_reps_weight" | "duration_distance"
type WorkoutEntry = { id: string; date: string; category?: string; tags?: WorkoutTag[]; trackingMode?: WorkoutTrackingMode; machine?: string; workout: string; exerciseId?: string; sets: WorkoutSet[]; notes?: string; updatedAt: string }
type RecipeItem = { id: string; name: string; serving: string; nutrients: Record<string, number>; notes?: string; createdAt: string; updatedAt: string }
type ExerciseItem = { id: string; name: string; kind: "strength" | "cardio" | "mobility" | "other"; machine?: string; notes?: string; createdAt: string; updatedAt: string }
type State = { nutrition: Record<string, NutritionEntry>; workouts: WorkoutEntry[] }

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip)

function FitcheckApp() {
  const isRecipes = location.pathname === "/recipes"
  const isExercises = location.pathname === "/exercises"
  const dayDate = location.pathname.match(/^\/days\/(\d{4}-\d{2}-\d{2})$/)?.[1]
  const [state, setState] = useState<State>({ nutrition: {}, workouts: [] })
  const [recipes, setRecipes] = useState<RecipeItem[]>([])
  const [exercises, setExercises] = useState<ExerciseItem[]>([])
  const [filter, setFilter] = useState("")
  const [selectedTag, setSelectedTag] = useState<WorkoutTag | "all">("all")
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
    if (isExercises) {
      Promise.all([loadState(), loadExercises()]).then(([nextState, nextExercises]) => {
        setState(nextState)
        setExercises(nextExercises)
        setStatus(`Loaded ${nextExercises.length} catalog exercise${nextExercises.length === 1 ? "" : "s"}.`)
      }).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))
      return
    }
    loadState().then((next) => {
      setState(next)
      setStatus(dayDate ? `Loaded ${dayDate}.` : "Ready. Data is written through MCP.")
    }).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))
  }, [dayDate, isExercises, isRecipes])

  useEffect(() => {
    if (isRecipes || isExercises || dayDate || !chartRef.current) return
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
  }, [dayDate, isExercises, isRecipes, state])

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

  if (isExercises) {
    return <ExerciseCatalog exercises={exercises} workouts={state.workouts} filter={filter} setFilter={setFilter} selectedTag={selectedTag} setSelectedTag={setSelectedTag} status={status} />
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
  const todayRatio = ratio(todayNutrition?.nutrients.protein, todayNutrition?.nutrients.calories)
  const rollingRatio = nutrientRatio(recent, "protein", "calories")
  const latestWorkout = state.workouts[0]

  return (
    <div class="dashboard">
      <div class="cards">
        <Metric label="today calories" value={formatValue(todayNutrition?.nutrients.calories)} />
        <Metric label="today protein" value={formatValue(todayNutrition?.nutrients.protein, "g")} />
        <Metric label="today protein/cal" value={formatRatio(todayRatio)} />
        <Metric label="7 day calories" value={avgCalories ? String(Math.round(avgCalories)) : "--"} />
        <Metric label="7 day protein" value={avgProtein ? `${Math.round(avgProtein)}g` : "--"} />
        <Metric label="7 day protein/cal" value={formatRatio(rollingRatio)} />
      </div>

      <div class="grid">
        <section class="panel">
          <p class="label">nutrition trend</p>
          <div style={{ height: "260px" }}><canvas ref={chartRef} /></div>
        </section>
        <section class="panel">
          <p class="label">workout calendar</p>
          <FitnessCalendar state={state} />
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

function ExerciseCatalog(props: { exercises: ExerciseItem[]; workouts: WorkoutEntry[]; filter: string; setFilter: (value: string) => void; selectedTag: WorkoutTag | "all"; setSelectedTag: (value: WorkoutTag | "all") => void; status: string }) {
  const summaries = exerciseSummaries(props.exercises, props.workouts).filter((item) => exerciseText(item).includes(props.filter.trim().toLowerCase()) && (props.selectedTag === "all" || item.tags.includes(props.selectedTag)))
  return (
    <div class="exercise-page">
      <input class="recipe-filter" value={props.filter} onInput={(event) => props.setFilter((event.target as HTMLInputElement).value)} placeholder="Filter exercises, machines, kinds, GUIDs..." />
      <div class="tag-filter" aria-label="Filter workouts by tag">
        {workoutTags.map((tag) => <button type="button" class={props.selectedTag === tag ? "tag-button selected" : "tag-button"} onClick={() => props.setSelectedTag(tag)}>{tag}</button>)}
        <button type="button" class={props.selectedTag === "all" ? "tag-button selected" : "tag-button"} onClick={() => props.setSelectedTag("all")}>all</button>
      </div>
      <p class="muted exercise-intro">Personal records are calculated from all existing workout entries. Legacy workouts without an exercise GUID are included by exercise and machine name.</p>
      <div class="exercise-grid">
        {summaries.map((item) => <ExerciseCard summary={item} />)}
      </div>
      {summaries.length === 0 ? <p class="muted">No exercises match.</p> : null}
      <p class={props.status.toLowerCase().includes("error") ? "status error" : "status"}>{props.status}</p>
    </div>
  )
}

type ExerciseSummary = { key: string; id?: string; name: string; kind: string; machine?: string; tags: WorkoutTag[]; trackingMode?: WorkoutTrackingMode; workouts: number; maxReps?: number; maxSets?: number; maxWeight?: number; maxDuration?: number; maxDistance?: number }

function exerciseSummaries(exercises: ExerciseItem[], workouts: WorkoutEntry[]) {
  const summaries = new Map<string, ExerciseSummary>()
  for (const exercise of exercises) summaries.set(`catalog:${exercise.id}`, { key: `catalog:${exercise.id}`, id: exercise.id, name: exercise.name, kind: exercise.kind, machine: exercise.machine, tags: [], workouts: 0 })
  for (const workout of workouts) {
    const catalogMatch = workout.exerciseId ? exercises.find((exercise) => exercise.id === workout.exerciseId) : exercises.find((exercise) => exercise.name.toLowerCase() === workout.workout.toLowerCase() && (exercise.machine ?? "").toLowerCase() === (workout.machine ?? "").toLowerCase())
    const key = catalogMatch ? `catalog:${catalogMatch.id}` : `legacy:${workout.workout.toLowerCase()}|${(workout.machine ?? "").toLowerCase()}`
    const existing = summaries.get(key) ?? { key, name: workout.workout, kind: workout.category ?? "legacy", machine: workout.machine, tags: [], workouts: 0 }
    existing.trackingMode ??= workout.trackingMode ?? inferTrackingMode(workout)
    for (const tag of workout.tags ?? []) if (!existing.tags.includes(tag)) existing.tags.push(tag)
    existing.workouts += 1
    existing.maxSets = Math.max(existing.maxSets ?? 0, workout.sets.length)
    for (const set of workout.sets) {
      if (typeof set.reps === "number") existing.maxReps = Math.max(existing.maxReps ?? 0, set.reps)
      if (typeof set.weight === "number") existing.maxWeight = Math.max(existing.maxWeight ?? 0, set.weight)
      if (typeof set.durationMinutes === "number") existing.maxDuration = Math.max(existing.maxDuration ?? 0, set.durationMinutes)
      if (typeof set.distance === "number") existing.maxDistance = Math.max(existing.maxDistance ?? 0, set.distance)
    }
    summaries.set(key, existing)
  }
  return [...summaries.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function ExerciseCard(props: { summary: ExerciseSummary }) {
  return (
    <article class="exercise-card">
      <div class="exercise-card-head"><div><p class="label">{props.summary.kind}{props.summary.machine ? ` / ${props.summary.machine}` : ""}</p><h2>{props.summary.name}</h2></div><span class="workout-count">{props.summary.workouts} log{props.summary.workouts === 1 ? "" : "s"}</span></div>
      {props.summary.id ? <div class="label-id">{props.summary.id}</div> : <div class="label-id">legacy exercise / inferred from workout history</div>}
      {props.summary.tags.length ? <div class="tag-list">{props.summary.tags.map((tag) => <span>{tag}</span>)}</div> : null}
      {props.summary.trackingMode === "duration_distance" ? <div class="pr-grid"><div><span>max duration</span><strong>{formatPr(props.summary.maxDuration, " min")}</strong></div><div><span>max distance</span><strong>{formatPr(props.summary.maxDistance)}</strong></div></div> : <div class="pr-grid"><div><span>max reps</span><strong>{formatPr(props.summary.maxReps)}</strong></div><div><span>max sets</span><strong>{formatPr(props.summary.maxSets)}</strong></div><div><span>max weight</span><strong>{formatPr(props.summary.maxWeight, " lb")}</strong></div></div>}
    </article>
  )
}

function FitnessCalendar(props: { state: State }) {
  const today = todayKey()
  const trackedDates = [...Object.keys(props.state.nutrition), ...props.state.workouts.map((workout) => workout.date)]
  const first = trackedDates.sort()[0] ?? addDays(today, -27)
  const DayButton = (buttonProps: { day: { date: Date }; children?: unknown; [key: string]: unknown }) => {
    const { day, children, ...rest } = buttonProps
    const date = dateKeyFromDate(day.date)
    const workout = props.state.workouts.find((item) => item.date === date)
    const nutrition = props.state.nutrition[date]
    const category = slug(workout?.category ?? "")
    return (
      <button {...rest} class={`day ${category}`} type="button" onClick={() => { location.href = `/days/${date}` }}>
        <strong>{children}</strong>
        <span>{workout?.category ?? ""}</span>
        {nutrition?.nutrients.calories ? <small>{Math.round(nutrition.nutrients.calories)} cal</small> : null}
      </button>
    )
  }
  return <DayPicker mode="single" timeZone="America/Chicago" defaultMonth={dateFromKey(first)} startMonth={dateFromKey(first)} endMonth={dateFromKey(today)} numberOfMonths={monthsBetween(first, today) + 1} hideNavigation fixedWeeks showOutsideDays={false} components={{ DayButton }} />
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
      <p class="muted">{props.workout.category ?? "uncategorized"} · {props.workout.machine ?? "no machine"} · {props.workout.trackingMode ?? inferTrackingMode(props.workout)}</p>
      {props.workout.tags?.length ? <div class="tag-list">{props.workout.tags.map((tag) => <span>{tag}</span>)}</div> : null}
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

async function loadExercises(): Promise<ExerciseItem[]> {
  const response = await fetch("/api/exercises")
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

function dateFromKey(date: string) {
  return new Date(`${date}T12:00:00Z`)
}

function dateKeyFromDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}

function monthsBetween(start: string, end: string) {
  const [startYear, startMonth] = start.split("-").map(Number)
  const [endYear, endMonth] = end.split("-").map(Number)
  return (endYear - startYear) * 12 + (endMonth - startMonth)
}

function formatValue(value: number | undefined, suffix = "") {
  return typeof value === "number" ? `${Math.round(value)}${suffix}` : "--"
}

function formatPr(value: number | undefined, suffix = "") {
  return typeof value === "number" && value > 0 ? `${value}${suffix}` : "--"
}

function exerciseText(item: ExerciseSummary) {
  return [item.id, item.name, item.kind, item.machine, item.tags.join(" ")].join(" ").toLowerCase()
}

const workoutTags: WorkoutTag[] = ["plyometric", "upper", "lower", "core", "rehab", "cardio"]

function formatRatio(value: number | undefined) {
  return typeof value === "number" ? value.toFixed(3) : "--"
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

function inferTrackingMode(workout: WorkoutEntry): WorkoutTrackingMode {
  return workout.trackingMode ?? (workout.sets.some((set) => typeof set.durationMinutes === "number" || typeof set.distance === "number") && !workout.sets.some((set) => typeof set.reps === "number" || typeof set.weight === "number") ? "duration_distance" : "sets_reps_weight")
}

const mount = document.getElementById("fitcheck-app")
if (mount) render(<FitcheckApp />, mount)
