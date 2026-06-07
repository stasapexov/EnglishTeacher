const trialBook = document.getElementById("trialBook")
const trialAnswer = document.getElementById("trialAnswer")
const trialSpeak = document.getElementById("trialSpeak")
const trialEvaluate = document.getElementById("trialEvaluate")
const trialStatus = document.getElementById("trialStatus")
const trialResult = document.getElementById("trialResult")
const trialScore = document.getElementById("trialScore")
const resultPercent = document.getElementById("resultPercent")
const contentScore = document.getElementById("contentScore")
const englishScore = document.getElementById("englishScore")
const barContent = document.getElementById("barContent")
const barEnglish = document.getElementById("barEnglish")
const strongPoints = document.getElementById("strongPoints")
const missedPoints = document.getElementById("missedPoints")
const wrongClaims = document.getElementById("wrongClaims")
const feedbackRu = document.getElementById("feedbackRu")
const correctedAnswer = document.getElementById("correctedAnswer")
const providerInfo = document.getElementById("providerInfo")

const question = "What was this book about? Answer in English."

function setStatus(text) {
    trialStatus.textContent = text
}

function renderList(el, items, emptyText) {
    const safeItems = Array.isArray(items) && items.length ? items : [emptyText]
    el.innerHTML = safeItems.map(item => `<li>${escapeHtml(String(item))}</li>`).join("")
}

function escapeHtml(text) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
}

function setBar(el, value) {
    el.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`
}

function renderResult(data) {
    const match = Math.max(0, Math.min(100, Number(data.matchPercent) || 0))
    const content = Math.max(0, Math.min(100, Number(data.contentScore) || match))
    const english = Math.max(0, Math.min(100, Number(data.englishScore) || 0))

    trialResult.hidden = false
    trialScore.textContent = `${match}%`
    resultPercent.textContent = `${match}%`
    contentScore.textContent = `${content}%`
    englishScore.textContent = `${english}%`
    setBar(barContent, content)
    setBar(barEnglish, english)

    renderList(strongPoints, data.strongPoints, "Answer submitted and checked.")
    renderList(missedPoints, data.missedKeyPoints, "No major missing points found.")
    renderList(wrongClaims, data.wrongClaims, "No obvious wrong facts found.")

    feedbackRu.textContent = data.feedbackRu || "Ответ проверен. Попробуй сделать пересказ подробнее."
    correctedAnswer.textContent = data.correctedAnswerEn || trialAnswer.value.trim()
    providerInfo.textContent = `Provider: ${data.provider || "unknown"}${data.fallbackReason ? ` · ${data.fallbackReason}` : ""}`
    trialResult.scrollIntoView({ behavior: "smooth", block: "start" })
}

function startVoiceAnswer() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
        setStatus("Ваш браузер не поддерживает SpeechRecognition. Можно ввести ответ вручную.")
        return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = "en-US"
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => setStatus("Listening... Speak in English.")
    recognition.onerror = () => setStatus("Не удалось распознать речь. Попробуйте ещё раз или напечатайте ответ.")
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript
        trialAnswer.value = transcript
        setStatus("Речь распознана. Теперь можно отправить ответ на AI-проверку.")
    }
    recognition.onend = () => {
        if (!trialAnswer.value.trim()) setStatus("Запись остановлена. Ответ не распознан.")
    }

    recognition.start()
}

async function evaluateAnswer() {
    const userAnswer = trialAnswer.value.trim()
    if (userAnswer.length < 8) {
        setStatus("Ответ слишком короткий. Скажи хотя бы 1–2 предложения о книге.")
        return
    }

    trialEvaluate.disabled = true
    setStatus("AI проверяет, насколько пересказ соответствует книге...")

    try {
        const headers = { "Content-Type": "application/json" }
        const token = typeof getAuthToken === "function" ? getAuthToken() : ""
        if (token) headers.Authorization = `Bearer ${token}`

        const response = await fetch("/api/book-trial/evaluate", {
            method: "POST",
            headers,
            body: JSON.stringify({ bookId: trialBook.value, question, userAnswer })
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.message || data?.error || "evaluate_failed")
        renderResult(data)
        setStatus("Готово! AI-отчёт построен.")
    } catch (error) {
        setStatus(`Ошибка проверки: ${error.message || error}`)
    } finally {
        trialEvaluate.disabled = false
    }
}

trialSpeak.addEventListener("click", startVoiceAnswer)
trialEvaluate.addEventListener("click", evaluateAnswer)
