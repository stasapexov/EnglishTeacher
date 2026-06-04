const elText = document.getElementById("readerText")
const elSelect = document.getElementById("bookSelect")
const elStatus = document.getElementById("readerStatus")
const elTitle = document.getElementById("bookTitle")
const elAuthor = document.getElementById("bookAuthor")
const elBookLevel = document.getElementById("bookLevel")
const elLevelSelect = document.getElementById("levelSelect")
const elBookGrid = document.getElementById("bookGrid")

const popup = document.getElementById("translatePopup")
const popupWord = document.getElementById("popupWord")
const popupResult = document.getElementById("popupResult")
const popupClose = document.getElementById("popupClose")
const popupSpeak = document.getElementById("popupSpeak")
const popupSave = document.getElementById("popupSave")

const CACHE_KEY = "reader_translate_cache_v1"
const cache = loadCache()

let currentWord = ""
let currentTranslation = ""
let currentBookId = elSelect.value
let progressTimer = null

function getReaderToken() {
    return localStorage.getItem("englishTrainer_token") || ""
}

function loadCache() {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}")
    } catch {
        return {}
    }
}

function saveCache() {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch {
        // ignore quota errors
    }
}

function setStatus(text) {
    elStatus.textContent = text || ""
}

function escapeHtml(s) {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;")
}

function tokenize(text) {
    // Keep whitespace + punctuation; make words clickable
    // Word: letters with optional apostrophes/hyphens inside.
    return text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*|[\s]+|[^\sA-Za-z]+/g) || []
}

function renderText(text) {
    const parts = tokenize(text)
    const html = parts
        .map((p) => {
            if (/^[A-Za-z]/.test(p)) {
                const w = p
                return `<button class="word" data-word="${escapeHtml(w)}" type="button">${escapeHtml(w)}</button>`
            }
            return `<span>${escapeHtml(p)}</span>`
        })
        .join("")
    elText.innerHTML = html
}
async function loadBook(id) {
    setStatus("Loading…")
    elText.innerHTML = ""
    closePopup()

    const r = await fetch(`/api/books/${encodeURIComponent(id)}`)
    if (!r.ok) {
        setStatus("Failed to load book")
        return
    }
    const data = await r.json()
    currentBookId = id
    elTitle.textContent = data.title
    elAuthor.textContent = data.author
    elBookLevel.textContent = `${data.level} · ${data.levelLabel}`
    setActiveBook(id)
    renderText(data.text)
    setStatus("Click a word to translate")
    restoreScroll(id)
}

function positionPopupNear(target) {
    const rect = target.getBoundingClientRect()
    const margin = 12
    const top = Math.min(window.innerHeight - popup.offsetHeight - margin, rect.bottom + 8)
    const left = Math.min(window.innerWidth - popup.offsetWidth - margin, rect.left)
    popup.style.top = `${Math.max(margin, top) + window.scrollY}px`
    popup.style.left = `${Math.max(margin, left) + window.scrollX}px`
}

function openPopup(word, target) {
    currentWord = word
    currentTranslation = ""
    popupWord.textContent = word
    popupResult.textContent = "Translating…"
    popup.setAttribute("aria-hidden", "false")
    popup.classList.add("open")
    positionPopupNear(target)
}

function closePopup() {
    currentWord = ""
    popup.setAttribute("aria-hidden", "true")
    popup.classList.remove("open")
}

async function translate(word) {
    const key = word.toLowerCase()
    if (cache[key]) return cache[key]

    const r = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: word, from: "en", to: "ru" }),
    })

    const data = await r.json().catch(() => null)

    if (!r.ok) {
        const hint = data?.hint ? ` (${data.hint})` : ""
        throw new Error((data?.error || "translate_failed") + hint)
    }

    cache[key] = data.translated
    saveCache()
    return data.translated
}

function speak(word) {
    if (!("speechSynthesis" in window)) return
    const u = new SpeechSynthesisUtterance(word)
    u.lang = "en-US"
    window.speechSynthesis.speak(u)
}

elText.addEventListener("click", async (e) => {
    const btn = e.target.closest(".word")
    if (!btn) return

    const word = btn.dataset.word || ""
    if (!word) return

    openPopup(word, btn)
    try {
        const t = await translate(word)
        // If user clicked another word while we were loading
        if (currentWord !== word) return
        currentTranslation = t
        popupResult.textContent = t
    } catch (err) {
        if (currentWord !== word) return
        popupResult.textContent = String(err?.message || err || "Translate failed")
    }
})

popupClose.addEventListener("click", () => closePopup())
popupSpeak.addEventListener("click", () => {
    if (currentWord) speak(currentWord)
})

popupSave.addEventListener("click", async () => {
    if (!currentWord) return
    const token = getReaderToken()
    if (!token) {
        popupResult.textContent = "Войдите в аккаунт, чтобы сохранять слова"
        return
    }

    try {
        const r = await fetch("/api/dictionary", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ word: currentWord, translation: currentTranslation })
        })
        if (!r.ok) throw new Error("save_failed")
        popupResult.textContent = `${currentTranslation || currentWord} · сохранено в словарь`
    } catch {
        popupResult.textContent = "Не удалось сохранить слово"
    }
})

function progressKey(bookId) {
    return `reader_progress_${bookId}`
}

function restoreScroll(bookId) {
    const saved = Number(localStorage.getItem(progressKey(bookId)) || 0)
    if (saved > 0) setTimeout(() => window.scrollTo({ top: saved, behavior: "smooth" }), 100)
}

function saveReadingProgress() {
    const scrollY = window.scrollY
    localStorage.setItem(progressKey(currentBookId), String(scrollY))
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    const percent = Math.round(Math.min(100, (scrollY / maxScroll) * 100))
    const token = getReaderToken()
    if (!token) return
    clearTimeout(progressTimer)
    progressTimer = setTimeout(() => {
        fetch("/api/reading-progress", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ bookId: currentBookId, percent, scrollY, xp: percent >= 10 ? 1 : 0 })
        }).catch(() => {})
    }, 700)
}

window.addEventListener("scroll", () => {
    // Keep popup stable enough; close to avoid weird positions
    if (popup.classList.contains("open")) closePopup()
    saveReadingProgress()
})

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePopup()
})

function setActiveBook(bookId) {
    document.querySelectorAll(".book-tile").forEach((tile) => {
        tile.classList.toggle("active", tile.dataset.bookId === bookId)
    })
    if (elSelect.value !== bookId) elSelect.value = bookId
}

function getVisibleBookOptions(level) {
    return Array.from(elSelect.options).filter((option) => level === "all" || option.dataset.level === level)
}

function applyLevelFilter() {
    const selectedLevel = elLevelSelect.value
    const visibleOptions = getVisibleBookOptions(selectedLevel)

    Array.from(elSelect.options).forEach((option) => {
        option.hidden = selectedLevel !== "all" && option.dataset.level !== selectedLevel
    })

    document.querySelectorAll(".book-tile").forEach((tile) => {
        tile.hidden = selectedLevel !== "all" && tile.dataset.level !== selectedLevel
    })

    const currentOption = elSelect.selectedOptions[0]
    if (visibleOptions.length && (selectedLevel !== "all" && currentOption?.dataset.level !== selectedLevel)) {
        loadBook(visibleOptions[0].value)
    }
}

elSelect.addEventListener("change", () => loadBook(elSelect.value))

elLevelSelect.addEventListener("change", () => applyLevelFilter())

elBookGrid.addEventListener("click", (e) => {
    const tile = e.target.closest(".book-tile")
    if (!tile) return

    const { bookId, level } = tile.dataset
    if (elLevelSelect.value !== "all" && elLevelSelect.value !== level) {
        elLevelSelect.value = level
        applyLevelFilter()
    }
    loadBook(bookId)
})

// initial load
loadBook(elSelect.value)

