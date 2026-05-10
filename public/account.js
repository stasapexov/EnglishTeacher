function getAuthToken() {
    return localStorage.getItem("englishTrainer_token") || ""
}

function authHeaders(extra = {}) {
    const token = getAuthToken()
    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extra
    }
}

async function apiJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: authHeaders(options.headers || {})
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || data.error || "Ошибка запроса")
    return data
}

function requireLogin(container = document.body) {
    if (!getAuthToken()) {
        container.innerHTML = `
            <div class="app-card empty-state">
                <h2>🔐 Нужно войти</h2>
                <p>Войдите или зарегистрируйтесь на главной странице, чтобы открыть личные функции.</p>
                <a class="app-btn" href="/#authSection">На главную</a>
            </div>
        `
        return false
    }
    return true
}

function formatDate(value) {
    if (!value) return "—"
    return new Date(value).toLocaleDateString("ru-RU")
}
