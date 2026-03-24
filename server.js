const express = require("express")
const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const app = express()

app.set("view engine", "ejs")
app.use(express.static("public"))
app.use(express.json())

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
]

// ===== ROUTES =====

app.get("/", (req, res) => {
    res.render("index")
})

// ===== READER =====

app.get("/reader", (req, res) => {
    res.render("reader", { books: BOOKS })
})

app.get("/api/books", (req, res) => {
    res.json(BOOKS.map(b => ({
        id: b.id,
        title: b.title,
        author: b.author
    })))
})

app.get("/api/books/:id", async (req, res) => {
    const book = BOOKS.find(b => b.id === req.params.id)
    if (!book) return res.status(404).json({ error: "book_not_found" })

    try {
        const text = fs.readFileSync(book.file, "utf8")
        res.json({ ...book, text })
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

app.get("/learn", async (req, res) => {
    const word = words[Math.floor(Math.random() * words.length)]

    try {
        const dictionary = await axios.get(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`,
            { timeout: 5000 }
        )

        res.render("learn", { data: dictionary.data[0] })
    } catch {
        res.render("learn", { data: { word, meanings: [{ definitions: [{ definition: "No definition" }] }] } })
    }
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
    const word = words[Math.floor(Math.random() * words.length)]
    res.render("builder", { word })
})

// ===== START =====
console.log("Server starting...")
app.listen(3000, () => {
    console.log("🚀 Server running: http://localhost:3000")
})