const API_URL = Deno.env.get("ALBERT_API_URL") ??
    "https://albert.api.etalab.gouv.fr";

const API_KEY = Deno.env.get("ALBERT_API_KEY");
const COLLECTION_ID = Deno.env.get("ALBERT_COLLECTION_ID");

const PORT = Number(
    Deno.env.get("PORT") ?? "8000",
);

if (!API_KEY) {
    throw new Error(
        "ALBERT_API_KEY est manquante dans .env",
    );
}

if (!COLLECTION_ID) {
    throw new Error(
        "ALBERT_COLLECTION_ID est manquante dans .env",
    );
}

const collectionId = Number(COLLECTION_ID);

if (!Number.isInteger(collectionId)) {
    throw new Error(
        "ALBERT_COLLECTION_ID doit être un nombre entier",
    );
}

const albertHeaders = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
};

/**
 * Recherche RAG dans notre collection.
 */
async function searchAlbert(query: string) {
    const response = await fetch(
        `${API_URL}/v1/search`,
        {
            method: "POST",
            headers: albertHeaders,
            body: JSON.stringify({
                collection_ids: [collectionId],
                query,
                method: "hybrid",
                limit: 3,
            }),
        },
    );

    const body = await response.text();

    if (!response.ok) {
        throw new Error(
            `Albert search ${response.status}: ${body}`,
        );
    }

    return JSON.parse(body);
}

/**
 * Chat completion Albert.
 */
async function chatAlbert(
    messages: Array<{
        role: string;
        content: string;
    }>,
) {
    const response = await fetch(
        `${API_URL}/v1/chat/completions`,
        {
            method: "POST",
            headers: albertHeaders,
            body: JSON.stringify({
                model: Deno.env.get("ALBERT_MODEL"),
                messages,
                temperature: 0.2,

                // Important
                //stream: true,

                // Pour éviter les générations interminables
                max_completion_tokens: 1000,
            }),
        },
    );

    const body = await response.text();

    console.log(body)
    
    if (!response.ok) {
        throw new Error(
            `Albert chat ${response.status}: ${body}`,
        );
    }

    return JSON.parse(body);
}

/**
 * Transforme les résultats Albert en contexte lisible
 * pour le modèle.
 */
function buildContext(searchResult: any) {
    return searchResult.data
        .map((result: any, index: number) => {
            const metadata = result.chunk.metadata ??
                {};

            const path = metadata.path ??
                metadata.source_path ??
                result.filename ??
                "source inconnue";

            const content = result.chunk.content ??
                "";

            return `
[Source ${index + 1}]
Fichier : ${path}

${content}
`;
        })
        .join("\n--------------------\n");
}

/**
 * Extrait les sources pour l'interface.
 */
function extractSources(searchResult: any) {
    const results = searchResult.data ??
        [];

    return results.map((result: any) => {
        const metadata = result.metadata ??
            result.meta ??
            {};

        return {
            path: metadata.path ??
                metadata.source_path ??
                result.filename ??
                "Source inconnue",

            score: result.score ??
                result.similarity ??
                null,
        };
    });
}

/**
 * HTML de l'application.
 */
function html() {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>SPHINX · Albert</title>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">

<style>
:root {
  color-scheme: dark;
  --bg: #05080d;
  --surface: #0b1628;
  --surface-raised: #101d30;
  --line: rgba(167, 190, 220, .14);
  --text: #f4f4f0;
  --muted: #9ba9ba;
  --blue: #4c9aff;
  --red: #ff5148;
  --user: #10233a;
}

* { box-sizing: border-box; }

body {
  min-width: 320px;
  height: 100vh;
  height: 100dvh;
  margin: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text);
  font-family: "DM Sans", "Noto Sans JP", sans-serif;
  background:
    radial-gradient(ellipse at 16% 0%, rgba(22, 77, 133, .2), transparent 38%),
    radial-gradient(ellipse at 78% 100%, rgba(139, 31, 46, .09), transparent 36%),
    linear-gradient(rgba(127, 159, 198, .025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(127, 159, 198, .025) 1px, transparent 1px),
    var(--bg);
  background-size: auto, auto, 48px 48px, 48px 48px, auto;
}

header {
  height: 68px;
  flex: 0 0 68px;
  display: flex;
  align-items: center;
  padding: 0 32px;
  border-bottom: 1px solid var(--line);
  background: rgba(5, 8, 13, .82);
  backdrop-filter: blur(18px);
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: "Space Grotesk", "DM Sans", sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: .04em;
}

.logo-mark {
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(76, 154, 255, .56);
  color: var(--blue);
  font-size: 12px;
}

.logo span { color: var(--red); }

.header-meta {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}

.status-light {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #61d5a5;
  box-shadow: 0 0 12px rgba(97, 213, 165, .55);
}

main { flex: 1; display: flex; min-height: 0; }

.chat {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 54px 32px 150px;
  scrollbar-color: #34465d transparent;
}

.message {
  max-width: 880px;
  margin: 0 auto 20px;
  display: flex;
  animation: arrive .28s ease-out both;
}

.message-inner {
  width: 100%;
  padding: 18px 21px;
  border: 1px solid var(--line);
  border-radius: 4px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: rgba(11, 22, 40, .82);
}

.user .message-inner {
  border-left: 2px solid var(--blue);
  background: rgba(16, 35, 58, .88);
}

.assistant .message-inner { border-left: 2px solid var(--red); }

.role {
  margin-bottom: 8px;
  color: var(--muted);
  font-family: "Space Grotesk", "DM Sans", sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.composer {
  position: fixed;
  right: 300px;
  bottom: 0;
  left: 0;
  z-index: 2;
  padding: 24px 32px 25px;
  background: linear-gradient(transparent, rgba(5, 8, 13, .96) 30%);
}

.composer-inner {
  max-width: 880px;
  margin: auto;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 8px 8px 8px 14px;
  border: 1px solid rgba(143, 170, 205, .25);
  border-radius: 5px;
  background: rgba(11, 22, 40, .94);
  box-shadow: 0 18px 55px rgba(0, 0, 0, .42), 0 0 28px rgba(22, 119, 255, .06);
  transition: border-color .18s ease, box-shadow .18s ease;
}

.composer-inner:focus-within {
  border-color: rgba(76, 154, 255, .68);
  box-shadow: 0 18px 55px rgba(0, 0, 0, .42), 0 0 24px rgba(22, 119, 255, .13);
}

textarea {
  flex: 1;
  min-width: 0;
  min-height: 46px;
  max-height: 180px;
  resize: none;
  padding: 11px 4px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}

textarea::placeholder { color: #78889d; }

button {
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: var(--red);
  color: #170b0d;
  font: 700 13px "DM Sans", sans-serif;
  cursor: pointer;
  transition: background .18s ease, box-shadow .18s ease, transform .18s ease;
}

button:hover:not(:disabled) {
  background: #ff7168;
  box-shadow: 0 0 20px rgba(255, 81, 72, .22);
}

button:active:not(:disabled) { transform: translateY(1px); }

button:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 3px;
}

button:disabled { opacity: .55; cursor: wait; }

.sidebar {
  width: 300px;
  flex: 0 0 300px;
  padding: 27px 20px;
  overflow-y: auto;
  border-left: 1px solid var(--line);
  background: rgba(7, 17, 31, .78);
}

.sidebar h3 {
  margin: 0 0 13px;
  color: #a9b7c8;
  font-family: "Space Grotesk", "DM Sans", sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.mode { display: flex; gap: 7px; margin-bottom: 31px; }

.mode button {
  min-height: 36px;
  flex: 1;
  padding: 0 10px;
  border-color: var(--line);
  background: rgba(16, 29, 48, .72);
  color: var(--muted);
  font-size: 11px;
}

.mode button:hover:not(:disabled) { color: var(--text); }

.mode button.active {
  border-color: rgba(76, 154, 255, .55);
  background: rgba(22, 119, 255, .14);
  color: #b9d8ff;
  box-shadow: inset 0 -2px var(--blue);
}

.source {
  padding: 12px 11px;
  margin-bottom: 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: rgba(11, 22, 40, .7);
  font-size: 12px;
  transition: border-color .18s ease, background .18s ease;
}

.source:hover { border-color: rgba(76, 154, 255, .42); background: var(--surface); }
.source-path { overflow-wrap: anywhere; line-height: 1.5; }
.score { margin-top: 7px; color: #8495aa; font-size: 10px; }

.empty {
  position: relative;
  max-width: 880px;
  margin: clamp(56px, 15vh, 150px) auto 0;
  padding: 8px 0 30px 25px;
  border-left: 1px solid rgba(255, 81, 72, .62);
  animation: arrive .55s ease-out both;
}

.empty::before {
  position: absolute;
  top: 0;
  left: -3px;
  width: 5px;
  height: 32px;
  background: var(--red);
  box-shadow: 0 0 16px rgba(255, 81, 72, .38);
  content: "";
}

.empty-kicker {
  margin: 0 0 17px;
  color: #80b9ff;
  font: 600 10px "Space Grotesk", sans-serif;
  letter-spacing: .16em;
  text-transform: uppercase;
}

.empty h1 {
  max-width: 620px;
  margin: 0;
  color: var(--text);
  font: 500 clamp(32px, 4vw, 48px)/1.12 "Space Grotesk", "Noto Sans JP", sans-serif;
}

.empty p {
  max-width: 500px;
  margin: 18px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.8;
}

@keyframes arrive {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 800px) {
  header { height: 60px; flex-basis: 60px; padding: 0 18px; }
  main { flex-direction: column; }
  .sidebar {
    order: -1;
    width: 100%;
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr);
    gap: 8px 12px;
    padding: 10px 18px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
    overflow: visible;
  }
  .sidebar h3 { align-self: center; margin: 0; }
  .mode { margin: 0; }
  .sidebar h3:nth-of-type(2), #sources { grid-column: 1 / -1; }
  .sidebar h3:nth-of-type(2) { display: none; }
  #sources {
    display: flex;
    gap: 8px;
    min-width: 0;
    overflow-x: auto;
  }
  #sources > p { margin: 0; align-self: center; }
  .source { min-width: 180px; max-width: 58vw; margin: 0; }
  .chat { min-height: 0; }
  .messages { padding: 34px 20px 130px; }
  .composer { right: 0; padding: 18px 16px 18px; }
  .empty { margin-top: clamp(35px, 10vh, 90px); }
}

@media (max-width: 480px) {
  .header-meta { font-size: 11px; }
  .messages { padding-right: 15px; padding-left: 15px; }
  .empty { padding-left: 18px; }
  .empty h1 { font-size: 34px; }
  .empty p { font-size: 13px; }
  .composer { padding-right: 10px; padding-left: 10px; }
  .composer-inner { gap: 6px; padding-left: 9px; }
  .composer-inner button { padding: 0 12px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
</style>
</head>

<body>

<header>

  <div class="logo">
    <span class="logo-mark" aria-hidden="true">S</span>
    <div>SPHINX <span>·</span> Albert</div>
  </div>

  <div class="header-meta">
    <span class="status-light" aria-hidden="true"></span>
    Mémoire documentaire
  </div>

</header>

<main>

  <section class="chat">

    <div id="messages" class="messages">

      <div class="empty" id="empty">

        <p class="empty-kicker">SPHINX / MÉMOIRE DOCUMENTAIRE</p>
        <h1>Interroger ma mémoire</h1>

        <p>
          Pose une question sur tes notes Obsidian.
          Albert cherchera dans la collection SPHINX.
        </p>

      </div>

    </div>

    <div class="composer">

      <div class="composer-inner">

        <textarea
          id="input"
          placeholder="Pose une question à tes notes…"
          rows="1"
        ></textarea>

        <button id="send">
          Envoyer
        </button>

      </div>

    </div>

  </section>

  <aside class="sidebar">

    <h3>Mode</h3>

    <div class="mode">

      <button
        id="mode-rag"
        class="active"
        onclick="setMode('rag')"
      >
        RAG
      </button>

      <button
        id="mode-tool"
        onclick="setMode('tool')"
      >
        Tool
      </button>

    </div>

    <h3>Sources</h3>

    <div id="sources">
      <p style="color:var(--muted);font-size:13px">
        Les sources utilisées apparaîtront ici.
      </p>
    </div>

  </aside>

</main>

<script>

let mode = "rag";

const input =
  document.getElementById("input");

const send =
  document.getElementById("send");

const messages =
  document.getElementById("messages");

const empty =
  document.getElementById("empty");

const sources =
  document.getElementById("sources");

function setMode(value) {

  mode = value;

  document
    .getElementById("mode-rag")
    .classList.toggle(
      "active",
      value === "rag"
    );

  document
    .getElementById("mode-tool")
    .classList.toggle(
      "active",
      value === "tool"
    );
}

function addMessage(role, content) {

  if (empty) {
    empty.style.display = "none";
  }

  const wrapper =
    document.createElement("div");

  wrapper.className =
    "message " + role;

  const inner =
    document.createElement("div");

  inner.className =
    "message-inner";

  const label =
    document.createElement("div");

  label.className =
    "role";

  label.textContent =
    role === "user"
      ? "Vous"
      : "Albert";

  const text =
    document.createElement("div");

  text.textContent = content;

  inner.appendChild(label);
  inner.appendChild(text);

  wrapper.appendChild(inner);

  messages.appendChild(wrapper);

  messages.scrollTop =
    messages.scrollHeight;

  return text;
}

function displaySources(items) {

  sources.innerHTML = "";

  if (!items || items.length === 0) {

    sources.innerHTML =
      '<p style="color:var(--muted);font-size:13px">Aucune source.</p>';

    return;
  }

  for (const item of items) {

    const div =
      document.createElement("div");

    div.className = "source";

    const path =
      document.createElement("div");

    path.className =
      "source-path";

    path.textContent =
      item.path;

    div.appendChild(path);

    if (item.score !== null) {

      const score =
        document.createElement("div");

      score.className = "score";

      score.textContent =
        "score : " +
        Number(item.score).toFixed(3);

      div.appendChild(score);
    }

    sources.appendChild(div);
  }
}

async function ask() {

  const question =
    input.value.trim();

  if (!question) {
    return;
  }

  input.value = "";

  addMessage(
    "user",
    question
  );

  send.disabled = true;

  const answerElement =
    addMessage(
      "assistant",
      "Recherche dans mes notes…"
    );

  try {

    const response =
      await fetch(
        "/api/ask",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            question,
            mode
          })
        }
      );

    const result =
      await response.json();

    if (!response.ok) {
      throw new Error(
        result.error ??
        "Erreur serveur"
      );
    }

    answerElement.textContent =
      result.answer;

    displaySources(
      result.sources
    );

  } catch (error) {

    answerElement.textContent =
      "Erreur : " +
      error.message;

  } finally {

    send.disabled = false;

    input.focus();
  }
}

send.addEventListener(
  "click",
  ask
);

input.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      ask();
    }
  }
);

</script>

</body>
</html>`;
}

/**
 * Endpoint principal.
 */
async function handler(
    request: Request,
): Promise<Response> {
    const url = new URL(request.url);

    /*
     * Interface
     */
    if (
        request.method === "GET" &&
        url.pathname === "/"
    ) {
        return new Response(
            html(),
            {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                },
            },
        );
    }

    /*
     * API de question
     */
    if (
        request.method === "POST" &&
        url.pathname === "/api/ask"
    ) {
        try {
            const body = await request.json();

            const question = String(body.question ?? "").trim();

            const mode = body.mode === "tool" ? "tool" : "rag";

            if (!question) {
                return Response.json(
                    {
                        error: "Question vide.",
                    },
                    {
                        status: 400,
                    },
                );
            }

            /*
             * MODE RAG EXPLICITE
             *
             * 1. search
             * 2. construction du contexte
             * 3. chat completion
             */
            if (mode === "rag") {
                const searchResult = await searchAlbert(
                    question,
                );

                const context = buildContext(
                    searchResult,
                );

                const sources = extractSources(
                    searchResult,
                );

                const systemPrompt = `
Tu es l'assistant documentaire du projet SPHINX.

Tu réponds uniquement à partir du contexte documentaire
fourni ci-dessous.

Si le contexte ne permet pas de répondre correctement,
dis-le explicitement.

N'invente jamais une information absente des sources.

Lorsque c'est pertinent, indique le nom du fichier Obsidian
qui permet de retrouver l'information.

Contexte documentaire :

${context}
`;
                const completion = await chatAlbert([
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: question,
                    },
                ]);

                console.log(completion);
                const answer = completion
                    ?.choices?.[0]
                    ?.message?.content ??
                    "Aucune réponse générée.";

                return Response.json({
                    answer,
                    sources,
                });
            }

            /*
             * MODE TOOL
             *
             * Cette version est volontairement laissée
             * derrière une fonction séparée : elle permettra
             * d'utiliser le search tool Albert lorsque tu
             * voudras brancher exactement le schéma de tools
             * exposé par ton endpoint.
             */
            if (mode === "tool") {
                return Response.json(
                    {
                        error:
                            "Le mode search tool doit être configuré avec le schéma de tool de ton accès Albert.",
                    },
                    {
                        status: 501,
                    },
                );
            }
        } catch (error) {
            console.error(error);

            return Response.json(
                {
                    error: error instanceof Error
                        ? error.message
                        : String(error),
                },
                {
                    status: 500,
                },
            );
        }
    }

    return new Response(
        "Not found",
        {
            status: 404,
        },
    );
}

console.log(
    `SPHINX · Albert disponible sur http://localhost:${PORT}`,
);

Deno.serve(
    {
        port: PORT,
    },
    handler,
);
