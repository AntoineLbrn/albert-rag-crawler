# albert-rag-crawler
Plug your local notes to Albert through RAG

# setup

1. bash create-collection.sh
2. Put resulting collection id in .env file
3. run this command
```
deno run \
  --allow-read \
  --allow-net \
  --allow-env \
  --env-file=.env \
  sync.ts```

4. run this command

``` deno run --allow-net --allow-env --env-file=.env server.ts ```