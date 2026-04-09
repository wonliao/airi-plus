# Mem0 Standalone Runbook

This runbook starts a standalone Mem0 OSS REST API for AIRI short-term memory without using OpenClaw.

## Goal

Expose a local Mem0 server at `http://127.0.0.1:8000` so AIRI can validate short-term memory from:

- `Settings -> Memory -> Short-term Memory`

## Why this runbook exists

The official `mem0/mem0-api-server:latest` image worked as a base, but on April 9, 2026 its built-in `main.py` defaulted to `pgvector + neo4j`, which failed in this environment before the API became ready.

This runbook uses the official image's installed `mem0` package, but swaps in a minimal FastAPI entrypoint that uses:

- local Qdrant path storage
- no graph store
- OpenAI embeddings + LLM
- CORS for AIRI web at `http://127.0.0.1:5173`

## Prerequisites

- Docker Desktop installed and running
- A working OpenAI API key
- AIRI web running at `http://127.0.0.1:5173` if you want browser-based validation

Check Docker:

```bash
docker info
```

## Filesystem layout

This runbook uses temporary local files:

- config root: `/tmp/mem0-oss`
- API entrypoint: `/tmp/mem0-oss/main.py`
- env file: `/tmp/mem0-oss/.env`
- local data: `/tmp/mem0-oss/data`

## 1. Prepare working directory

```bash
mkdir -p /tmp/mem0-oss/data/qdrant
mkdir -p /tmp/mem0-oss/data/history
```

## 2. Create `.env`

Replace the API key before running.

```bash
cat > /tmp/mem0-oss/.env <<'EOF'
OPENAI_API_KEY=your-openai-api-key
QDRANT_PATH=/mem0-data/qdrant
HISTORY_DB_PATH=/mem0-data/history/history.db
COLLECTION_NAME=memories
EMBEDDER_MODEL=text-embedding-3-small
LLM_MODEL=gpt-4.1-mini
EOF

chmod 600 /tmp/mem0-oss/.env
```

## 3. Create standalone API entrypoint

```python
import logging
import os
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from mem0 import Memory

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
load_dotenv('/mem0-custom/.env')

OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
HISTORY_DB_PATH = os.environ.get('HISTORY_DB_PATH', '/mem0-data/history/history.db')
QDRANT_PATH = os.environ.get('QDRANT_PATH', '/mem0-data/qdrant')
COLLECTION_NAME = os.environ.get('COLLECTION_NAME', 'memories')
OPENAI_BASE_URL = os.environ.get('OPENAI_BASE_URL')
EMBEDDER_MODEL = os.environ.get('EMBEDDER_MODEL', 'text-embedding-3-small')
LLM_MODEL = os.environ.get('LLM_MODEL', 'gpt-4.1-mini')

os.makedirs(os.path.dirname(HISTORY_DB_PATH), exist_ok=True)
os.makedirs(QDRANT_PATH, exist_ok=True)

embedder_config = {'api_key': OPENAI_API_KEY, 'model': EMBEDDER_MODEL}
llm_config = {'api_key': OPENAI_API_KEY, 'temperature': 0.2, 'model': LLM_MODEL}
if OPENAI_BASE_URL:
    embedder_config['openai_base_url'] = OPENAI_BASE_URL
    llm_config['openai_base_url'] = OPENAI_BASE_URL

DEFAULT_CONFIG = {
    'version': 'v1.1',
    'vector_store': {
        'provider': 'qdrant',
        'config': {
            'collection_name': COLLECTION_NAME,
            'path': QDRANT_PATH,
            'on_disk': True,
        },
    },
    'llm': {'provider': 'openai', 'config': llm_config},
    'embedder': {'provider': 'openai', 'config': embedder_config},
    'history_db_path': HISTORY_DB_PATH,
}

MEMORY_INSTANCE = Memory.from_config(DEFAULT_CONFIG)
app = FastAPI(
    title='Mem0 REST APIs',
    description='A REST API for managing and searching memories for your AI Agents and Apps.',
    version='1.0.0',
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        'http://127.0.0.1:5173',
        'http://localhost:5173',
    ],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

class Message(BaseModel):
    role: str = Field(...)
    content: str = Field(...)

class MemoryCreate(BaseModel):
    messages: List[Message] = Field(...)
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    run_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class SearchRequest(BaseModel):
    query: str = Field(...)
    user_id: Optional[str] = None
    run_id: Optional[str] = None
    agent_id: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None

@app.get('/')
def root():
    return RedirectResponse(url='/docs')

@app.post('/configure')
def set_config(config: Dict[str, Any]):
    global MEMORY_INSTANCE
    MEMORY_INSTANCE = Memory.from_config(config)
    return {'message': 'Configuration set successfully'}

@app.post('/memories')
def add_memory(memory_create: MemoryCreate):
    if not any([memory_create.user_id, memory_create.agent_id, memory_create.run_id]):
        raise HTTPException(status_code=400, detail='At least one identifier (user_id, agent_id, run_id) is required.')
    params = {k: v for k, v in memory_create.model_dump().items() if v is not None and k != 'messages'}
    try:
        response = MEMORY_INSTANCE.add(messages=[m.model_dump() for m in memory_create.messages], **params)
        return JSONResponse(content=response)
    except Exception as e:
        logging.exception('Error in add_memory:')
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/memories')
def get_all_memories(user_id: Optional[str] = None, run_id: Optional[str] = None, agent_id: Optional[str] = None):
    if not any([user_id, run_id, agent_id]):
        raise HTTPException(status_code=400, detail='At least one identifier is required.')
    try:
        params = {k: v for k, v in {'user_id': user_id, 'run_id': run_id, 'agent_id': agent_id}.items() if v is not None}
        return MEMORY_INSTANCE.get_all(**params)
    except Exception as e:
        logging.exception('Error in get_all_memories:')
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/memories/{memory_id}')
def get_memory(memory_id: str):
    try:
        return MEMORY_INSTANCE.get(memory_id)
    except Exception as e:
        logging.exception('Error in get_memory:')
        raise HTTPException(status_code=500, detail=str(e))

@app.post('/search')
def search_memories(search_req: SearchRequest):
    try:
        params = {k: v for k, v in search_req.model_dump().items() if v is not None and k != 'query'}
        return MEMORY_INSTANCE.search(query=search_req.query, **params)
    except Exception as e:
        logging.exception('Error in search_memories:')
        raise HTTPException(status_code=500, detail=str(e))

@app.put('/memories/{memory_id}')
def update_memory(memory_id: str, updated_memory: Dict[str, Any]):
    try:
        return MEMORY_INSTANCE.update(memory_id=memory_id, data=updated_memory)
    except Exception as e:
        logging.exception('Error in update_memory:')
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/memories/{memory_id}/history')
def memory_history(memory_id: str):
    try:
        return MEMORY_INSTANCE.history(memory_id)
    except Exception as e:
        logging.exception('Error in memory_history:')
        raise HTTPException(status_code=500, detail=str(e))

@app.delete('/memories/{memory_id}')
def delete_memory(memory_id: str):
    try:
        MEMORY_INSTANCE.delete(memory_id)
        return {'message': 'Memory deleted successfully'}
    except Exception as e:
        logging.exception('Error in delete_memory:')
        raise HTTPException(status_code=500, detail=str(e))

@app.delete('/memories')
def delete_all_memories(user_id: Optional[str] = None, run_id: Optional[str] = None, agent_id: Optional[str] = None):
    if not any([user_id, run_id, agent_id]):
        raise HTTPException(status_code=400, detail='At least one identifier is required.')
    try:
        params = {k: v for k, v in {'user_id': user_id, 'run_id': run_id, 'agent_id': agent_id}.items() if v is not None}
        MEMORY_INSTANCE.delete_all(**params)
        return {'message': 'All relevant memories deleted'}
    except Exception as e:
        logging.exception('Error in delete_all_memories:')
        raise HTTPException(status_code=500, detail=str(e))

@app.post('/reset')
def reset_memory():
    try:
        MEMORY_INSTANCE.reset()
        return {'message': 'All memories reset'}
    except Exception as e:
        logging.exception('Error in reset_memory:')
        raise HTTPException(status_code=500, detail=str(e))
```

Save it to:

```bash
cat > /tmp/mem0-oss/main.py <<'PY'
# paste the Python file above here
PY
```

## 4. Pull the official image

```bash
docker pull mem0/mem0-api-server
```

## 5. Start standalone Mem0

```bash
docker rm -f mem0-oss >/dev/null 2>&1 || true

docker run -d \
  --name mem0-oss \
  -p 127.0.0.1:8000:8000 \
  -v /tmp/mem0-oss:/mem0-custom \
  -v /tmp/mem0-oss/data:/mem0-data \
  --env-file /tmp/mem0-oss/.env \
  --entrypoint sh \
  mem0/mem0-api-server \
  -lc 'uvicorn --app-dir /mem0-custom main:app --host 0.0.0.0 --port 8000'
```

## 6. Verify the server

Check docs:

```bash
curl -i http://127.0.0.1:8000/docs
curl -i http://127.0.0.1:8000/openapi.json
```

Check CORS for AIRI web:

```bash
curl -I -H 'Origin: http://127.0.0.1:5173' http://127.0.0.1:8000/docs
```

You should see:

- `HTTP/1.1 200 OK`
- `access-control-allow-origin: http://127.0.0.1:5173`

## 7. Verify memory add/search

Add:

```bash
curl -X POST http://127.0.0.1:8000/memories \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [
      { "role": "user", "content": "Ben likes precise setup guides." }
    ],
    "user_id": "ben"
  }'
```

List:

```bash
curl 'http://127.0.0.1:8000/memories?user_id=ben'
```

Search:

```bash
curl -X POST http://127.0.0.1:8000/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "precise setup guides",
    "user_id": "ben"
  }'
```

## 8. AIRI short-term memory settings

Use these values in AIRI:

- `Mode`: `Open Source`
- `User ID`: `ben`
- `Base URL`: `http://127.0.0.1:8000`
- `API Key`: leave empty
- `Embedder`: `text-embedding-3-small`
- `Vector Store`: `local-default`

Then click:

- `Run Validation`

Expected result:

```text
mem0 connectivity check passed via http://127.0.0.1:8000/openapi.json (200) on 127.0.0.1:8000.
```

## 9. Stop and restart

Stop:

```bash
docker rm -f mem0-oss
```

Restart:

```bash
docker start mem0-oss
```

Logs:

```bash
docker logs --tail 200 mem0-oss
```

## Known issues

- The official `mem0/mem0-api-server:latest` entrypoint was not directly usable here because its built-in defaults attempted `pgvector + neo4j`.
- AIRI web validation originally failed with CORS until the custom FastAPI entrypoint added `CORSMiddleware`.
- AIRI runtime recall/capture integration is still separate from this runbook. This runbook only guarantees:
  - standalone mem0 startup
  - HTTP connectivity
  - AIRI settings-page validation
