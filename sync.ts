import { createHash } from "node:crypto";
import {
  extname,
  join,
  relative,
} from "jsr:@std/path";

const API_URL =
  Deno.env.get("ALBERT_API_URL") ??
  "https://albert.api.etalab.gouv.fr";

const API_KEY = Deno.env.get("ALBERT_API_KEY");
const COLLECTION_ID = Deno.env.get("ALBERT_COLLECTION_ID");
const VAULT_PATH = Deno.env.get("PATH_TO_NOTES");

if (!API_KEY) {
  throw new Error("ALBERT_API_KEY est manquante dans .env");
}

if (!COLLECTION_ID) {
  throw new Error("ALBERT_COLLECTION_ID est manquante dans .env");
}

if (!VAULT_PATH) {
  throw new Error("PATH_TO_NOTES est manquante dans .env");
}

const collectionId = Number(COLLECTION_ID);

if (!Number.isInteger(collectionId)) {
  throw new Error(
    "ALBERT_COLLECTION_ID doit être un nombre entier",
  );
}

const STATE_FILE = ".albert-sync.json";

type SyncedFile = {
  hash: string;
  documentId: number;
  syncedAt: string;
};

type SyncState = {
  files: Record<string, SyncedFile>;
};

const headers = {
  Authorization: `Bearer ${API_KEY}`,
};

/**
 * Charge l'état local de synchronisation.
 */
async function loadState(): Promise<SyncState> {
  try {
    const text = await Deno.readTextFile(STATE_FILE);
    return JSON.parse(text);
  } catch {
    return {
      files: {},
    };
  }
}

/**
 * Sauvegarde l'état local.
 */
async function saveState(state: SyncState) {
  await Deno.writeTextFile(
    STATE_FILE,
    JSON.stringify(state, null, 2),
  );
}

/**
 * Calcule le SHA-256 d'un fichier.
 */
async function hashFile(path: string): Promise<string> {
  const data = await Deno.readFile(path);

  return createHash("sha256")
    .update(data)
    .digest("hex");
}

/**
 * Parcourt récursivement le vault et récupère
 * tous les fichiers Markdown.
 */
async function collectMarkdownFiles(
  directory: string,
): Promise<string[]> {
  const files: string[] = [];

  for await (const entry of Deno.readDir(directory)) {
    // On ignore les fichiers/dossiers techniques.
    if (entry.name === ".obsidian") {
      continue;
    }

    if (entry.name === STATE_FILE) {
      continue;
    }

    const path = join(directory, entry.name);

    if (entry.isDirectory) {
      files.push(
        ...(await collectMarkdownFiles(path)),
      );
    } else if (
      entry.isFile &&
      extname(entry.name).toLowerCase() === ".md"
    ) {
      files.push(path);
    }
  }

  return files;
}

/**
 * Envoie un fichier à Albert.
 */
async function createDocument(
  absolutePath: string,
  relativePath: string,
): Promise<number> {
  const content = await Deno.readFile(absolutePath);

  const filename =
    relativePath.split("/").pop() ?? "note.md";

  const form = new FormData();

  form.append(
    "file",
    new File(
      [content],
      filename,
      {
        type: "text/markdown",
      },
    ),
  );

  form.append(
    "collection_id",
    String(collectionId),
  );

  form.append(
    "preset_separators",
    "markdown",
  );

  form.append(
    "chunk_size",
    "2048",
  );

  form.append(
    "chunk_overlap",
    "200",
  );

  form.append(
    "metadata",
    JSON.stringify({
      source: "obsidian",
      path: relativePath,
      vault: VAULT_PATH,
    }),
  );

  const response = await fetch(
    `${API_URL}/v1/documents`,
    {
      method: "POST",
      headers,
      body: form,
    },
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Création document Albert ${response.status}: ${body}`,
    );
  }

  const document = JSON.parse(body);

  if (!document.id) {
    throw new Error(
      `Albert n'a pas retourné d'identifiant de document : ${body}`,
    );
  }

  return Number(document.id);
}

/**
 * Supprime un document Albert.
 */
async function deleteDocument(
  documentId: number,
) {
  const response = await fetch(
    `${API_URL}/v1/documents/${documentId}`,
    {
      method: "DELETE",
      headers,
    },
  );

  if (
    !response.ok &&
    response.status !== 404
  ) {
    const body = await response.text();

    throw new Error(
      `Suppression document Albert ${response.status}: ${body}`,
    );
  }
}

/**
 * Récupère tous les documents de notre collection.
 *
 * On ne dépend pas uniquement du fichier .albert-sync.json :
 * cela permet de reconstruire la synchronisation si le fichier
 * local est perdu.
 */
async function getAlbertDocuments() {
  const documents: any[] = [];

  let offset = 0;
  const limit = 100;

  while (true) {
    const url = new URL(
      `${API_URL}/v1/documents`,
    );

    url.searchParams.set(
      "collection_id",
      String(collectionId),
    );

    url.searchParams.set(
      "limit",
      String(limit),
    );

    url.searchParams.set(
      "offset",
      String(offset),
    );

    const response = await fetch(
      url,
      {
        headers,
      },
    );

    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `Lecture documents Albert ${response.status}: ${body}`,
      );
    }

    const result = JSON.parse(body);

    const items =
      result.items ??
      result.documents ??
      [];

    documents.push(...items);

    if (items.length < limit) {
      break;
    }

    offset += limit;
  }

  return documents;
}

/**
 * Essaie de retrouver le document Albert correspondant
 * à un chemin Obsidian.
 */
function findAlbertDocument(
  documents: any[],
  relativePath: string,
) {
  return documents.find((document) => {
    const metadata =
      document.metadata ??
      document.meta ??
      {};

    return (
      metadata.path === relativePath ||
      metadata.source_path === relativePath
    );
  });
}

/**
 * Synchronisation.
 */
const state = await loadState();

console.log(
  `Vault : ${VAULT_PATH}`,
);

console.log(
  `Collection Albert : ${collectionId}`,
);

console.log("");

const files =
  await collectMarkdownFiles(VAULT_PATH);

console.log(
  `${files.length} notes Markdown trouvées.`,
);

console.log("");

/*
 * On récupère également l'état réel d'Albert.
 */
console.log(
  "Lecture des documents présents dans Albert...",
);

const albertDocuments =
  await getAlbertDocuments();

console.log(
  `${albertDocuments.length} documents présents dans Albert.`,
);

console.log("");

const currentPaths =
  new Set<string>();

let added = 0;
let updated = 0;
let unchanged = 0;
let deleted = 0;
let errors = 0;

/*
 * 1. Synchronisation des fichiers présents localement.
 */
for (const absolutePath of files) {
  const relativePath =
    relative(
      VAULT_PATH,
      absolutePath,
    ).replaceAll("\\", "/");

  currentPaths.add(relativePath);

  const hash =
    await hashFile(absolutePath);

  const previous =
    state.files[relativePath];

  /*
   * Si le hash est identique, rien à faire.
   */
  if (previous?.hash === hash) {
    unchanged++;
    continue;
  }

  /*
   * On essaie d'abord de retrouver le document Albert
   * à partir du chemin stocké dans ses métadonnées.
   */
  const existingDocument =
    findAlbertDocument(
      albertDocuments,
      relativePath,
    );

  const oldDocumentId =
    previous?.documentId ??
    existingDocument?.id;

  try {
    /*
     * NOTE NOUVELLE OU MODIFIÉE
     */
    if (oldDocumentId) {
      console.log(
        `↻ Modification : ${relativePath}`,
      );

      console.log(
        `  suppression document Albert #${oldDocumentId}`,
      );

      await deleteDocument(
        Number(oldDocumentId),
      );

      /*
       * Important :
       * on supprime d'abord l'ancien document,
       * puis on crée la nouvelle version.
       */
    } else {
      console.log(
        `+ Nouveau : ${relativePath}`,
      );
    }

    const newDocumentId =
      await createDocument(
        absolutePath,
        relativePath,
      );

    state.files[relativePath] = {
      hash,
      documentId: newDocumentId,
      syncedAt:
        new Date().toISOString(),
    };

    await saveState(state);

    if (oldDocumentId) {
      updated++;
    } else {
      added++;
    }
  } catch (error) {
    errors++;

    console.error(
      `  ✗ Échec : ${relativePath}`,
    );

    console.error(error);
  }
}

/*
 * 2. Détection des fichiers supprimés localement.
 *
 * On regarde les chemins connus dans notre état local.
 */
for (const [
  relativePath,
  fileState,
] of Object.entries(state.files)) {
  if (currentPaths.has(relativePath)) {
    continue;
  }

  console.log(
    `- Suppression : ${relativePath}`,
  );

  try {
    await deleteDocument(
      fileState.documentId,
    );

    delete state.files[relativePath];

    deleted++;

    await saveState(state);
  } catch (error) {
    errors++;

    console.error(
      `  ✗ Impossible de supprimer ${relativePath}`,
    );

    console.error(error);
  }
}

await saveState(state);

console.log("");
console.log("==============================");
console.log("Synchronisation terminée");
console.log("==============================");
console.log(
  `  Nouvelles    : ${added}`,
);
console.log(
  `  Modifiées    : ${updated}`,
);
console.log(
  `  Inchangées   : ${unchanged}`,
);
console.log(
  `  Supprimées   : ${deleted}`,
);
console.log(
  `  Erreurs      : ${errors}`,
);
