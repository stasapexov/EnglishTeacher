const express = require("express")
const axios = require("axios")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
require("dotenv").config()

const app = express()

app.set("view engine", "ejs")
app.use(express.static("public"))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

function parsePort(value, fallback = 3000) {
    const port = Number(value)
    return Number.isInteger(port) && port > 0 ? port : fallback
}

function healthPayload() {
    return {
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    }
}

// Health checks are intentionally registered before the other routes so cloud
// platforms can verify the container without rendering a full page.
app.get(["/health", "/healthz", "/ready"], (req, res) => {
    res.status(200).json(healthPayload())
})


// ===== AUTH (JSON STORAGE) =====
const DATA_DIR = path.join(__dirname, "data")
const USERS_FILE = path.join(DATA_DIR, "users.json")

function ensureUsersFile() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]\n")
}

function readUsers() {
    ensureUsersFile()
    const raw = fs.readFileSync(USERS_FILE, "utf8")
    const users = JSON.parse(raw || "[]")
    return Array.isArray(users) ? users : []
}

function saveUsers(users) {
    ensureUsersFile()
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + "\n")
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase()
}

function createPasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
    const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex")
    return `${salt}:${hash}`
}

function verifyPassword(password, storedHash = "") {
    const [salt, hash] = storedHash.split(":")
    if (!salt || !hash) return false
    const candidate = createPasswordHash(password, salt).split(":")[1]
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"))
}

function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
    }
}

function createSessionToken(user) {
    const token = crypto.randomBytes(32).toString("hex")
    user.tokenHash = crypto.createHash("sha256").update(token).digest("hex")
    user.lastLoginAt = new Date().toISOString()
    return token
}

function getBearerToken(req) {
    const header = req.get("authorization") || ""
    if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim()
    return req.get("x-auth-token") || ""
}

function findUserByToken(users, token) {
    if (!token) return null
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
    return users.find(user => user.tokenHash === tokenHash) || null
}


function todayKey(date = new Date()) {
    return date.toISOString().slice(0, 10)
}

function previousDayKey(date = new Date()) {
    const copy = new Date(date)
    copy.setUTCDate(copy.getUTCDate() - 1)
    return todayKey(copy)
}

function defaultProgress() {
    return {
        xp: 0,
        level: 1,
        streak: 0,
        learnedWords: 0,
        lastActivityDate: "",
        modeStats: {
            learn: { completed: 0, xp: 0 },
            guess: { completed: 0, xp: 0 },
            builder: { completed: 0, xp: 0 },
            wordle: { completed: 0, xp: 0 },
            reader: { completed: 0, xp: 0 },
            review: { completed: 0, xp: 0 },
            grammar: { completed: 0, xp: 0 },
            pronunciation: { completed: 0, xp: 0 },
            bookTrial: { completed: 0, xp: 0 }
        },
        reading: {}
    }
}

function defaultDailyTasks() {
    return {
        date: todayKey(),
        tasks: [
            { id: "review", title: "Повтори 10 слов", target: 10, progress: 0, done: false, xp: 20 },
            { id: "reader", title: "Переведи 10 слов в Reading Room", target: 10, progress: 0, done: false, xp: 15 },
            { id: "game", title: "Пройди 1 игру", target: 1, progress: 0, done: false, xp: 15 }
        ]
    }
}

function ensureUserLearningData(user) {
    user.progress = { ...defaultProgress(), ...(user.progress || {}) }
    user.progress.modeStats = { ...defaultProgress().modeStats, ...(user.progress.modeStats || {}) }
    user.progress.reading = user.progress.reading || {}
    user.dictionary = Array.isArray(user.dictionary) ? user.dictionary : []
    user.achievements = Array.isArray(user.achievements) ? user.achievements : []
    user.dailyTasks = user.dailyTasks || defaultDailyTasks()
    if (user.dailyTasks.date !== todayKey()) user.dailyTasks = defaultDailyTasks()
    return user
}

function xpForLevel(level) {
    return 80 + (level - 1) * 55
}

function recalcLevel(progress) {
    while (progress.level < 100 && progress.xp >= xpForLevel(progress.level)) {
        progress.xp -= xpForLevel(progress.level)
        progress.level++
    }
}

function awardXp(user, mode, amount = 0) {
    ensureUserLearningData(user)
    const progress = user.progress
    const safeMode = progress.modeStats[mode] ? mode : "learn"
    progress.xp += Number(amount) || 0
    progress.modeStats[safeMode].xp += Number(amount) || 0
    progress.modeStats[safeMode].completed += 1

    const today = todayKey()
    if (progress.lastActivityDate !== today) {
        progress.streak = progress.lastActivityDate === previousDayKey() ? progress.streak + 1 : 1
        progress.lastActivityDate = today
    }

    recalcLevel(progress)
    updateAchievements(user)
}

function updateDailyTask(user, taskId, amount = 1) {
    ensureUserLearningData(user)
    const task = user.dailyTasks.tasks.find(item => item.id === taskId)
    if (!task || task.done) return null
    task.progress = Math.min(task.target, task.progress + amount)
    if (task.progress >= task.target) {
        task.done = true
        awardXp(user, "learn", task.xp)
    }
    return task
}

function updateAchievements(user) {
    ensureUserLearningData(user)
    const achievements = [
        { id: "first-login", title: "Первый вход", condition: () => true },
        { id: "ten-words", title: "10 слов в словаре", condition: () => user.dictionary.length >= 10 },
        { id: "hundred-xp", title: "100 XP", condition: () => user.progress.xp >= 100 || user.progress.level > 1 },
        { id: "week-streak", title: "7 дней подряд", condition: () => user.progress.streak >= 7 },
        { id: "reader-start", title: "Первое чтение", condition: () => Object.keys(user.progress.reading || {}).length > 0 }
    ]

    for (const achievement of achievements) {
        if (!user.achievements.some(item => item.id === achievement.id) && achievement.condition()) {
            user.achievements.push({ id: achievement.id, title: achievement.title, earnedAt: new Date().toISOString() })
        }
    }
}

function authContext(req) {
    const users = readUsers()
    const user = findUserByToken(users, getBearerToken(req))
    if (user) ensureUserLearningData(user)
    return { users, user }
}

function requireApiAuth(req, res) {
    const ctx = authContext(req)
    if (!ctx.user) {
        res.status(401).json({ error: "unauthorized", message: "Нужно войти в аккаунт" })
        return null
    }
    return ctx
}

function publicLearningUser(user) {
    ensureUserLearningData(user)
    return {
        ...publicUser(user),
        progress: user.progress,
        achievements: user.achievements,
        placementLevel: user.placementLevel || "Не определён"
    }
}

app.post("/api/register", (req, res) => {
    const name = String(req.body.name || "").trim()
    const email = normalizeEmail(req.body.email)
    const password = String(req.body.password || "")

    if (name.length < 2) return res.status(400).json({ error: "name_required", message: "Введите имя минимум из 2 символов" })
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "email_invalid", message: "Введите корректный email" })
    if (password.length < 6) return res.status(400).json({ error: "password_short", message: "Пароль должен быть не короче 6 символов" })

    const users = readUsers()
    if (users.some(user => user.email === email)) {
        return res.status(409).json({ error: "email_exists", message: "Пользователь с таким email уже зарегистрирован" })
    }

    const now = new Date().toISOString()
    const user = ensureUserLearningData({
        id: crypto.randomUUID(),
        name,
        email,
        passwordHash: createPasswordHash(password),
        createdAt: now,
        updatedAt: now
    })
    const token = createSessionToken(user)
    users.push(user)
    saveUsers(users)

    res.status(201).json({ message: "Регистрация успешна", token, user: publicLearningUser(user) })
})

app.post("/api/login", (req, res) => {
    const email = normalizeEmail(req.body.email)
    const password = String(req.body.password || "")
    const users = readUsers()
    const user = users.find(item => item.email === email)

    if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: "invalid_credentials", message: "Неверный email или пароль" })
    }

    const token = createSessionToken(user)
    user.updatedAt = new Date().toISOString()
    saveUsers(users)

    res.json({ message: "Вход выполнен", token, user: publicLearningUser(user) })
})

app.get("/api/me", (req, res) => {
    const users = readUsers()
    const user = findUserByToken(users, getBearerToken(req))

    if (!user) return res.status(401).json({ error: "unauthorized", message: "Нужно войти в аккаунт" })
    res.json({ user: publicLearningUser(user) })
})

app.post("/api/logout", (req, res) => {
    const users = readUsers()
    const user = findUserByToken(users, getBearerToken(req))

    if (user) {
        delete user.tokenHash
        user.updatedAt = new Date().toISOString()
        saveUsers(users)
    }

    res.json({ message: "Вы вышли из аккаунта" })
})


// ===== LEARNING PROFILE API =====
app.get("/api/progress", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    updateAchievements(ctx.user)
    saveUsers(ctx.users)
    res.json({ user: publicLearningUser(ctx.user), dailyTasks: ctx.user.dailyTasks })
})

app.post("/api/activity", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    const mode = String(req.body.mode || "learn")
    const xp = Math.max(0, Math.min(100, Number(req.body.xp) || 0))
    awardXp(ctx.user, mode, xp)
    if (["wordle", "builder", "guess"].includes(mode)) updateDailyTask(ctx.user, "game", 1)
    saveUsers(ctx.users)
    res.json({ user: publicLearningUser(ctx.user), dailyTasks: ctx.user.dailyTasks })
})

app.get("/api/daily", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    saveUsers(ctx.users)
    res.json({ dailyTasks: ctx.user.dailyTasks })
})

app.post("/api/daily/:id", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    const task = updateDailyTask(ctx.user, req.params.id, Number(req.body.amount) || 1)
    saveUsers(ctx.users)
    res.json({ task, dailyTasks: ctx.user.dailyTasks, user: publicLearningUser(ctx.user) })
})

app.get("/api/dictionary", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    const status = req.query.status
    const items = status ? ctx.user.dictionary.filter(item => item.status === status) : ctx.user.dictionary
    res.json({ words: items })
})

app.post("/api/dictionary", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    const word = String(req.body.word || "").trim()
    const translation = String(req.body.translation || "").trim()
    if (!word) return res.status(400).json({ error: "word_required", message: "Укажите слово" })

    const existing = ctx.user.dictionary.find(item => item.word.toLowerCase() === word.toLowerCase())
    if (existing) {
        existing.translation = translation || existing.translation
        existing.status = "new"
        existing.updatedAt = new Date().toISOString()
        saveUsers(ctx.users)
        return res.json({ word: existing, words: ctx.user.dictionary })
    }

    const now = new Date().toISOString()
    const item = {
        id: crypto.randomUUID(),
        word,
        translation,
        status: "new",
        repetitions: 0,
        correct: 0,
        wrong: 0,
        nextReviewAt: now,
        createdAt: now,
        updatedAt: now
    }
    ctx.user.dictionary.push(item)
    ctx.user.progress.learnedWords = ctx.user.dictionary.length
    updateDailyTask(ctx.user, "reader", 1)
    updateAchievements(ctx.user)
    saveUsers(ctx.users)
    res.status(201).json({ word: item, words: ctx.user.dictionary, user: publicLearningUser(ctx.user) })
})

app.patch("/api/dictionary/:id", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    const item = ctx.user.dictionary.find(word => word.id === req.params.id)
    if (!item) return res.status(404).json({ error: "word_not_found", message: "Слово не найдено" })

    if (req.body.translation !== undefined) item.translation = String(req.body.translation || "").trim()
    if (["new", "review", "learned"].includes(req.body.status)) item.status = req.body.status
    item.updatedAt = new Date().toISOString()
    saveUsers(ctx.users)
    res.json({ word: item, words: ctx.user.dictionary })
})

app.delete("/api/dictionary/:id", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    ctx.user.dictionary = ctx.user.dictionary.filter(word => word.id !== req.params.id)
    ctx.user.progress.learnedWords = ctx.user.dictionary.length
    saveUsers(ctx.users)
    res.json({ words: ctx.user.dictionary })
})

app.get("/api/review", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    const now = Date.now()
    const due = ctx.user.dictionary.filter(item => new Date(item.nextReviewAt).getTime() <= now && item.status !== "learned")
    res.json({ words: due.length ? due : ctx.user.dictionary.filter(item => item.status !== "learned").slice(0, 10) })
})

app.post("/api/review/:id", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    const item = ctx.user.dictionary.find(word => word.id === req.params.id)
    if (!item) return res.status(404).json({ error: "word_not_found", message: "Слово не найдено" })

    const correct = Boolean(req.body.correct)
    const intervals = [1, 3, 7, 14, 30]
    if (correct) {
        item.correct += 1
        item.repetitions += 1
        item.status = item.repetitions >= 4 ? "learned" : "review"
        awardXp(ctx.user, "review", 5)
        updateDailyTask(ctx.user, "review", 1)
    } else {
        item.wrong += 1
        item.repetitions = 0
        item.status = "review"
    }
    const days = correct ? intervals[Math.min(item.repetitions, intervals.length - 1)] : 1
    const next = new Date()
    next.setUTCDate(next.getUTCDate() + days)
    item.nextReviewAt = next.toISOString()
    item.updatedAt = new Date().toISOString()
    saveUsers(ctx.users)
    res.json({ word: item, user: publicLearningUser(ctx.user), dailyTasks: ctx.user.dailyTasks })
})

app.post("/api/reading-progress", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    const bookId = String(req.body.bookId || "").trim()
    if (!bookId) return res.status(400).json({ error: "book_required" })
    ctx.user.progress.reading[bookId] = {
        percent: Math.max(0, Math.min(100, Number(req.body.percent) || 0)),
        scrollY: Math.max(0, Number(req.body.scrollY) || 0),
        updatedAt: new Date().toISOString()
    }
    awardXp(ctx.user, "reader", Number(req.body.xp) || 0)
    saveUsers(ctx.users)
    res.json({ reading: ctx.user.progress.reading[bookId], user: publicLearningUser(ctx.user) })
})

app.get("/api/leaderboard", (req, res) => {
    const leaders = readUsers()
        .map(ensureUserLearningData)
        .map(user => ({ name: user.name, level: user.progress.level, xp: user.progress.xp, streak: user.progress.streak, learnedWords: user.dictionary.length }))
        .sort((a, b) => (b.level - a.level) || (b.xp - a.xp) || (b.streak - a.streak))
        .slice(0, 10)
    res.json({ leaders })
})

app.post("/api/placement", (req, res) => {
    const ctx = requireApiAuth(req, res)
    if (!ctx) return
    const answers = Array.isArray(req.body.answers) ? req.body.answers : []
    const score = answers.filter(Boolean).length
    ctx.user.placementLevel = score <= 4 ? "A1-A2" : score <= 8 ? "B1-B2" : "C1"
    awardXp(ctx.user, "learn", 10)
    saveUsers(ctx.users)
    res.json({ level: ctx.user.placementLevel, score, user: publicLearningUser(ctx.user) })
})

// ===== WORDS =====
const words = require("./public/words.json")

// ===== WORD PAIRS (для Wordle) =====
const wordPairs = [
    { en: "apple", ru: "яблоко" },
    { en: "house", ru: "дом" },
    { en: "cat", ru: "кот", ru2: "кошка"},
    { en: "dog", ru: "собака",ru2: "пес" },
    { en: "car", ru: "машина" },
    { en: "book", ru: "книга" },
    { en: "sun", ru: "солнце" },
    { en: "moon", ru: "луна" },
    { en: "star", ru: "звезда" },
    { en: "sky", ru: "небо" },
    { en: "tree", ru: "дерево" },
    { en: "flower", ru: "цветок" },
    { en: "grass", ru: "трава" },
    { en: "water", ru: "вода" },
    { en: "fire", ru: "огонь" },
    { en: "bread", ru: "хлеб" },
    { en: "milk", ru: "молоко" },
    { en: "tea", ru: "чай" },
    { en: "coffee", ru: "кофе" },
    { en: "friend", ru: "друг" },
    { en: "mother", ru: "мать", ru2: "мама" },
    { en: "father", ru: "отец", ru2: "папа" },
    { en: "brother", ru: "брат" },
    { en: "sister", ru: "сестра" },
    { en: "child", ru: "ребёнок", ru2: "ребенок" },
    { en: "book", ru: "книга" },
    { en: "pen", ru: "ручка" },
    { en: "paper", ru: "бумага" },
    { en: "table", ru: "стол" },
    { en: "chair", ru: "стул" },
    { en: "door", ru: "дверь" },
    { en: "window", ru: "окно" },
    { en: "road", ru: "дорога" },
    { en: "car", ru: "машина" },
    { en: "train", ru: "поезд" },
    { en: "plane", ru: "самолёт", ru2: "самолет" },
    { en: "city", ru: "город" },
    { en: "village", ru: "деревня" },
    { en: "school", ru: "школа" },
    { en: "work", ru: "работа" },
    { en: "time", ru: "время" },
    { en: "day", ru: "день" },
    { en: "night", ru: "ночь" },
    { en: "week", ru: "неделя" },
    { en: "month", ru: "месяц" },
    { en: "year", ru: "год" },
    { en: "rain", ru: "дождь" },
    { en: "snow", ru: "снег" },
    { en: "wind", ru: "ветер" },
    { en: "sea", ru: "море" },
    { en: "river", ru: "река" },
    { en: "mountain", ru: "гора" },
    { en: "forest", ru: "лес" },
    { en: "music", ru: "музыка" },
    { en: "love", ru: "любовь" },
    { en: "dream", ru: "мечта" , ru2: "сон"}
]
const wordPairs2 = [
    { en: "opportunity", ru: "возможность" },
    { en: "challenge", ru: "вызов" },
    { en: "experience", ru: "опыт" },
    { en: "knowledge", ru: "знание" },
    { en: "education", ru: "образование" },
    { en: "government", ru: "правительство" },
    { en: "environment", ru: "окружающая среда" },
    { en: "development", ru: "развитие" },
    { en: "relationship", ru: "отношения" },
    { en: "communication", ru: "общение" },
    { en: "responsible", ru: "ответственный" },
    { en: "independent", ru: "независимый" },
    { en: "successful", ru: "успешный" },
    { en: "dangerous", ru: "опасный" },
    { en: "expensive", ru: "дорогой" },
    { en: "necessary", ru: "необходимый" },
    { en: "available", ru: "доступный" },
    { en: "comfortable", ru: "удобный" },
    { en: "improve", ru: "улучшать" },
    { en: "develop", ru: "развивать" },
    { en: "achieve", ru: "достигать" },
    { en: "explain", ru: "объяснять" },
    { en: "consider", ru: "рассматривать" },
    { en: "believe", ru: "верить" },
    { en: "support", ru: "поддерживать" },
    { en: "continue", ru: "продолжать" },
    { en: "require", ru: "требовать" },
    { en: "manage", ru: "управлять" },
    { en: "business", ru: "бизнес" },
    { en: "company", ru: "компания" },
    { en: "society", ru: "общество" },
    { en: "culture", ru: "культура" },
    { en: "history", ru: "история" },
    { en: "science", ru: "наука" },
    { en: "technology", ru: "технология" },
    { en: "economy", ru: "экономика" },
    { en: "politics", ru: "политика" },
    { en: "decision", ru: "решение" },
    { en: "attention", ru: "внимание" },
    { en: "condition", ru: "условие" },
    { en: "situation", ru: "ситуация" },
    { en: "advantage", ru: "преимущество" },
    { en: "disadvantage", ru: "недостаток" },
    { en: "influence", ru: "влияние" },
    { en: "difference", ru: "разница" },
    { en: "important", ru: "важный" },
    { en: "difficult", ru: "трудный" },
    { en: "interesting", ru: "интересный" },
    { en: "popular", ru: "популярный" },
    { en: "probably", ru: "вероятно" }
]
const wordPairs3 = [
    { en: "ubiquitous", ru: "вездесущий", ru2: "повсеместный" },
    { en: "ephemeral", ru: "эфемерный", ru2: "мимолетный" },
    { en: "cogent", ru: "убедительный", ru2: "веский" },
    { en: "disparate", ru: "разнородный", ru2: "несопоставимый" },
    { en: "equivocal", ru: "двусмысленный", ru2: "неоднозначный" },
    { en: "fastidious", ru: "привередливый", ru2: "требовательный" },
    { en: "gregarious", ru: "общительный", ru2: "коммуникабельный" },
    { en: "hedonism", ru: "гедонизм", ru2: "стремление к удовольствиям" },
    { en: "iconoclast", ru: "иконоборец", ru2: "ниспровергатель авторитетов" },
    { en: "juxtapose", ru: "сопоставлять", ru2: "противопоставлять" },
    { en: "kaleidoscopic", ru: "калейдоскопический", ru2: "постоянно меняющийся" },
    { en: "laconic", ru: "лаконичный", ru2: "краткий" },
    { en: "mellifluous", ru: "мелодичный", ru2: "благозвучный" },
    { en: "nefarious", ru: "нечестивый", ru2: "подлый" },
    { en: "obfuscate", ru: "запутывать", ru2: "затруднять понимание" },
    { en: "paradigm", ru: "парадигма", ru2: "модель" },
    { en: "quintessential", ru: "квинтэссенция", ru2: "идеальный образец" },
    { en: "recalcitrant", ru: "непокорный", ru2: "строптивый" },
    { en: "sycophant", ru: "подхалим", ru2: "льстец" },
    { en: "taciturn", ru: "молчаливый", ru2: "неразговорчивый" },
    { en: "ubiquity", ru: "вездесущность", ru2: "повсеместность" },
    { en: "vacillate", ru: "колебаться", ru2: "быть нерешительным" },
    { en: "wanton", ru: "безрассудный", ru2: "беспричинный" },
    { en: "xenophobia", ru: "ксенофобия", ru2: "нетерпимость к чужакам" },
    { en: "yearning", ru: "страстное желание", ru2: "тоска" },
    { en: "zealot", ru: "фанатик", ru2: "ревнитель" },
    { en: "amalgamate", ru: "объединять", ru2: "сливать" },
    { en: "belligerent", ru: "воинственный", ru2: "агрессивный" },
    { en: "capricious", ru: "капризный", ru2: "непредсказуемый" },
    { en: "dichotomy", ru: "дихотомия", ru2: "разделение на две части" },
    { en: "erudite", ru: "эрудированный", ru2: "начитанный" },
    { en: "facetious", ru: "шутливый", ru2: "легкомысленный" },
    { en: "garrulous", ru: "болтливый", ru2: "говорливый" },
    { en: "haughty", ru: "надменный", ru2: "высокомерный" },
    { en: "impetuous", ru: "стремительный", ru2: "импульсивный" },
    { en: "jaded", ru: "пресыщенный", ru2: "уставший" },
    { en: "lackluster", ru: "тусклый", ru2: "невыразительный" },
    { en: "magnanimous", ru: "великодушный", ru2: "благородный" },
    { en: "nonchalant", ru: "беззаботный", ru2: "невозмутимый" },
    { en: "ostentatious", ru: "показной", ru2: "вычурный" },
    { en: "pedantic", ru: "педантичный", ru2: "дотошный" },
    { en: "querulous", ru: "ворчливый", ru2: "раздражительный" },
    { en: "resilient", ru: "устойчивый", ru2: "жизнестойкий" },
    { en: "sporadic", ru: "спорадический", ru2: "нерегулярный" },
    { en: "trepidation", ru: "трепет", ru2: "опасение" },
    { en: "unequivocal", ru: "недвусмысленный", ru2: "определенный" },
    { en: "verisimilitude", ru: "правдоподобие", ru2: "реалистичность" },
    { en: "whimsical", ru: "причудливый", ru2: "капризный" },
    { en: "yield", ru: "уступать", ru2: "давать результат" },
    { en: "zenith", ru: "зенит", ru2: "апогей" }
]

// ===== BOOKS =====
const BOOKS = [
    {
        id: "alice",
        title: "Alice's Adventures in Wonderland",
        author: "Lewis Carroll",
        file: path.join(__dirname, "public/books/alice.txt"),
    },
    {
        id: "sherlock",
        title: "Robinson Crusoe",
        author: "Deniel Depho",
        file: path.join(__dirname, "public/books/sherlock.txt"),
    },
    {
        id: "dialogues",
        title: "Everyday English Dialogues",
        author: "English Trainer",
        file: path.join(__dirname, "public/books/dialogues.txt"),
    },
]

const BOOK_TRIAL_SUMMARIES = {
    alice: {
        keyPoints: [
            "Alice follows the White Rabbit and falls down a rabbit hole.",
            "She enters Wonderland, a strange dream-like world with unusual rules.",
            "Alice changes size, meets the Caterpillar, the Cheshire Cat, the Mad Hatter, the March Hare and the Queen of Hearts.",
            "The story is about curiosity, imagination, absurd situations and Alice trying to understand Wonderland."
        ],
        summary: "Alice's Adventures in Wonderland is about a curious girl named Alice who follows the White Rabbit, falls down a rabbit hole and enters Wonderland. In this strange world she changes size, meets unusual characters such as the Caterpillar, the Cheshire Cat, the Mad Hatter and the Queen of Hearts, and experiences absurd dream-like adventures before waking up.",
        summaryRu: "«Алиса в Стране чудес» рассказывает о любопытной девочке Алисе, которая следует за Белым Кроликом, падает в кроличью нору и попадает в Страну чудес. Там она меняет рост, встречает необычных персонажей — Гусеницу, Чеширского Кота, Шляпника и Королеву Червей — переживает странные, похожие на сон приключения и в конце просыпается.",
        quiz: [
            {
                question: "Who does Alice follow at the beginning of the story?",
                options: ["The White Rabbit", "The Queen of Hearts", "The Cheshire Cat", "The Mad Hatter"],
                answer: 0
            },
            {
                question: "Where does Alice go after falling down the rabbit hole?",
                options: ["Wonderland", "London", "A desert island", "A school"],
                answer: 0
            },
            {
                question: "Which character is famous for disappearing and leaving only a grin?",
                options: ["The Cheshire Cat", "The Caterpillar", "The March Hare", "The King of Hearts"],
                answer: 0
            },
            {
                question: "What is one main idea of the book?",
                options: ["Curiosity and imagination", "Space travel", "A detective investigation", "A war between kingdoms"],
                answer: 0
            }
        ]
    },
    sherlock: {
        keyPoints: [
            "Robinson Crusoe goes to sea and becomes shipwrecked on a remote island.",
            "He survives alone by building shelter, finding food, making tools and learning to adapt.",
            "He later meets Friday and teaches him while they face danger together.",
            "The story is about survival, independence, faith, hard work and human resilience."
        ],
        summary: "Robinson Crusoe is about a sailor who is shipwrecked and forced to live for many years on a remote island. He builds a shelter, grows food, makes tools, keeps a journal, reflects on his life and learns to survive. Later he meets Friday and their relationship becomes an important part of the story. The book focuses on survival, patience, faith and independence.",
        summaryRu: "«Робинзон Крузо» рассказывает о моряке, который после кораблекрушения много лет живёт на далёком острове. Он строит жильё, добывает еду, делает инструменты, ведёт дневник, размышляет о жизни и учится выживать. Позже он встречает Пятницу, и их отношения становятся важной частью истории. Главные темы книги — выживание, терпение, вера и самостоятельность.",
        quiz: [
            {
                question: "What happens to Robinson Crusoe?",
                options: ["He is shipwrecked on an island", "He becomes a king", "He opens a school", "He travels to Wonderland"],
                answer: 0
            },
            {
                question: "What does Crusoe do to survive?",
                options: ["He builds shelter and finds food", "He solves crimes in London", "He studies magic", "He wins a race"],
                answer: 0
            },
            {
                question: "Who does Robinson Crusoe meet later in the story?",
                options: ["Friday", "The White Rabbit", "Sherlock Holmes", "The Queen of Hearts"],
                answer: 0
            },
            {
                question: "Which theme is important in the book?",
                options: ["Survival and independence", "Dreams and nonsense", "Shopping phrases", "City traffic"],
                answer: 0
            }
        ]
    },
    dialogues: {
        keyPoints: [
            "The book contains everyday English conversations for real-life situations.",
            "The dialogues show how people greet each other, ask questions, make plans and solve simple problems.",
            "It helps learners practice practical spoken English, polite phrases and useful vocabulary.",
            "The main purpose is communication practice rather than one continuous plot."
        ],
        summary: "Everyday English Dialogues is a training book made of short conversations from daily life. It is about practical communication: greetings, questions, plans, shopping, school, travel and other common situations. The goal is to help learners understand natural phrases and speak English more confidently in real situations.",
        summaryRu: "«Everyday English Dialogues» — это учебная книга с короткими диалогами из повседневной жизни. Она посвящена практическому общению: приветствиям, вопросам, планам, покупкам, школе, путешествиям и другим обычным ситуациям. Цель книги — помочь ученикам понимать естественные фразы и увереннее говорить по-английски в реальной жизни.",
        quiz: [
            {
                question: "What is this book mainly made of?",
                options: ["Short everyday dialogues", "One long adventure story", "Scientific articles", "Poems about nature"],
                answer: 0
            },
            {
                question: "Which situation can the dialogues help with?",
                options: ["Greeting people and asking questions", "Repairing a spaceship", "Fighting dragons", "Solving a murder"],
                answer: 0
            },
            {
                question: "What is the main goal of the book?",
                options: ["To practice practical spoken English", "To teach advanced physics", "To explain ancient history", "To train professional athletes"],
                answer: 0
            },
            {
                question: "Does the book have one continuous plot?",
                options: ["No, it has separate conversations", "Yes, it is a detective novel", "Yes, it is a fantasy quest", "No, it is only a dictionary"],
                answer: 0
            }
        ]
    }
}

function cleanJsonText(text) {
    return String(text || "")
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim()
}

function parseAiJson(text) {
    const cleaned = cleanJsonText(text)
    try {
        return JSON.parse(cleaned)
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/)
        if (!match) throw new Error("AI response did not contain JSON")
        return JSON.parse(match[0])
    }
}

function normalizeScore(value, fallback = 0) {
    const score = Number(value)
    if (!Number.isFinite(score)) return fallback
    return Math.max(0, Math.min(100, Math.round(score)))
}

function normalizeTrialResult(result, provider, fallbackReason = "") {
    const matchPercent = normalizeScore(result.matchPercent, 0)
    return {
        matchPercent,
        contentScore: normalizeScore(result.contentScore, matchPercent),
        englishScore: normalizeScore(result.englishScore, 50),
        level: String(result.level || "A2"),
        isMostlyCorrect: Boolean(result.isMostlyCorrect),
        missedKeyPoints: Array.isArray(result.missedKeyPoints) ? result.missedKeyPoints.slice(0, 5) : [],
        wrongClaims: Array.isArray(result.wrongClaims) ? result.wrongClaims.slice(0, 5) : [],
        strongPoints: Array.isArray(result.strongPoints) ? result.strongPoints.slice(0, 5) : [],
        feedbackRu: String(result.feedbackRu || "Ответ проверен. Попробуй добавить больше конкретных событий из книги."),
        correctedAnswerEn: String(result.correctedAnswerEn || ""),
        correctedAnswerRu: String(result.correctedAnswerRu || result.modelAnswerRu || ""),
        provider,
        fallbackReason
    }
}

function keywordFallbackEvaluation(book, userAnswer, fallbackReason = "") {
    const summary = BOOK_TRIAL_SUMMARIES[book.id] || BOOK_TRIAL_SUMMARIES.dialogues
    const answer = String(userAnswer || "").toLowerCase()
    const words = answer.match(/[a-zа-яё]+(?:'[a-z]+)?/giu) || []
    const uniqueWords = new Set(words)
    const importantWords = `${summary.summary} ${summary.summaryRu}`.toLowerCase().match(/[a-zа-яё]{4,}/giu) || []
    const uniqueImportant = [...new Set(importantWords)]
    const matchedWords = uniqueImportant.filter(word => uniqueWords.has(word))
    const lengthScore = Math.min(30, Math.floor(words.length * 1.5))
    const keywordScore = Math.min(55, Math.round((matchedWords.length / Math.max(8, uniqueImportant.length * 0.25)) * 55))
    const languageScore = /[а-яё]/i.test(answer) ? 100 : 55
    const englishScore = Math.min(100, Math.max(45, languageScore - (words.length < 8 ? 20 : 0)))
    const matchPercent = Math.min(100, Math.max(10, keywordScore + lengthScore + (words.length > 18 ? 15 : 0)))
    const translatedKeyPoints = (summary.summaryRu.match(/[^.!?]+[.!?]+/g) || [summary.summaryRu]).map(point => point.trim())

    return normalizeTrialResult({
        matchPercent,
        contentScore: matchPercent,
        englishScore,
        level: words.length > 45 ? "B2" : words.length > 25 ? "B1" : "A2",
        isMostlyCorrect: matchPercent >= 60,
        strongPoints: matchedWords.slice(0, 4).map(word => `Ты упомянул(а) важную деталь: ${word}.`),
        missedKeyPoints: translatedKeyPoints.filter(point => !point.toLowerCase().split(/[^a-zа-яё]+/iu).some(word => word.length > 5 && uniqueWords.has(word))).slice(0, 3),
        wrongClaims: [],
        feedbackRu: "Бесплатная AI-модель сейчас недоступна, поэтому включилась локальная смысловая проверка по ключевым событиям книги. Для более высокого процента добавь главного героя, место действия и 2–3 важных события на русском.",
        correctedAnswerEn: summary.summary,
        correctedAnswerRu: summary.summaryRu
    }, "local-free-fallback", fallbackReason)
}

function buildBookTrialPrompt(book, question, userAnswer) {
    const summary = BOOK_TRIAL_SUMMARIES[book.id] || BOOK_TRIAL_SUMMARIES.dialogues
    return `You are a bilingual literature exam evaluator. The student answers the book-content question in Russian. Evaluate how well the Russian answer matches the book content; do not require exact wording and judge meaning. Return only valid JSON and no markdown.

Book title: ${book.title}
Author: ${book.author}
Reference summary in English: ${summary.summary}
Reference summary in Russian: ${summary.summaryRu}
Key points:
- ${summary.keyPoints.join("\n- ")}

Exam question: ${question}
Student answer in Russian: ${userAnswer}

Scoring rules:
- matchPercent/contentScore: content accuracy and completeness only.
- englishScore: do not grade the Russian answer as English writing; use 100 when the answer is clearly Russian and understandable, lower only if it is too short or unreadable.
- feedbackRu, missedKeyPoints, wrongClaims, strongPoints and correctedAnswerRu must be written in Russian.

JSON schema:
{
  "matchPercent": number from 0 to 100,
  "contentScore": number from 0 to 100,
  "englishScore": number from 0 to 100,
  "level": "A1" | "A2" | "B1" | "B2" | "C1",
  "isMostlyCorrect": boolean,
  "missedKeyPoints": string[],
  "wrongClaims": string[],
  "strongPoints": string[],
  "feedbackRu": string,
  "correctedAnswerEn": string,
  "correctedAnswerRu": string
}`
}

async function evaluateWithPollinations(book, question, userAnswer) {
    const prompt = buildBookTrialPrompt(book, question, userAnswer)
    const params = {
        json: "true",
        model: process.env.POLLINATIONS_MODEL || "openai"
    }
    if (process.env.POLLINATIONS_API_KEY) params.key = process.env.POLLINATIONS_API_KEY

    const response = await axios.get(`https://gen.pollinations.ai/text/${encodeURIComponent(prompt)}`, {
        params,
        timeout: 25000,
        headers: { "User-Agent": "EnglishTeacher-BookTrial/1.0" },
        responseType: "text",
        transformResponse: [data => data]
    })
    return normalizeTrialResult(parseAiJson(response.data), "pollinations-free-ai")
}

// ===== ROUTES =====

app.get("/", (req, res) => {
    res.render("index")
})


app.get("/profile", (req, res) => {
    res.render("profile")
})

app.get("/dictionary", (req, res) => {
    res.render("dictionary")
})

app.get("/review", (req, res) => {
    res.render("review")
})

app.get("/placement", (req, res) => {
    res.render("placement")
})

app.get("/grammar", (req, res) => {
    res.render("grammar")
})

app.get("/pronunciation", (req, res) => {
    res.render("pronunciation")
})

app.get("/leaderboard", (req, res) => {
    res.render("leaderboard")
})

// ===== READER =====

app.get("/reader", (req, res) => {
    res.render("reader", { books: BOOKS })
})

app.get("/book-trial", (req, res) => {
    const selectedBook = BOOKS.some(book => book.id === req.query.book) ? req.query.book : BOOKS[0].id
    res.render("book-trial", { books: BOOKS, selectedBook })
})

app.post("/api/book-trial/evaluate", async (req, res) => {
    const bookId = String(req.body.bookId || "").trim()
    const question = String(req.body.question || "О чём эта книга? Ответь по-русски.").trim().slice(0, 240)
    const userAnswer = String(req.body.userAnswer || "").trim().slice(0, 1400)
    const book = BOOKS.find(item => item.id === bookId)

    if (!book) return res.status(404).json({ error: "book_not_found", message: "Книга не найдена" })
    if (userAnswer.length < 8) return res.status(400).json({ error: "answer_too_short", message: "Ответ слишком короткий" })

    try {
        const result = await evaluateWithPollinations(book, question, userAnswer)
        const ctx = authContext(req)
        if (ctx.user) {
            awardXp(ctx.user, "bookTrial", Math.max(5, Math.round(result.matchPercent / 10)))
            saveUsers(ctx.users)
        }
        return res.json(result)
    } catch (error) {
        console.log("Pollinations Book Trial Error:", error.response?.status || error.message)
        const fallback = keywordFallbackEvaluation(book, userAnswer, "Free AI provider unavailable; used local semantic fallback.")
        return res.json(fallback)
    }
})

app.get("/api/books", (req, res) => {
    res.json(BOOKS.map(b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        quiz: (BOOK_TRIAL_SUMMARIES[b.id]?.quiz || [])
    })))
})

app.get("/api/books/:id", async (req, res) => {
    const book = BOOKS.find(b => b.id === req.params.id)
    if (!book) return res.status(404).json({ error: "book_not_found" })

    try {
        const text = fs.readFileSync(book.file, "utf8")
        res.json({ ...book, text, quiz: (BOOK_TRIAL_SUMMARIES[book.id]?.quiz || []) })
    } catch {
        res.status(500).json({ error: "book_read_failed" })
    }
})

// ===== TRANSLATE =====

app.post("/api/translate", async (req, res) => {
    const { text, from = "en", to = "ru" } = req.body
    const cleaned = text?.trim()

    if (!cleaned) return res.status(400).json({ error: "text_required" })

    try {
        console.log("TRANSLATE:", cleaned)

        // Проверяем наличие переменных окружения
        if (!process.env.YC_FOLDER_ID || !process.env.YC_API_KEY) {
            console.log("Missing Yandex Cloud credentials, using fallback")
            throw new Error("Missing credentials")
        }

        // Исправленный формат запроса к Yandex Translate API
        const resp = await axios.post(
            "https://translate.api.cloud.yandex.net/translate/v2/translate",
            {
                folderId: process.env.YC_FOLDER_ID,
                texts: [cleaned],
                targetLanguageCode: to,
                sourceLanguageCode: from, // Добавляем исходный язык
                format: "PLAIN_TEXT" // Явно указываем формат
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Api-Key ${process.env.YC_API_KEY}`,
                },
                timeout: 10000,
            }
        )

        // Проверяем структуру ответа
        if (resp.data && resp.data.translations && resp.data.translations[0]) {
            const translated = resp.data.translations[0].text
            return res.json({ text: cleaned, translated })
        } else {
            console.log("Unexpected Yandex API response:", resp.data)
            throw new Error("Invalid API response")
        }

    } catch (e) {
        console.log("Yandex API Error:", e.message)
        if (e.response) {
            console.log("Yandex API Response:", e.response.data)
        }

        // ===== FALLBACK API =====
        try {
            console.log("Using fallback translation API for:", cleaned)

            // MyMemory API требует кодирования параметров
            const encodedText = encodeURIComponent(cleaned)
            const alt = await axios.get(
                `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=en|ru`,
                { timeout: 5000 }
            )

            if (alt.data && alt.data.responseData) {
                const translated = alt.data.responseData.translatedText
                console.log("Fallback translation success:", translated)
                return res.json({ text: cleaned, translated })
            } else {
                throw new Error("Invalid fallback response")
            }

        } catch (fallbackError) {
            console.log("Fallback API Error:", fallbackError.message)

            // Если всё упало, возвращаем заглушку
            return res.status(502).json({
                error: "translate_failed",
                hint: "All translation services unavailable",
                fallback: `[${cleaned}]`
            })
        }
    }
})

// ===== LEARN =====

app.get("/learn", (req, res) => {
    res.render("learn")
})


// ===== GUESS =====

app.get("/guess", (req, res) => {
    const level = req.query.level || "A";
    let currentArray
    if(level === "A") {
        currentArray = wordPairs
    }else if (level === "B") {
        currentArray = wordPairs2
    }else if (level === "C") {
        currentArray = wordPairs3
    }
    const pair = currentArray[Math.floor(Math.random() * currentArray.length)]
    res.render("guess", {
        word: pair.en,
        translation: pair.ru,
        translation2: pair.ru2 || ""
    })
})

// ===== WORDLE =====

let shuffled = [];
let index = 0;

function shuffle(array) {
    return array.sort(() => Math.random() - 0.5);
}

app.get("/wordle", (req, res) => {
    const level = req.query.level || "A";
    let currentArray
    if(level === "A") {
        currentArray = wordPairs
    }else if (level === "B") {
        currentArray = wordPairs2
    }else{
        currentArray = wordPairs3
    }
    const pair = currentArray[Math.floor(Math.random() * currentArray.length)]

    res.render("wordle", { word: pair.en, translation: pair.ru, translation2: pair.ru2 });
});

// ===== BUILDER =====

app.get("/builder", (req, res) => {
    const level = req.query.level || "A";
    let currentArray
    if(level === "A") {
        currentArray = wordPairs
    }else if (level === "B") {
        currentArray = wordPairs2
    }else{
        currentArray = wordPairs3
    }
    const pair = currentArray[Math.floor(Math.random() * currentArray.length)]
    res.render("builder", { word: pair.en })
})
// ===== START =====
console.log("Server starting...")
const PORT = parsePort(process.env.PORT)
const HOST = process.env.HOST || "0.0.0.0"

const server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running at http://${HOST}:${PORT}`)
})

server.on("error", error => {
    console.error("Server failed to start:", error.message)
    process.exit(1)
})
