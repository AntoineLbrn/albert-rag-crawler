const apiUrl =
  Deno.env.get("ALBERT_API_URL") ??
  "https://albert.api.etalab.gouv.fr";

const apiKey = Deno.env.get("ALBERT_API_KEY");

if (!apiKey) {
  throw new Error("ALBERT_API_KEY est manquante dans .env");
}

const response = await fetch(`${apiUrl}/v1/collections`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "SPHINX – Obsidian",
    description: "Notes Obsidian du projet SPHINX",
    visibility: "private",
  }),
});

const body = await response.text();

if (!response.ok) {
  console.error(body);
  throw new Error(
    `Erreur Albert (${response.status} ${response.statusText})`,
  );
}

const collection = JSON.parse(body);

console.log("Collection créée :");
console.log(JSON.stringify(collection, null, 2));

console.log(`\nCollection ID : ${collection.id}`);